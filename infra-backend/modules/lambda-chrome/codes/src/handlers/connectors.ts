import { createDbClient } from '@walkcroach/db';
import { embedAndStoreWorkflowRun } from '@walkcroach/agent-harness';
import {
  configuredProviders,
  describeAction,
  destroyTokens,
  executeRun,
  getAction,
  getConnector,
  isProviderId,
  listConnectors,
  listRuns,
  markRunDeclined,
  recordProposal,
  revokeConnector,
  toConnectorView,
  validateActionArgs,
  type ActionId,
} from '@walkcroach/connectors';
import {
  assertCredits,
  debitCredits,
  getEntitlement,
} from '@walkcroach/ledger';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

/**
 * Chrome's slice of the cross-surface connector platform (Chrome plan E1).
 *
 * Deliberately thin. Connecting an account happens on WalkCroach Web — the
 * plan's open decision §9.2 resolves in favour of Web Settings as the single
 * source of truth for OAuth, with the panel as *status and execute*. That keeps
 * one redirect URI per provider instead of one per surface, and means the
 * extension is never an OAuth client in its own right.
 *
 * Everything here delegates to `@walkcroach/connectors`. There is no
 * Chrome-specific action list, token store, or validation — the Chrome plan is
 * explicit that E must not fork the platform (E0), and a second implementation
 * is exactly how two surfaces end up with different security properties.
 */

const SURFACE = 'chrome' as const;

