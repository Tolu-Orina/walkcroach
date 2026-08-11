/**
 * API key management: `/v1/keys`.
 *
 * These routes are **Cognito-only**. An API key cannot mint, list, or revoke API
 * keys — otherwise a single leaked key would let an attacker issue themselves
 * fresh credentials and survive the revocation of the one that leaked. Key
 * lifecycle stays behind interactive sign-in.
 */
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import {
  ALL_SCOPES,
  listApiKeys,
  mintApiKey,
  revokeApiKey,
  type ApiKeyScope,
} from '../api-keys.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';
import {
  aggregateApiKeyUsage,
  SDK_KEY_USAGE_ACTION_SQL,
} from './keys-usage.js';

function requireInteractive(
  auth: AuthContext,
): { error: string; status: number } | null {
  if (auth.source === 'apikey') {
    return {
      status: 403,
      error:
        'API keys cannot manage API keys. Sign in to create or revoke credentials.',
    };
  }
  return null;
}

/** POST /v1/keys — Body: { name, scopes?, expiresInDays? } */
export async function handleCreateApiKey(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireInteractive(auth);
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const parsed = parseJsonBody<{
    name?: string;
    scopes?: string[];
    expiresInDays?: number;
  }>(rawBody);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
  const body = parsed.data;

  const name = body.name?.trim();
  if (!name) return jsonResponse(400, { error: 'name is required' });
  if (name.length > 100) return jsonResponse(400, { error: 'name exceeds 100 characters' });

  let scopes: ApiKeyScope[] = ['memory:read'];
  if (Array.isArray(body.scopes) && body.scopes.length > 0) {
    const invalid = body.scopes.filter(
      (s) => !(ALL_SCOPES as readonly string[]).includes(String(s)),
    );
    if (invalid.length > 0) {
      return jsonResponse(400, {
        error: `unknown scope(s): ${invalid.join(', ')}. Valid: ${ALL_SCOPES.join(', ')}`,
      });
    }
    scopes = body.scopes as ApiKeyScope[];
  }

  let expiresAt: Date | null = null;
  if (body.expiresInDays !== undefined) {
    const days = Number(body.expiresInDays);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return jsonResponse(400, { error: 'expiresInDays must be between 1 and 365' });
    }
    expiresAt = new Date(Date.now() + days * 86_400_000);
  }

  const db = createDbClient();
  try {
    const minted = await mintApiKey({
      db,
      ownerId: auth.ownerId,
      name,
      scopes,
      expiresAt,
    });
    metricLog('sdk.keys.create', { scopes: scopes.join('+') });
    return jsonResponse(201, {
      id: minted.id,
      name,
      // The only response that will ever contain this value.
      key: minted.key,
      prefix: minted.prefix,
      scopes: minted.scopes,
      expiresAt: expiresAt?.toISOString() ?? null,
      warning: 'Store this key now — it cannot be retrieved again.',
    });
  } finally {
    await db.close();
  }
}

/** GET /v1/keys */
export async function handleListApiKeys(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireInteractive(auth);
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const db = createDbClient();
  try {
    return jsonResponse(200, { keys: await listApiKeys({ db, ownerId: auth.ownerId }) });
  } finally {
    await db.close();
  }
}

/** DELETE /v1/keys/:id */
export async function handleRevokeApiKey(
  auth: AuthContext,
  id: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireInteractive(auth);
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const db = createDbClient();
  try {
    const ok = await revokeApiKey({ db, ownerId: auth.ownerId, id });
    if (!ok) {
      // 404 for "not yours" as well as "no such key" — do not confirm existence.
      return jsonResponse(404, { error: 'key not found' });
    }
    metricLog('sdk.keys.revoke', { ok: true });
    return jsonResponse(200, { ok: true, id });
  } finally {
    await db.close();
  }
}

/**
 * GET /v1/keys/usage — per-key + by-action aggregates from usage_ledger (P3).
 * Cognito-only. Rows without metadata.keyId (interactive Cognito calls) are omitted.
 * SKU A: shared monthly pool — response includes invoice explainability metadata.
 */
export async function handleApiKeyUsage(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireInteractive(auth);
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const db = createDbClient();
  try {
    const { rows } = await db.query<{
      key_id: string;
      action_type: string;
      count: string;
      credits: string;
    }>(
      `SELECT metadata->>'keyId' AS key_id,
              action_type,
              count(*)::string AS count,
              coalesce(sum(credits), 0)::string AS credits
         FROM usage_ledger
        WHERE owner_id = $1
          AND action_type IN (${SDK_KEY_USAGE_ACTION_SQL})
          AND metadata->>'keyId' IS NOT NULL
          AND created_at >= date_trunc('month', now())
        GROUP BY 1, 2`,
      [auth.ownerId],
    );

    return jsonResponse(200, aggregateApiKeyUsage(rows));
  } finally {
    await db.close();
  }
}
