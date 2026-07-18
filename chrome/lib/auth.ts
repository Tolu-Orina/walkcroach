import { upgradeAuth } from './api';

const DEVICE_KEY = 'wc_device_key';
const ACCESS_TOKEN = 'wc_access_token';
const OWNER_ID = 'wc_owner_id';
const AUTH_SOURCE = 'wc_auth_source'; // 'device' | 'cognito'
const TOKEN_EXPIRES_AT = 'wc_token_expires_at';

export type StoredSession = {
  accessToken: string;
  ownerId: string;
  deviceKey: string;
  source: 'device' | 'cognito';
  /** Epoch ms when Cognito access token should be treated as expired. */
  expiresAt?: number;
};

let ensureInFlight: Promise<StoredSession> | null = null;

export async function loadSession(): Promise<StoredSession | null> {
  const data = await chrome.storage.local.get([
    DEVICE_KEY,
    ACCESS_TOKEN,
    OWNER_ID,
    AUTH_SOURCE,
    TOKEN_EXPIRES_AT,
  ]);
  const deviceKey = data[DEVICE_KEY] as string | undefined;
  const accessToken = data[ACCESS_TOKEN] as string | undefined;
  const ownerId = data[OWNER_ID] as string | undefined;
  const source = (data[AUTH_SOURCE] as 'device' | 'cognito' | undefined) ?? 'device';
  const expiresAt = data[TOKEN_EXPIRES_AT] as number | undefined;
  if (!deviceKey || !accessToken || !ownerId) return null;
  return { deviceKey, accessToken, ownerId, source, expiresAt };
}

export async function saveSession(session: StoredSession): Promise<void> {
  await chrome.storage.local.set({
    [DEVICE_KEY]: session.deviceKey,
    [ACCESS_TOKEN]: session.accessToken,
    [OWNER_ID]: session.ownerId,
    [AUTH_SOURCE]: session.source,
    [TOKEN_EXPIRES_AT]: session.expiresAt ?? null,
  });
}

function mintClientDeviceKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Device session for try-first. Cognito access tokens replace the Bearer token
 * after upgrade; deviceKey is retained so we can re-mint if needed.
 */
export async function ensureDeviceSession(
  createSession: (deviceKey?: string) => Promise<{
    accessToken: string;
    ownerId: string;
    deviceKey?: string;
    expiresIn?: number;
  }>,
): Promise<StoredSession> {
  if (ensureInFlight) return ensureInFlight;

  const run = (async () => {
    const existing = await loadSession();
    if (existing?.source === 'cognito') {
      if (
        existing.expiresAt &&
        existing.expiresAt < Date.now() + 60_000
      ) {
        // Access token expired / about to — fall back to device session so
        // the user can still use Chrome until they paste a fresh Cognito token.
        const refreshed = await createSession(existing.deviceKey);
        const session: StoredSession = {
          deviceKey: existing.deviceKey,
          accessToken: refreshed.accessToken,
          ownerId: refreshed.ownerId,
          source: 'device',
          expiresAt: Date.now() + (refreshed.expiresIn ?? 30 * 24 * 3600) * 1000,
        };
        await saveSession(session);
        return session;
      }
      return existing;
    }

    if (existing) {
      try {
        const refreshed = await createSession(existing.deviceKey);
        const session: StoredSession = {
          deviceKey: existing.deviceKey,
          accessToken: refreshed.accessToken,
          ownerId: refreshed.ownerId,
          source: 'device',
          expiresAt: Date.now() + (refreshed.expiresIn ?? 30 * 24 * 3600) * 1000,
        };
        await saveSession(session);
        return session;
      } catch {
        // fall through
      }
    }

    const clientKey = existing?.deviceKey ?? mintClientDeviceKey();
    const minted = await createSession(clientKey);
    const session: StoredSession = {
      deviceKey: minted.deviceKey ?? clientKey,
      accessToken: minted.accessToken,
      ownerId: minted.ownerId,
      source: 'device',
      expiresAt: Date.now() + (minted.expiresIn ?? 30 * 24 * 3600) * 1000,
    };
    await saveSession(session);
    return session;
  })();

  ensureInFlight = run.finally(() => {
    if (ensureInFlight === run) ensureInFlight = null;
  });

  return ensureInFlight;
}

/**
 * After Cognito sign-in: merge anon workspaces/captures onto Cognito sub,
 * then store Cognito access token for subsequent API calls (NFR-C06 / PA.19).
 */
export async function upgradeToCognito(
  cognitoAccessToken: string,
): Promise<StoredSession> {
  const existing = await loadSession();
  if (!existing) {
    throw new Error('no device session to upgrade');
  }
  const result = await upgradeAuth(
    cognitoAccessToken,
    existing.ownerId,
    existing.deviceKey,
  );
  // Cognito access tokens are typically ~1h; store a conservative expiry.
  const expiresAt = Date.now() + 55 * 60 * 1000;
  const session: StoredSession = {
    deviceKey: existing.deviceKey,
    accessToken: cognitoAccessToken,
    ownerId: result.ownerId ?? existing.ownerId,
    source: 'cognito',
    expiresAt,
  };
  await saveSession(session);
  return session;
}
