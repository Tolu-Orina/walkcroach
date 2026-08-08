/**
 * Phase C — Account erase (propose → confirm → execute).
 *
 * Closes GDPR residual gaps: chat/message redaction, S3 artefact deletion,
 * Stripe customer delete, email pseudonymization after complete.
 *
 * Memory never silent hard-DELETE (ADR-0002). usage_ledger / account_audit kept
 * for Art. 17(3) billing/accountability; email is stripped from erase requests.
 */
import {
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { eraseMemoryEntries } from '@walkcroach/agent-harness';
import {
  destroyTokens,
  listConnectors,
  revokeConnector,
} from '@walkcroach/connectors';
import type { DbClient } from '@walkcroach/db';
import Stripe from 'stripe';
import { deleteObjects, deletePrefix } from '../artefacts.js';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { applySubscriptionPlan, getEntitlementRow } from './billing.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export const ACCOUNT_DELETE_CONFIRM_PHRASE = 'DELETE MY ACCOUNT';
export const ERASED_EMAIL_PLACEHOLDER = '[erased]';
const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const ERASED_JSON = JSON.stringify({ erased: true });

type EraseSummary = {
  projects: number;
  apiKeysActive: number;
  connectorsConnected: number;
  hasStripeCustomer: boolean;
  plan: string;
};

export type EraseResult = {
  apiKeysRevoked: number;
  connectorsRevoked: number;
  memoryErased: number;
  messagesRedacted: number;
  projectsSoftDeleted: number;
  s3ObjectsDeleted: number;
  stripeCancelled: boolean;
  stripeCustomerDeleted: boolean;
  cognitoDeleted: boolean;
  cognitoSkipped?: string;
};

async function appendAccountAudit(
  db: DbClient,
  ownerId: string,
  action: 'erase_propose' | 'erase_execute' | 'erase_fail' | 'erase_cancel',
  requestId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO account_audit (owner_id, action, request_id, detail)
     VALUES ($1, $2, $3::uuid, $4::jsonb)`,
    [ownerId, action, requestId, JSON.stringify(detail)],
  );
}

async function buildSummary(db: DbClient, ownerId: string): Promise<EraseSummary> {
  const [projects, keys, connectors, ent] = await Promise.all([
    db.query<{ n: string }>(
      `SELECT count(*)::string AS n FROM projects
       WHERE owner_id = $1 AND deleted_at IS NULL`,
      [ownerId],
    ),
    db.query<{ n: string }>(
      `SELECT count(*)::string AS n FROM api_keys
       WHERE owner_id = $1 AND revoked_at IS NULL`,
      [ownerId],
    ),
    db.query<{ n: string }>(
      `SELECT count(*)::string AS n FROM connectors
       WHERE owner_id = $1 AND status = 'connected'`,
      [ownerId],
    ),
    getEntitlementRow(db, ownerId),
  ]);
  return {
    projects: Number(projects.rows[0]?.n ?? 0),
    apiKeysActive: Number(keys.rows[0]?.n ?? 0),
    connectorsConnected: Number(connectors.rows[0]?.n ?? 0),
    hasStripeCustomer: Boolean(ent.stripeCustomerId),
    plan: ent.plan,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function stripeClient(): Stripe | null {
  const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' });
}

async function cancelAndDeleteStripeCustomer(
  db: DbClient,
  ownerId: string,
): Promise<{ cancelled: boolean; customerDeleted: boolean }> {
  const stripe = stripeClient();
  const row = await getEntitlementRow(db, ownerId);
  if (!stripe || !row.stripeCustomerId) {
    await applySubscriptionPlan(db, ownerId, 'free', row.stripeCustomerId);
    await db.query(
      `UPDATE entitlements SET stripe_customer_id = NULL, updated_at = now()
       WHERE owner_id = $1`,
      [ownerId],
    );
    return { cancelled: false, customerDeleted: false };
  }

  let cancelled = false;
  const list = await stripe.subscriptions.list({
    customer: row.stripeCustomerId,
    status: 'all',
    limit: 20,
  });
  for (const sub of list.data) {
    if (
      sub.status === 'active' ||
      sub.status === 'trialing' ||
      sub.status === 'past_due'
    ) {
      await stripe.subscriptions.cancel(sub.id, {
        invoice_now: false,
        prorate: true,
      });
      cancelled = true;
    }
  }

  let customerDeleted = false;
  try {
    await stripe.customers.del(row.stripeCustomerId);
    customerDeleted = true;
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: string }).code)
        : '';
    if (code === 'resource_missing') customerDeleted = true;
    else throw err;
  }

  await applySubscriptionPlan(db, ownerId, 'free', null);
  await db.query(
    `UPDATE entitlements SET stripe_customer_id = NULL, plan = 'free', updated_at = now()
     WHERE owner_id = $1`,
    [ownerId],
  );
  return { cancelled, customerDeleted };
}

async function deleteCognitoUser(email: string): Promise<{
  deleted: boolean;
  skipped?: string;
}> {
  const userPoolId = (process.env.COGNITO_USER_POOL_ID ?? '').trim();
  if (!userPoolId) {
    return { deleted: false, skipped: 'cognito_not_configured' };
  }
  const client = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION || process.env.COGNITO_REGION || 'eu-west-2',
  });
  try {
    await client.send(
      new AdminUserGlobalSignOutCommand({
        UserPoolId: userPoolId,
        Username: email,
      }),
    );
  } catch {
    /* user may already be disabled / missing */
  }
  try {
    await client.send(
      new AdminDeleteUserCommand({
        UserPoolId: userPoolId,
        Username: email,
      }),
    );
    return { deleted: true };
  } catch (err) {
    const name =
      err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
    if (name === 'UserNotFoundException') {
      return { deleted: true, skipped: 'already_gone' };
    }
    throw err;
  }
}

async function safeQuery(
  db: DbClient,
  sql: string,
  params: unknown[],
): Promise<{ rows: Record<string, unknown>[] }> {
  try {
    return await db.query(sql, params);
  } catch {
    return { rows: [] };
  }
}

async function collectArtefactKeys(
  db: DbClient,
  ownerId: string,
  projectIds: string[],
): Promise<string[]> {
  const keys: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v?.trim()) keys.push(v.trim());
  };

  const captures = await safeQuery(
    db,
    `SELECT screenshot_s3_key AS k FROM page_captures WHERE owner_id = $1`,
    [ownerId],
  );
  for (const r of captures.rows) push(r.k as string | null);

  const creatives = await safeQuery(
    db,
    `SELECT s3_key AS a, preview_s3_key AS b FROM creative_assets WHERE owner_id = $1`,
    [ownerId],
  );
  for (const r of creatives.rows) {
    push(r.a as string | null);
    push(r.b as string | null);
  }

  const videos = await safeQuery(
    db,
    `SELECT s3_key AS a, preview_s3_key AS b FROM video_jobs WHERE owner_id = $1`,
    [ownerId],
  );
  for (const r of videos.rows) {
    push(r.a as string | null);
    push(r.b as string | null);
  }

  const code = await safeQuery(
    db,
    `SELECT s3_key AS k FROM code_artefacts WHERE user_id = $1`,
    [ownerId],
  );
  for (const r of code.rows) push(r.k as string | null);

  if (projectIds.length > 0) {
    const docs = await safeQuery(
      db,
      `SELECT s3_key AS k FROM project_documents
       WHERE project_id = ANY($1::uuid[])`,
      [projectIds],
    );
    for (const r of docs.rows) push(r.k as string | null);

    const sessions = await safeQuery(
      db,
      `SELECT id FROM sessions WHERE project_id = ANY($1::uuid[])`,
      [projectIds],
    );
    for (const s of sessions.rows) {
      const sid = String(s.id);
      const msgs = await safeQuery(
        db,
        `SELECT attachments FROM messages
         WHERE session_id = $1::uuid AND attachments IS NOT NULL`,
        [sid],
      );
      for (const m of msgs.rows) {
        const atts = m.attachments;
        if (!Array.isArray(atts)) continue;
        for (const a of atts) {
          if (a && typeof a === 'object' && 's3Key' in a) {
            push(String((a as { s3Key?: string }).s3Key ?? ''));
          }
          if (a && typeof a === 'object' && 'key' in a) {
            push(String((a as { key?: string }).key ?? ''));
          }
        }
      }
    }
  }

  return keys;
}

async function redactOwnerContent(
  db: DbClient,
  ownerId: string,
  projectIds: string[],
): Promise<number> {
  let messagesRedacted = 0;

  if (projectIds.length > 0) {
    const msgs = await safeQuery(
      db,
      `UPDATE messages m
       SET content = $2::jsonb,
           attachments = NULL,
           citations = NULL
       FROM sessions s
       WHERE m.session_id = s.id
         AND s.project_id = ANY($1::uuid[])
       RETURNING m.id`,
      [projectIds, JSON.stringify('[erased]')],
    );
    messagesRedacted = msgs.rows.length;

    await safeQuery(
      db,
      `UPDATE sessions
       SET title = '[erased]', updated_at = now()
       WHERE project_id = ANY($1::uuid[])`,
      [projectIds],
    );

    await safeQuery(
      db,
      `UPDATE build_events be
       SET tool_args = '{}'::jsonb, result_summary = '[erased]'
       FROM sessions s
       WHERE be.session_id = s.id
         AND s.project_id = ANY($1::uuid[])`,
      [projectIds],
    );

    await safeQuery(
      db,
      `UPDATE project_document_chunks
       SET content = '[erased]', embedding = NULL, metadata = '{}'::jsonb
       WHERE project_id = ANY($1::uuid[])`,
      [projectIds],
    );

    await safeQuery(
      db,
      `UPDATE project_documents
       SET name = '[erased]', embedding = NULL, s3_key = NULL
       WHERE project_id = ANY($1::uuid[])`,
      [projectIds],
    );

    await safeQuery(
      db,
      `DELETE FROM project_secret_keys
       WHERE project_id = ANY($1::uuid[])`,
      [projectIds],
    );
  }

  await safeQuery(
    db,
    `UPDATE projects
     SET name = '[erased]',
         description = NULL,
         instructions = NULL,
         memory_summary = NULL,
         updated_at = now()
     WHERE owner_id = $1`,
    [ownerId],
  );

  await safeQuery(
    db,
    `UPDATE page_captures
     SET extracted_text = '[erased]',
         title = '[erased]',
         embedding = NULL,
         structured_fields = '{}'::jsonb,
         screenshot_s3_key = NULL
     WHERE owner_id = $1`,
    [ownerId],
  );

  await safeQuery(
    db,
    `UPDATE creative_assets
     SET brief = $2::jsonb,
         s3_key = NULL,
         preview_s3_key = NULL,
         embedding = NULL,
         alt_text = NULL,
         error = NULL,
         status = 'failed',
         updated_at = now()
     WHERE owner_id = $1`,
    [ownerId, ERASED_JSON],
  );

  await safeQuery(
    db,
    `UPDATE video_jobs
     SET shot_list = '[]'::jsonb,
         s3_key = NULL,
         preview_s3_key = NULL,
         embedding = NULL,
         error = $2::jsonb,
         updated_at = now()
     WHERE owner_id = $1`,
    [ownerId, ERASED_JSON],
  );

  await safeQuery(
    db,
    `UPDATE code_artefacts
     SET content = '[erased]', s3_key = NULL, content_hash = NULL, updated_at = now()
     WHERE user_id = $1`,
    [ownerId],
  );

  await safeQuery(
    db,
    `UPDATE shared_skills
     SET description = '[erased]', body = '[erased]', embedding = NULL, updated_at = now()
     WHERE owner_id = $1`,
    [ownerId],
  );

  await safeQuery(
    db,
    `UPDATE workflow_runs
     SET proposed_action = $2::jsonb,
         result = $2::jsonb,
         error = NULL,
         embedding = NULL
     WHERE owner_id = $1`,
    [ownerId, ERASED_JSON],
  );

  await safeQuery(
    db,
    `UPDATE agent_runs
     SET request = $2::jsonb, result = $2::jsonb, error = '[erased]'
     WHERE owner_id = $1`,
    [ownerId, ERASED_JSON],
  );

  await safeQuery(
    db,
    `UPDATE connectors
     SET account_label = '[erased]', last_error = NULL, updated_at = now()
     WHERE owner_id = $1`,
    [ownerId],
  );

  await safeQuery(
    db,
    `UPDATE workspaces SET name = '[erased]', updated_at = now() WHERE owner_id = $1`,
    [ownerId],
  );

  return messagesRedacted;
}

async function purgeArtefactStorage(
  db: DbClient,
  ownerId: string,
  projectIds: string[],
): Promise<number> {
  const keys = await collectArtefactKeys(db, ownerId, projectIds);
  let deleted = await deleteObjects(keys);
  for (const id of projectIds) {
    deleted += await deletePrefix(`projects/${id}`);
  }
  return deleted;
}

async function pseudonymizeEraseEmails(
  db: DbClient,
  ownerId: string,
): Promise<void> {
  await db.query(
    `UPDATE account_erase_requests
     SET expected_email = $2
     WHERE owner_id = $1
       AND expected_email IS DISTINCT FROM $2`,
    [ownerId, ERASED_EMAIL_PLACEHOLDER],
  );
}

export async function executeOwnerErase(
  db: DbClient,
  ownerId: string,
  email: string,
): Promise<EraseResult> {
  const result: EraseResult = {
    apiKeysRevoked: 0,
    connectorsRevoked: 0,
    memoryErased: 0,
    messagesRedacted: 0,
    projectsSoftDeleted: 0,
    s3ObjectsDeleted: 0,
    stripeCancelled: false,
    stripeCustomerDeleted: false,
    cognitoDeleted: false,
  };

  const { rows: projects } = await db.query<{ id: string }>(
    `SELECT id FROM projects WHERE owner_id = $1`,
    [ownerId],
  );
  const projectIds = projects.map((p) => p.id);

  const revokedKeys = await db.query<{ id: string }>(
    `UPDATE api_keys
     SET revoked_at = now()
     WHERE owner_id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [ownerId],
  );
  result.apiKeysRevoked = revokedKeys.rows.length;

  await safeQuery(db, `DELETE FROM ide_auth_codes WHERE owner_id = $1`, [ownerId]);
  await safeQuery(db, `DELETE FROM chrome_auth_codes WHERE owner_id = $1`, [
    ownerId,
  ]);
  await safeQuery(db, `DELETE FROM connector_oauth_states WHERE owner_id = $1`, [
    ownerId,
  ]);
  await safeQuery(db, `DELETE FROM github_oauth_states WHERE owner_id = $1`, [
    ownerId,
  ]);
  await safeQuery(db, `DELETE FROM chrome_device_sessions WHERE owner_id = $1`, [
    ownerId,
  ]);
  await safeQuery(db, `DELETE FROM chrome_chat_handoffs WHERE owner_id = $1`, [
    ownerId,
  ]);
  await safeQuery(db, `DELETE FROM ide_project_links WHERE owner_id = $1`, [
    ownerId,
  ]);

  const connectors = await listConnectors(db, ownerId);
  for (const c of connectors) {
    if (c.status === 'connected') {
      try {
        await destroyTokens(c.secret_ref);
      } catch {
        /* continue — still revoke row */
      }
      await revokeConnector(db, ownerId, c.provider);
      result.connectorsRevoked += 1;
    }
  }

  try {
    const stripe = await cancelAndDeleteStripeCustomer(db, ownerId);
    result.stripeCancelled = stripe.cancelled;
    result.stripeCustomerDeleted = stripe.customerDeleted;
  } catch {
    await applySubscriptionPlan(db, ownerId, 'free');
    await safeQuery(
      db,
      `UPDATE entitlements SET stripe_customer_id = NULL, updated_at = now()
       WHERE owner_id = $1`,
      [ownerId],
    );
  }

  for (const p of projects) {
    const erased = await eraseMemoryEntries({
      db,
      projectId: p.id,
      ownerId,
      reason: 'account_delete',
      exportFirst: false,
    });
    result.memoryErased += erased.erased;
  }

  // S3 first while keys are still in DB rows, then redact DB content.
  try {
    result.s3ObjectsDeleted = await purgeArtefactStorage(db, ownerId, projectIds);
  } catch {
    result.s3ObjectsDeleted = 0;
  }

  result.messagesRedacted = await redactOwnerContent(db, ownerId, projectIds);

  const soft = await db.query<{ id: string }>(
    `UPDATE projects
     SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
     WHERE owner_id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [ownerId],
  );
  result.projectsSoftDeleted = soft.rows.length;

  await db.query(
    `UPDATE credit_balances
     SET monthly_credits = 0, used_this_month = 0, updated_at = now()
     WHERE owner_id = $1`,
    [ownerId],
  );

  try {
    const cognito = await deleteCognitoUser(email);
    result.cognitoDeleted = cognito.deleted;
    if (cognito.skipped) result.cognitoSkipped = cognito.skipped;
  } catch (err) {
    result.cognitoDeleted = false;
    result.cognitoSkipped =
      err instanceof Error ? err.message : 'cognito_delete_failed';
  }

  await pseudonymizeEraseEmails(db, ownerId);

  return result;
}

/** POST /me/account/erase/propose — body `{ email }` */
export async function handleAccountErasePropose(
  db: DbClient,
  auth: AuthContext,
  rawBody?: string,
): Promise<RestResult> {
  if (auth.isAnonymous) {
    return jsonResponse(401, { error: 'sign_in_required' });
  }

  let email = '';
  try {
    const body = JSON.parse(rawBody ?? '{}') as { email?: string };
    email = normalizeEmail(body.email ?? '');
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  if (!email || !email.includes('@')) {
    return jsonResponse(400, {
      error: 'email_required',
      message: 'Confirm the account email to start deletion.',
    });
  }

  const summary = await buildSummary(db, auth.ownerId);
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);

  await db.query(
    `UPDATE account_erase_requests
     SET status = 'cancelled'
     WHERE owner_id = $1 AND status = 'proposed'`,
    [auth.ownerId],
  );

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO account_erase_requests
       (owner_id, expected_email, confirm_phrase, status, summary, expires_at)
     VALUES ($1, $2, $3, 'proposed', $4::jsonb, $5)
     RETURNING id`,
    [
      auth.ownerId,
      email,
      ACCOUNT_DELETE_CONFIRM_PHRASE,
      JSON.stringify(summary),
      expiresAt.toISOString(),
    ],
  );
  const proposalId = rows[0]!.id;

  await appendAccountAudit(db, auth.ownerId, 'erase_propose', proposalId, {
    summary,
    expiresAt: expiresAt.toISOString(),
  });

  return jsonResponse(200, {
    proposalId,
    confirmPhrase: ACCOUNT_DELETE_CONFIRM_PHRASE,
    expiresAt: expiresAt.toISOString(),
    summary,
    message:
      'Type your email and the confirm phrase to permanently erase this account.',
  });
}

