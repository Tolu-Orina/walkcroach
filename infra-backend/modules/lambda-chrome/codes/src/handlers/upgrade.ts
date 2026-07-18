import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { hashDeviceKey } from '../device-token.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

/**
 * Merge anon:device:* ownership into a Cognito sub after sign-in.
 * Caller must authenticate with Cognito JWT and prove device possession
 * via the same deviceKey that minted the anon session.
 */
export async function handleUpgradeAuth(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.source !== 'jwt') {
    return jsonResponse(400, {
      error: 'Cognito access token required for upgrade',
    });
  }

  const body = parseJsonBody<{ anonOwnerId?: string; deviceKey?: string }>(
    rawBody,
  );
  if ('error' in body && body.error === 'invalid JSON body') {
    return jsonResponse(400, { error: body.error });
  }
  const b = body as { anonOwnerId?: string; deviceKey?: string };
  const anonOwnerId = b.anonOwnerId?.trim();
  const deviceKey = b.deviceKey?.trim();
  if (!anonOwnerId?.startsWith('anon:device:')) {
    return jsonResponse(400, { error: 'anonOwnerId required' });
  }
  if (!deviceKey || deviceKey.length < 16) {
    return jsonResponse(400, { error: 'deviceKey required' });
  }
  if (anonOwnerId === auth.ownerId) {
    return jsonResponse(200, { ok: true, merged: false });
  }

  const db = createDbClient();
  try {
    const keyHash = hashDeviceKey(deviceKey);
    const session = await db.query<{
      owner_id: string;
      upgraded_to_cognito_sub: string | null;
    }>(
      `SELECT owner_id, upgraded_to_cognito_sub
       FROM chrome_device_sessions
       WHERE device_key_hash = $1`,
      [keyHash],
    );
    const row = session.rows[0];
    if (!row || row.owner_id !== anonOwnerId) {
      return jsonResponse(403, {
        error: 'deviceKey does not match anonOwnerId',
      });
    }
    if (
      row.upgraded_to_cognito_sub &&
      row.upgraded_to_cognito_sub !== auth.ownerId
    ) {
      return jsonResponse(409, {
        error: 'device session already linked to another account',
      });
    }

    await db.query('BEGIN');
    await db.query(
      `UPDATE workspaces SET owner_id = $1 WHERE owner_id = $2`,
      [auth.ownerId, anonOwnerId],
    );
    await db.query(
      `UPDATE page_captures SET owner_id = $1 WHERE owner_id = $2`,
      [auth.ownerId, anonOwnerId],
    );
    await db.query(
      `UPDATE chrome_device_sessions
       SET owner_id = $1,
           upgraded_to_cognito_sub = $1,
           last_seen_at = now()
       WHERE device_key_hash = $2`,
      [auth.ownerId, keyHash],
    );
    await db.query('COMMIT');
    metricLog('chrome.auth.cognito_upgrade', { ok: true });
    return jsonResponse(200, { ok: true, merged: true, ownerId: auth.ownerId });
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    const message = err instanceof Error ? err.message : 'upgrade failed';
    console.error('upgrade failed', message);
    return jsonResponse(500, { error: 'upgrade failed' });
  } finally {
    await db.close();
  }
}
