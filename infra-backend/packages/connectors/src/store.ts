import type { ActionId } from './actions.js';

/**
 * Persistence for connectors and workflow runs.
 *
 * Takes a `DbLike` rather than importing a client, so every surface's Lambda
 * passes its own connection and this package stays free of connection-lifecycle
 * opinions. It also makes the whole module unit-testable without a database.
 */

export type DbLike = {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type Surface = 'web' | 'chrome' | 'ide' | 'cli';
export type ConnectorStatus = 'connected' | 'revoked' | 'error';
export type RunStatus =
  | 'proposed'
  | 'confirmed'
  | 'executed'
  | 'failed'
  | 'declined';

export type ConnectorRow = {
  id: string;
  owner_id: string;
  provider: string;
  status: ConnectorStatus;
  scopes: string[];
  secret_ref: string;
  account_label: string | null;
  last_error: string | null;
  connected_at: string;
  updated_at: string;
};

/**
 * Safe projection for any client. Note the absence of `secret_ref`: no surface
 * has a reason to know where the credential lives, so it never crosses the wire.
 */
export type ConnectorView = {
  id: string;
  provider: string;
  status: ConnectorStatus;
  scopes: string[];
  accountLabel: string | null;
  lastError: string | null;
  connectedAt: string;
};

export function toConnectorView(row: ConnectorRow): ConnectorView {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    scopes: row.scopes ?? [],
    accountLabel: row.account_label,
    lastError: row.last_error,
    connectedAt: row.connected_at,
  };
}

export async function listConnectors(
  db: DbLike,
  ownerId: string,
): Promise<ConnectorRow[]> {
  const { rows } = await db.query<ConnectorRow>(
    `SELECT id, owner_id, provider, status, scopes, secret_ref,
            account_label, last_error, connected_at, updated_at
     FROM connectors
     WHERE owner_id = $1
     ORDER BY provider`,
    [ownerId],
  );
  return rows;
}

export async function getConnector(
  db: DbLike,
  ownerId: string,
  provider: string,
): Promise<ConnectorRow | null> {
  const { rows } = await db.query<ConnectorRow>(
    `SELECT id, owner_id, provider, status, scopes, secret_ref,
            account_label, last_error, connected_at, updated_at
     FROM connectors
     WHERE owner_id = $1 AND provider = $2`,
    [ownerId, provider],
  );
  return rows[0] ?? null;
}

/**
 * Upsert on (owner_id, provider).
 *
 * Reconnecting must reuse the same `secret_ref`, otherwise the previous secret
 * is orphaned in Secrets Manager still holding a live token.
 */
export async function upsertConnector(
  db: DbLike,
  input: {
    ownerId: string;
    provider: string;
    scopes: string[];
    secretRef: string;
    accountLabel?: string | null;
  },
): Promise<ConnectorRow> {
  const { rows } = await db.query<ConnectorRow>(
    `INSERT INTO connectors (owner_id, provider, status, scopes, secret_ref, account_label)
     VALUES ($1, $2, 'connected', $3, $4, $5)
     ON CONFLICT (owner_id, provider) DO UPDATE
       SET status = 'connected',
           scopes = excluded.scopes,
           account_label = excluded.account_label,
           last_error = NULL,
           updated_at = now()
     RETURNING id, owner_id, provider, status, scopes, secret_ref,
               account_label, last_error, connected_at, updated_at`,
    [
      input.ownerId,
      input.provider,
      input.scopes,
      input.secretRef,
      input.accountLabel ?? null,
    ],
  );
  return rows[0]!;
}

export async function markConnectorError(
  db: DbLike,
  ownerId: string,
  provider: string,
  message: string,
): Promise<void> {
  await db.query(
    `UPDATE connectors
     SET status = 'error', last_error = $3, updated_at = now()
     WHERE owner_id = $1 AND provider = $2`,
    [ownerId, provider, message.slice(0, 500)],
  );
}

/**
 * Disconnect. The row is kept as `revoked` rather than deleted so that historic
 * `workflow_runs` keep a resolvable foreign key — an executed action must stay
 * auditable after the account is disconnected.
 */
export async function revokeConnector(
  db: DbLike,
  ownerId: string,
  provider: string,
): Promise<ConnectorRow | null> {
  const { rows } = await db.query<ConnectorRow>(
    `UPDATE connectors
     SET status = 'revoked', updated_at = now()
     WHERE owner_id = $1 AND provider = $2
     RETURNING id, owner_id, provider, status, scopes, secret_ref,
               account_label, last_error, connected_at, updated_at`,
    [ownerId, provider],
  );
  return rows[0] ?? null;
}

/* ── OAuth state ─────────────────────────────────────────────────── */