/** POST /me/account/erase/confirm — body `{ proposalId, email, confirmPhrase }` */
export async function handleAccountEraseConfirm(
  db: DbClient,
  auth: AuthContext,
  rawBody?: string,
): Promise<RestResult> {
  if (auth.isAnonymous) {
    return jsonResponse(401, { error: 'sign_in_required' });
  }

  let proposalId = '';
  let email = '';
  let confirmPhrase = '';
  try {
    const body = JSON.parse(rawBody ?? '{}') as {
      proposalId?: string;
      email?: string;
      confirmPhrase?: string;
    };
    proposalId = (body.proposalId ?? '').trim();
    email = normalizeEmail(body.email ?? '');
    confirmPhrase = (body.confirmPhrase ?? '').trim();
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  if (!proposalId || !email || !confirmPhrase) {
    return jsonResponse(400, {
      error: 'missing_fields',
      message: 'proposalId, email, and confirmPhrase are required.',
    });
  }

  const { rows } = await db.query<{
    id: string;
    owner_id: string;
    expected_email: string;
    confirm_phrase: string;
    status: string;
    expires_at: Date;
  }>(
    `SELECT id, owner_id, expected_email, confirm_phrase, status, expires_at
     FROM account_erase_requests
     WHERE id = $1::uuid`,
    [proposalId],
  );
  const proposal = rows[0];
  if (!proposal || proposal.owner_id !== auth.ownerId) {
    return jsonResponse(404, { error: 'proposal_not_found' });
  }
  if (proposal.status !== 'proposed') {
    return jsonResponse(409, {
      error: 'proposal_not_open',
      status: proposal.status,
    });
  }
  if (new Date(proposal.expires_at).getTime() < Date.now()) {
    await db.query(
      `UPDATE account_erase_requests SET status = 'expired' WHERE id = $1::uuid`,
      [proposalId],
    );
    return jsonResponse(410, { error: 'proposal_expired' });
  }
  if (normalizeEmail(proposal.expected_email) !== email) {
    return jsonResponse(400, {
      error: 'email_mismatch',
      message: 'Email must match the address used when proposing deletion.',
    });
  }
  if (confirmPhrase !== proposal.confirm_phrase) {
    return jsonResponse(400, {
      error: 'confirm_mismatch',
      message: `Type exactly: ${proposal.confirm_phrase}`,
    });
  }

  try {
    const eraseResult = await executeOwnerErase(db, auth.ownerId, email);
    await db.query(
      `UPDATE account_erase_requests
       SET status = 'completed',
           result = $2::jsonb,
           completed_at = now(),
           expected_email = $3
       WHERE id = $1::uuid`,
      [proposalId, JSON.stringify(eraseResult), ERASED_EMAIL_PLACEHOLDER],
    );
    await appendAccountAudit(db, auth.ownerId, 'erase_execute', proposalId, {
      eraseResult,
    });
    return jsonResponse(200, {
      ok: true,
      proposalId,
      ...eraseResult,
      message:
        'Account erased. Sign out locally — Cognito credentials are no longer valid.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.query(
      `UPDATE account_erase_requests
       SET status = 'failed', result = $2::jsonb
       WHERE id = $1::uuid`,
      [proposalId, JSON.stringify({ error: message })],
    );
    await appendAccountAudit(db, auth.ownerId, 'erase_fail', proposalId, {
      error: message,
    });
    return jsonResponse(500, {
      error: 'erase_failed',
      message,
    });
  }
}