/** Where the panel sends the user to connect or manage an account. */
function connectUrl(): string {
  const base = (process.env.WEB_APP_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/app/settings/connections` : '';
}

/** GET /chrome/v1/connectors */
export async function handleListConnectors(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  // Device sessions are anonymous; a connector belongs to an account.
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(200, {
      requiresSignIn: true,
      providers: [],
      connectUrl: connectUrl(),
    });
  }

  const db = createDbClient();
  try {
    const rows = await listConnectors(db, auth.ownerId);
    const byProvider = new Map(rows.map((r) => [r.provider, r]));

    // Only providers with OAuth credentials actually configured are offered —
    // showing one that dead-ends at a consent screen is worse than hiding it.
    const providers = configuredProviders().map((p) => {
      const row = byProvider.get(p.id);
      return {
        id: p.id,
        label: p.label,
        tier: p.tier,
        disclosure: p.disclosure,
        scopes: p.scopes,
        connection: row ? toConnectorView(row) : null,
      };
    });

    return jsonResponse(200, {
      requiresSignIn: false,
      providers,
      connectUrl: connectUrl(),
    });
  } finally {
    await db.close();
  }
}

/** DELETE /chrome/v1/connectors/:provider */
export async function handleDisconnectConnector(
  auth: AuthContext,
  provider: string,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(401, { error: 'sign in to manage connections' });
  }
  if (!isProviderId(provider)) {
    return jsonResponse(400, { error: 'unknown provider' });
  }

  const db = createDbClient();
  try {
    const existing = await getConnector(db, auth.ownerId, provider);
    if (!existing) return jsonResponse(404, { error: 'not connected' });

    // Row first, then credential. If the delete fails the connection is already
    // unusable, which is the safe ordering; the reverse could leave a row that
    // looks live with no token behind it.
    await revokeConnector(db, auth.ownerId, provider);
    await destroyTokens(existing.secret_ref);

    metricLog('chrome.connector.disconnect', { provider });
    return jsonResponse(200, { ok: true, provider });
  } finally {
    await db.close();
  }
}

/**
 * POST /chrome/v1/connectors/propose
 *
 * Validate a proposed action and record it as `proposed`. Nothing reaches a
 * provider here — this only produces the confirm card the user will see.
 */
export async function handleProposeAction(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(401, { error: 'sign in to use connectors' });
  }
  const parsed = parseJsonBody<{ action?: string; args?: unknown }>(rawBody);
  if ('error' in parsed && parsed.error === 'invalid JSON body') {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed as { action?: string; args?: unknown };
  const actionId = body.action?.trim() ?? '';

  const action = getAction(actionId);
  if (!action) {
    metricLog('chrome.connector.unknown_action', { action: actionId });
    return jsonResponse(400, { error: `unknown action: ${actionId}` });
  }

  const validated = validateActionArgs(actionId, body.args ?? {});
  if (!validated.ok) {
    return jsonResponse(400, { error: validated.error });
  }

  const db = createDbClient();
  try {
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
    });

    metricLog('chrome.connector.propose', { action: action.id });
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
  } finally {
    await db.close();
  }
}

/**
 * POST /chrome/v1/connectors/runs/:id/execute
 *
 * The confirm. Carries no arguments on purpose: the payload was fixed at propose
 * time and is re-read from storage, so what executes is exactly what the user was
 * shown.
 */
export async function handleExecuteRun(
  auth: AuthContext,
  runId: string,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(401, { error: 'sign in to use connectors' });
  }

  const db = createDbClient();
  try {
    /*
      Credit parity with Web (Phase E7).
      The Chrome BFF previously executed connector actions without touching the
      ledger, so the "shared pool" was in practice a Web-only limit — the same
      account could spend freely from the side panel. The gate below mirrors
      `lambda-agent/handlers/connectors.ts` exactly, using the same
      `@walkcroach/ledger` primitives against the same tables.

      The run is read before claiming so the cost is known up front; `executeRun`
      is what actually claims it, atomically.
    */
    const pending = await peekRun(db, auth.ownerId, runId);
    if (!pending) {
      return jsonResponse(409, { error: 'this action is no longer pending' });
    }
    const action = getAction(pending.action);
    if (!action) return jsonResponse(400, { error: 'unknown action' });

    if (action.write) {
      const plan = await getEntitlement(db, auth.ownerId);
      if (plan !== 'paid') {
        return jsonResponse(402, {
          error: 'upgrade_required',
          message: 'Connector writes require a paid plan.',
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

    const out = await executeRun({ db, ownerId: auth.ownerId, runId });
    if (!out.ok) {
      metricLog('chrome.connector.execute', { ok: false });
      return jsonResponse(out.status ?? 500, { error: out.error });
    }

    const debit = await debitCredits(db, auth.ownerId, creditAction, undefined, {
      runId,
      action: action.id,
      surface: SURFACE,
    });
    if (!debit.ok) {
      // The provider call already happened. Reporting a soft credit failure is
      // the honest outcome — we cannot un-send an email to balance the books.
      metricLog('chrome.connector.execute', { ok: true, debit: false });
      return jsonResponse(200, {
        ok: true,
        result: out.result,
        creditsCharged: 0,
        creditWarning: 'executed_but_debit_failed',
        remainingCredits: debit.remaining,
      });
    }

    // E8: make the run recallable. "What did we send last week" should work in
    // the panel, not only in Web Chat, which is the whole point of one memory
    // layer across surfaces. Best-effort — Titan is optional in local dev, and a
    // missing embedding must never fail an action that already executed.
    try {
      await embedAndStoreWorkflowRun({
        db,
        runId,
        action: action.id,
        proposed: { action: action.id },
        result: out.result,
        status: 'executed',
      });
    } catch {
      /* recall degrades; the action still happened */
    }

    metricLog('chrome.connector.execute', { ok: true });
    return jsonResponse(200, {
      ok: true,
      result: out.result,
      creditsCharged: action.write ? 2 : 1,
      remainingCredits: debit.remaining,
    });
  } finally {
    await db.close();
  }
}

/** Read a pending run without claiming it, so its cost can be gated first. */
async function peekRun(
  db: ReturnType<typeof createDbClient>,
  ownerId: string,
  runId: string,
): Promise<{ action: string } | null> {
  const { rows } = await db.query<{ action: string }>(
    `SELECT action FROM workflow_runs
     WHERE id = $1::uuid AND owner_id = $2 AND status = 'proposed'`,
    [runId, ownerId],
  );
  return rows[0] ?? null;
}

/** POST /chrome/v1/connectors/runs/:id/decline */
export async function handleDeclineRun(
  auth: AuthContext,
  runId: string,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(401, { error: 'sign in to use connectors' });
  }
  const db = createDbClient();
  try {
    // Declines are recorded, not discarded: "what did the agent try to do on my
    // behalf" is an audit question.
    await markRunDeclined(db, auth.ownerId, runId);
    metricLog('chrome.connector.decline', { ok: true });
    return jsonResponse(200, { ok: true });
  } finally {
    await db.close();
  }
}

/** GET /chrome/v1/connectors/runs — history, and the basis for E8 recall. */
export async function handleListRuns(
  auth: AuthContext,
  limit?: string,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(200, { runs: [] });
  }
  const db = createDbClient();
  try {
    const rows = await listRuns(db, auth.ownerId, Number(limit) || 20);
    return jsonResponse(200, {
      runs: rows.map((r) => ({
        id: r.id,
        action: r.action,
        surface: r.surface,
        status: r.status,
        // The proposal is echoed back so history can show what was asked for,
        // not just that something happened.
        proposed: r.proposed_action,
        result: r.result,
        error: r.error,
        createdAt: r.created_at,
        executedAt: r.executed_at,
      })),
    });
  } finally {
    await db.close();
  }
}
