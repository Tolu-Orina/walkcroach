/**
 * Web connectors — OAuth + propose/execute/decline (Phase F2–F3).
 * Reuses @walkcroach/connectors; Chrome panel deep-links here for connect.
 */
import type { DbClient } from '@walkcroach/db';
import {
  buildAuthorizeUrl,
  listableProviders,
  providerUnavailableReason,
  consumeOauthState,
  createOauthState,
  describeAction,
  destroyTokens,
  exchangeCode,
  executeRun,
  generatePkce,
  generateStateValue,
  getAction,
  getConnector,
  getProvider,
  hashState,
  importDriveFiles,
  isProviderId,
  listConnectors,
  listRuns,
  markRunDeclined,
  recordProposal,
  resolveConnectorAccessToken,
  revokeConnector,
  secretRefFor,
  storeTokens,
  toConnectorView,
  upsertConnector,
  validateActionArgs,
  type ActionId,
  type Surface,
} from '@walkcroach/connectors';
import {
  embedAndStoreWorkflowRun,
} from '@walkcroach/agent-harness';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import {
  assertCredits,
  debitCredits,
  getEntitlement,
  hasConnectorWriteAccess,
  refundCredits,
} from './billing.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const SURFACE: Surface = 'web';

function connectUrl(): string {
  const base = (process.env.WEB_APP_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/app/settings/connections` : '/app/settings/connections';
}

function oauthRedirectUri(): string {
  const base = (process.env.WEB_APP_URL ?? '').replace(/\/$/, '');
  if (!base) {
    // Local API often uses API_URL as public origin for callbacks.
    const api = (process.env.CORS_ALLOW_ORIGIN ?? '').replace(/\/$/, '');
    return `${api || 'http://localhost:5173'}/app/settings/connections/callback`;
  }
  return `${base}/app/settings/connections/callback`;
}

/** GET /connectors */
export async function handleListConnectorsWeb(
  db: DbClient,
  auth: AuthContext,
): Promise<RestResult> {
  const rows = await listConnectors(db, auth.ownerId);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const providers = listableProviders().map((p) => {
    const row = byProvider.get(p.id);
    return {
      id: p.id,
      label: p.label,
      tier: p.tier,
      disclosure: p.disclosure,
      scopes: p.scopes,
      // false for an announced-but-not-shippable provider; the surface renders
      // it disabled rather than letting a user start a flow that cannot finish.
      connectable: p.connectable,
      comingSoon: p.comingSoon ?? null,
      connection: row ? toConnectorView(row) : null,
    };
  });
  return jsonResponse(200, {
    providers,
    connectUrl: connectUrl(),
  });
}

/** DELETE /connectors/:provider */
export async function handleDisconnectConnectorWeb(
  db: DbClient,
  auth: AuthContext,
  provider: string,
): Promise<RestResult> {
  if (!isProviderId(provider)) {
    return jsonResponse(400, { error: 'unknown_provider' });
  }
  const existing = await getConnector(db, auth.ownerId, provider);
  if (!existing) return jsonResponse(404, { error: 'not_connected' });
  await revokeConnector(db, auth.ownerId, provider);
  await destroyTokens(existing.secret_ref);
  return jsonResponse(200, { ok: true, provider });
}

/**
 * POST /connectors/:provider/oauth/start
 * Returns authorizeUrl for the browser to navigate.
 */
export async function handleConnectorOauthStart(
  db: DbClient,
  auth: AuthContext,
  provider: string,
  body: { surface?: string } = {},
): Promise<RestResult> {
  if (!isProviderId(provider)) {
    return jsonResponse(400, { error: 'unknown_provider' });
  }
  const def = getProvider(provider);
  if (!def) return jsonResponse(400, { error: 'unknown_provider' });
  // One check for every reason a provider may be unavailable — including
  // coming-soon, which credentials alone must never override. This endpoint is
  // reachable directly, so the UI disabling its button is not a control.
  const unavailable = providerUnavailableReason(def);
  if (unavailable) {
    return jsonResponse(unavailable.code === 'coming_soon' ? 409 : 503, {
      error: unavailable.code,
      message: unavailable.message,
      provider,
    });
  }
  const clientId = process.env[def.clientIdEnv]!.trim();
  const clientSecret = process.env[def.clientSecretEnv]!.trim();

  const state = generateStateValue();
  const pkce = def.usePkce ? generatePkce() : undefined;
  const redirectUri = oauthRedirectUri();
  const surface: Surface =
    body.surface === 'chrome' ||
    body.surface === 'ide' ||
    body.surface === 'cli'
      ? body.surface
      : 'web';

  await createOauthState(db, {
    ownerId: auth.ownerId,
    provider,
    stateHash: hashState(state),
    codeVerifier: pkce?.verifier,
    redirectUri,
    surface,
  });

  const authorizeUrl = buildAuthorizeUrl({
    provider: def,
    clientId,
    redirectUri,
    state,
    codeChallenge: pkce?.challenge,
  });

  return jsonResponse(200, {
    authorizeUrl,
    state,
    redirectUri,
    provider,
  });
}

/**
 * POST /connectors/oauth/callback
 * Exchanges code; tokens → Secrets Manager; upserts connectors row.
 */
export async function handleConnectorOauthCallback(
  db: DbClient,
  auth: AuthContext,
  body: { code?: string; state?: string },
): Promise<RestResult> {
  const code = body.code?.trim();
  const state = body.state?.trim();
  if (!code || !state) {
    return jsonResponse(400, { error: 'code_and_state_required' });
  }

  const oauth = await consumeOauthState(db, hashState(state));
  if (!oauth) {
    return jsonResponse(400, { error: 'invalid_or_expired_state' });
  }
  if (oauth.owner_id !== auth.ownerId) {
    return jsonResponse(403, { error: 'state_owner_mismatch' });
  }

  const tokens = await exchangeCode({
    providerId: oauth.provider,
    code,
    redirectUri: oauth.redirect_uri,
    codeVerifier: oauth.code_verifier ?? undefined,
  });
  if ('error' in tokens) {
    return jsonResponse(400, { error: tokens.error });
  }

  const secretRef = secretRefFor(auth.ownerId, oauth.provider);
  await storeTokens(secretRef, tokens);
  const row = await upsertConnector(db, {
    ownerId: auth.ownerId,
    provider: oauth.provider,
    scopes: tokens.scopes,
    secretRef,
    accountLabel: tokens.accountLabel ?? null,
  });

  return jsonResponse(200, {
    ok: true,
    provider: oauth.provider,
    surface: oauth.surface,
    connection: toConnectorView(row),
    redirectTo: connectUrl(),
  });
}

/** POST /connectors/propose */
export async function handleProposeConnectorAction(
  db: DbClient,
  auth: AuthContext,
  body: { action?: string; args?: unknown; sessionId?: string },
): Promise<RestResult> {
  const actionId = body.action?.trim() ?? '';
  const action = getAction(actionId);
  if (!action) {
    return jsonResponse(400, { error: `unknown action: ${actionId}` });
  }
  const validated = validateActionArgs(actionId, body.args ?? {});
  if (!validated.ok) {
    return jsonResponse(400, { error: validated.error });
  }

  const connector = await getConnector(db, auth.ownerId, action.provider);
  if (!connector || connector.status === 'revoked') {
    return jsonResponse(409, {
      error: `${action.label} needs ${action.provider} connected first`,
      needsConnection: action.provider,
      connectUrl: connectUrl(),
    });
  }

  const run = await recordProposal(db, {
    ownerId: auth.ownerId,
    connectorId: connector.id,
    surface: SURFACE,
    action: action.id,
    proposed: { action: action.id, args: validated.args },
    sessionId: body.sessionId ?? null,
  });

  return jsonResponse(201, {
    runId: run.id,
    action: action.id,
    title: action.label,
    consequence: action.consequence,
    write: action.write,
    irreversible: action.irreversible,
    weight: action.weight,
    rows: describeAction(action.id as ActionId, validated.args),
  });
}

/** POST /connectors/runs/:id/execute — ConfirmCard confirm. */
export async function handleExecuteConnectorRun(
  db: DbClient,
  auth: AuthContext,
  runId: string,
): Promise<RestResult> {
  // Peek proposed action for credit gate before claim (executeRun claims atomically).
  const { rows: peek } = await db.query<{
    action: string;
    status: string;
    proposed_action: Record<string, unknown>;
  }>(
    `SELECT action, status, proposed_action FROM workflow_runs
     WHERE id = $1::uuid AND owner_id = $2`,
    [runId, auth.ownerId],
  );
  const pending = peek[0];
  if (!pending || pending.status !== 'proposed') {
    return jsonResponse(409, { error: 'this action is no longer pending' });
  }

  const action = getAction(pending.action);
  if (!action) {
    return jsonResponse(400, { error: 'unknown action' });
  }

  if (action.write) {
    const plan = await getEntitlement(db, auth.ownerId);
    if (!hasConnectorWriteAccess(plan)) {
      return jsonResponse(402, {
        error: 'paid_plan_required',
        message: 'Connector writes require Starter or Pro.',
      });
    }
  }

  const creditAction = action.write ? 'connector_write' : 'connector_read';
  const credits = await assertCredits(db, auth.ownerId, creditAction);
  if (!credits.ok) {
    return jsonResponse(402, {
      error: 'insufficient_credits',
      remaining: credits.remaining,
    });
  }

  // Debit before provider side effects so concurrent spend cannot get free writes.
  const debit = await debitCredits(db, auth.ownerId, creditAction, undefined, {
    runId,
    action: action.id,
  });
  if (!debit.ok) {
    return jsonResponse(402, {
      error: 'insufficient_credits',
      remaining: debit.remaining,
    });
  }

  const out = await executeRun({ db, ownerId: auth.ownerId, runId });
  if (!out.ok) {
    await refundCredits(db, auth.ownerId, creditAction, action.write ? 2 : 1, undefined, {
      runId,
      action: action.id,
      reason: 'execute_failed',
    });
    return jsonResponse(out.status ?? 500, { error: out.error });
  }

  try {
    await embedAndStoreWorkflowRun({
      db,
      runId,
      action: action.id,
      proposed: pending.proposed_action ?? {},
      result: out.result,
      status: 'executed',
    });
  } catch {
    /* Titan optional in local/dev */
  }

  return jsonResponse(200, {
    ok: true,
    result: out.result,
    creditsCharged: action.write ? 2 : 1,
    remainingCredits: debit.remaining,
  });
}

/** POST /connectors/runs/:id/decline */
export async function handleDeclineConnectorRun(
  db: DbClient,
  auth: AuthContext,
  runId: string,
): Promise<RestResult> {
  const { rows } = await db.query<{
    action: string;
    proposed_action: Record<string, unknown>;
    status: string;
  }>(
    `SELECT action, proposed_action, status FROM workflow_runs
     WHERE id = $1::uuid AND owner_id = $2`,
    [runId, auth.ownerId],
  );
  const row = rows[0];
  await markRunDeclined(db, auth.ownerId, runId);
  if (row && row.status === 'proposed') {
    try {
      await embedAndStoreWorkflowRun({
        db,
        runId,
        action: row.action,
        proposed: row.proposed_action ?? {},
        status: 'declined',
      });
    } catch {
      /* optional */
    }
  }
  return jsonResponse(200, { ok: true });
}

/** GET /connectors/runs */
export async function handleListConnectorRuns(
  db: DbClient,
  auth: AuthContext,
  limit?: string,
): Promise<RestResult> {
  const rows = await listRuns(db, auth.ownerId, Number(limit) || 20);
  return jsonResponse(200, {
    runs: rows.map((r) => ({
      id: r.id,
      action: r.action,
      surface: r.surface,
      status: r.status,
      proposed: r.proposed_action,
      result: r.result,
      error: r.error,
      createdAt: r.created_at,
      executedAt: r.executed_at,
    })),
  });
}

/**
 * POST /connectors/google_drive/picker-session
 * Short-lived access token + public client id + Picker API key for the browser.
 */
export async function handleGoogleDrivePickerSession(
  db: DbClient,
  auth: AuthContext,
): Promise<RestResult> {
  const resolved = await resolveConnectorAccessToken(
    db,
    auth.ownerId,
    'google_drive',
  );
  if (!resolved.ok) {
    const status =
      resolved.code === 'not_connected'
        ? 404
        : resolved.code === 'provider'
          ? 503
          : 401;
    return jsonResponse(status, {
      error: resolved.error,
      code: resolved.code,
      connectUrl: connectUrl(),
    });
  }

  const apiKey =
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_PICKER_API_KEY?.trim() ||
    '';
  if (!apiKey) {
    return jsonResponse(503, {
      error:
        'Google Drive picker is not configured on this deployment (missing GOOGLE_API_KEY).',
      code: 'picker_not_configured',
      connectUrl: connectUrl(),
    });
  }

  const expiresIn = Math.max(
    60,
    Math.floor(((resolved.tokens.expiresAt ?? Date.now() + 3_600_000) - Date.now()) / 1000),
  );

  return jsonResponse(200, {
    accessToken: resolved.tokens.accessToken,
    expiresIn,
    clientId: resolved.clientId,
    apiKey,
    connectUrl: connectUrl(),
  });
}

/**
 * POST /connectors/google_drive/import
 * Downloads picked Drive files server-side and returns chat attachment payloads.
 */
export async function handleGoogleDriveImport(
  db: DbClient,
  auth: AuthContext,
  body: { fileIds?: unknown },
): Promise<RestResult> {
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter((id): id is string => typeof id === 'string')
    : [];

  const resolved = await resolveConnectorAccessToken(
    db,
    auth.ownerId,
    'google_drive',
  );
  if (!resolved.ok) {
    const status =
      resolved.code === 'not_connected'
        ? 404
        : resolved.code === 'provider'
          ? 503
          : 401;
    return jsonResponse(status, {
      error: resolved.error,
      code: resolved.code,
      connectUrl: connectUrl(),
    });
  }

  const imported = await importDriveFiles({
    tokens: resolved.tokens,
    fileIds,
  });
  if ('error' in imported) {
    const status = imported.code === 'limit' ? 413 : 400;
    return jsonResponse(status, {
      error: imported.error,
      code: imported.code,
    });
  }

  return jsonResponse(200, {
    attachments: imported.attachments.map((a) => ({
      name: a.name,
      mime: a.mime,
      size: a.size,
      textPreview: a.textPreview,
      contentText: a.contentText,
      contentBase64: a.contentBase64,
      source: 'google_drive' as const,
      sourceId: a.sourceId,
    })),
  });
}
