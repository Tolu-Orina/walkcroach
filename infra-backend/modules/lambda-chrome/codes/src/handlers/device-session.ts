import { createDbClient } from '@walkcroach/db';
import {
  hashDeviceKey,
  mintDeviceKey,
  mintOwnerId,
  signDeviceToken,
} from '../device-token.js';
import { jsonResponse } from '../http.js';
import { assertRateLimit } from '../util.js';

type DeviceSessionBody = {
  deviceKey?: string;
};

export async function handleDeviceSession(
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const limited = assertRateLimit('device_session:global', 120, 60_000);
  if (limited) return jsonResponse(429, { error: limited });

  let body: DeviceSessionBody = {};
  if (rawBody?.trim()) {
    try {
      body = JSON.parse(rawBody) as DeviceSessionBody;
    } catch {
      return jsonResponse(400, { error: 'invalid JSON body' });
    }
  }

  const deviceKey =
    typeof body.deviceKey === 'string' && body.deviceKey.length >= 16
      ? body.deviceKey
      : mintDeviceKey();
  const keyHash = hashDeviceKey(deviceKey);
  const mintedNew = !(
    typeof body.deviceKey === 'string' && body.deviceKey.length >= 16
  );

  const db = createDbClient();
  try {
    const existing = await db.query<{
      owner_id: string;
      upgraded_to_cognito_sub: string | null;
    }>(
      `SELECT owner_id, upgraded_to_cognito_sub
       FROM chrome_device_sessions WHERE device_key_hash = $1`,
      [keyHash],
    );

    let ownerId: string;
    if (existing.rows[0]) {
      // After Cognito upgrade, mint tokens for the Cognito sub so
      // re-minting does not resurrect an empty anon identity.
      ownerId =
        existing.rows[0].upgraded_to_cognito_sub ?? existing.rows[0].owner_id;
      await db.query(
        `UPDATE chrome_device_sessions SET last_seen_at = now() WHERE device_key_hash = $1`,
        [keyHash],
      );
    } else {
      ownerId = mintOwnerId();
      await db.query(
        `INSERT INTO chrome_device_sessions (device_key_hash, owner_id)
         VALUES ($1, $2)`,
        [keyHash, ownerId],
      );
    }

    const token = signDeviceToken(ownerId);
    const response: Record<string, unknown> = {
      accessToken: token.accessToken,
      tokenType: 'Bearer',
      expiresIn: token.expiresIn,
      ownerId,
    };
    if (mintedNew) {
      response.deviceKey = deviceKey;
    }

    return jsonResponse(200, response);
  } finally {
    await db.close();
  }
}