export async function createOauthState(
  db: DbLike,
  input: {
    ownerId: string;
    provider: string;
    stateHash: string;
    codeVerifier?: string;
    redirectUri: string;
    surface: Surface;
    ttlMs?: number;
  },
): Promise<void> {
  const expires = new Date(Date.now() + (input.ttlMs ?? 10 * 60_000));
  await db.query(
    `DELETE FROM connector_oauth_states
     WHERE expires_at < now() OR consumed_at IS NOT NULL`,
  );
  await db.query(
    `INSERT INTO connector_oauth_states
       (owner_id, provider, state_hash, code_verifier, redirect_uri, surface, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.ownerId,
      input.provider,
      input.stateHash,
      input.codeVerifier ?? null,
      input.redirectUri,
      input.surface,
      expires.toISOString(),
    ],
  );
}

export type OauthStateRow = {
  owner_id: string;
  provider: string;
  code_verifier: string | null;
  redirect_uri: string;
  surface: Surface;
};

/**
 * Atomically consume the state. The `consumed_at IS NULL` predicate lives inside
 * the UPDATE so a replayed callback cannot race a legitimate one.
 */
export async function consumeOauthState(
  db: DbLike,
  stateHash: string,
): Promise<OauthStateRow | null> {
  const { rows } = await db.query<OauthStateRow>(
    `UPDATE connector_oauth_states
     SET consumed_at = now()
     WHERE state_hash = $1
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING owner_id, provider, code_verifier, redirect_uri, surface`,
    [stateHash],
  );
  return rows[0] ?? null;
}

/* ── Workflow runs ───────────────────────────────────────────────── */

export type WorkflowRunRow = {
  id: string;
  owner_id: string;
  connector_id: string | null;
  surface: Surface;
  action: string;
  proposed_action: Record<string, unknown>;
  confirmed: boolean;
  result: Record<string, unknown> | null;
  status: RunStatus;
  error: string | null;
  created_at: string;
  executed_at: string | null;
};

/**
 * Record the proposal *before* the user is asked.
 *
 * Writing at propose time rather than at execute time is what makes "what did
 * the agent try to do on my behalf" answerable, including for actions that were
 * declined or never confirmed.
 */
export async function recordProposal(
  db: DbLike,
  input: {
    ownerId: string;
    connectorId: string | null;
    surface: Surface;
    action: ActionId;
    proposed: Record<string, unknown>;
    sessionId?: string | null;
  },
): Promise<WorkflowRunRow> {
  const { rows } = await db.query<WorkflowRunRow>(
    `INSERT INTO workflow_runs
       (owner_id, session_id, connector_id, surface, action, proposed_action, status)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::jsonb, 'proposed')
     RETURNING id, owner_id, connector_id, surface, action, proposed_action,
               confirmed, result, status, error, created_at, executed_at`,
    [
      input.ownerId,
      input.sessionId ?? null,
      input.connectorId,
      input.surface,
      input.action,
      JSON.stringify(input.proposed),
    ],
  );
  return rows[0]!;
}

export async function markRunDeclined(
  db: DbLike,
  ownerId: string,
  runId: string,
): Promise<void> {
  await db.query(
    `UPDATE workflow_runs SET status = 'declined'
     WHERE id = $1::uuid AND owner_id = $2 AND status = 'proposed'`,
    [runId, ownerId],
  );
}

export async function markRunExecuted(
  db: DbLike,
  input: {
    ownerId: string;
    runId: string;
    result: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `UPDATE workflow_runs
     SET status = 'executed', confirmed = true, result = $3::jsonb,
         executed_at = now(), error = NULL
     WHERE id = $1::uuid AND owner_id = $2`,
    [input.runId, input.ownerId, JSON.stringify(input.result)],
  );
}

export async function markRunFailed(
  db: DbLike,
  input: { ownerId: string; runId: string; error: string },
): Promise<void> {
  await db.query(
    `UPDATE workflow_runs
     SET status = 'failed', confirmed = true, error = $3, executed_at = now()
     WHERE id = $1::uuid AND owner_id = $2`,
    [input.runId, input.ownerId, input.error.slice(0, 500)],
  );
}

/**
 * Claim a proposed run for execution.
 *
 * The status predicate makes this idempotent: a double-clicked confirm, or a
 * retried request, can only move `proposed → confirmed` once, so an email is
 * never sent twice.
 */
export async function claimRunForExecution(
  db: DbLike,
  ownerId: string,
  runId: string,
): Promise<WorkflowRunRow | null> {
  const { rows } = await db.query<WorkflowRunRow>(
    `UPDATE workflow_runs
     SET status = 'confirmed', confirmed = true
     WHERE id = $1::uuid AND owner_id = $2 AND status = 'proposed'
     RETURNING id, owner_id, connector_id, surface, action, proposed_action,
               confirmed, result, status, error, created_at, executed_at`,
    [runId, ownerId],
  );
  return rows[0] ?? null;
}

export async function listRuns(
  db: DbLike,
  ownerId: string,
  limit = 20,
): Promise<WorkflowRunRow[]> {
  const { rows } = await db.query<WorkflowRunRow>(
    `SELECT id, owner_id, connector_id, surface, action, proposed_action,
            confirmed, result, status, error, created_at, executed_at
     FROM workflow_runs
     WHERE owner_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [ownerId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows;
}
