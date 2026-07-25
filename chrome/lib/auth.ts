import {
  exchangeOauthToken,
  refreshCognitoSession,
  upgradeAuth,
  WEB_APP_URL,
} from './api';

const DEVICE_KEY = 'wc_device_key';
const ACCESS_TOKEN = 'wc_access_token';
const OWNER_ID = 'wc_owner_id';
const AUTH_SOURCE = 'wc_auth_source'; // 'device' | 'cognito'
const TOKEN_EXPIRES_AT = 'wc_token_expires_at';
const REFRESH_TOKEN = 'wc_refresh_token';
const ID_TOKEN = 'wc_id_token';
const OAUTH_PENDING = 'wc_oauth_pending';

const EXPIRY_SKEW_MS = 60_000;

export type StoredSession = {
  accessToken: string;
  ownerId: string;
  deviceKey: string;
  source: 'device' | 'cognito';
  /** Epoch ms when Cognito access token should be treated as expired. */
  expiresAt?: number;
};

export type OauthPending = {
  state: string;
  redirectUri: string;
  createdAt: number;
};

let ensureInFlight: Promise<StoredSession> | null = null;

export function chromeRedirectUri(): string {
  return `chrome-extension://${chrome.runtime.id}/auth.html`;
}

export function generateOAuthState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isFresh(expiresAt: number | undefined): boolean {
  return Boolean(expiresAt && expiresAt > Date.now() + EXPIRY_SKEW_MS);
}

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

async function loadRefreshToken(): Promise<string | null> {
  const data = await chrome.storage.local.get([REFRESH_TOKEN]);
  const rt = data[REFRESH_TOKEN];
  return typeof rt === 'string' && rt.trim() ? rt.trim() : null;
}

async function tryRefreshCognito(
  existing: StoredSession,
): Promise<StoredSession | null> {
  const refreshToken = await loadRefreshToken();
  if (!refreshToken) return null;
  try {
    const tokens = await refreshCognitoSession(refreshToken);
    const cognitoToken = (tokens.id_token ?? tokens.access_token).trim();
    if (!cognitoToken) return null;
    const session: StoredSession = {
      deviceKey: existing.deviceKey,
      accessToken: cognitoToken,
      ownerId: existing.ownerId,
      source: 'cognito',
      expiresAt:
        Date.now() + Math.max(60, tokens.expires_in ?? 55 * 60) * 1000,
    };
    await saveSession(session);
    if (tokens.refresh_token) {
      await chrome.storage.local.set({ [REFRESH_TOKEN]: tokens.refresh_token });
    }
    if (tokens.id_token) {
      await chrome.storage.local.set({ [ID_TOKEN]: tokens.id_token });
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Device session for try-first. Cognito access tokens replace the Bearer token
 * after upgrade; deviceKey is retained so we can re-mint if needed.
 *
 * Does not remint on every bootstrap — only when missing or near expiry —
 * to avoid storage.onChanged ↔ bootstrap loops.
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
      if (isFresh(existing.expiresAt)) {
        return existing;
      }
      const refreshed = await tryRefreshCognito(existing);
      if (refreshed) return refreshed;
      // Refresh failed — fall through to device remint (keep deviceKey).
    } else if (existing && isFresh(existing.expiresAt)) {
      return existing;
    }

    if (existing) {
      try {
        const minted = await createSession(existing.deviceKey);
        const session: StoredSession = {
          deviceKey: existing.deviceKey,
          accessToken: minted.accessToken,
          ownerId: minted.ownerId,
          source: 'device',
          expiresAt:
            Date.now() + (minted.expiresIn ?? 30 * 24 * 3600) * 1000,
        };
        await saveSession(session);
        if (existing.source === 'cognito') {
          await chrome.storage.local.remove([REFRESH_TOKEN, ID_TOKEN]);
        }
        return session;
      } catch {
        // fall through to mint
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
 * Open WalkCroach Web /connect/chrome (same pattern as IDE).
 * Returns after the connect tab is opened; completion happens on auth.html.
 */
export async function startWebSignIn(webAppUrl = WEB_APP_URL): Promise<string> {
  if (!webAppUrl) {
    throw new Error('WalkCroach Web URL is not configured.');
  }
  const state = generateOAuthState();
  const redirectUri = chromeRedirectUri();
  const pending: OauthPending = {
    state,
    redirectUri,
    createdAt: Date.now(),
  };
  await chrome.storage.session.set({ [OAUTH_PENDING]: pending });

  const authUrl = new URL('/connect/chrome', webAppUrl.replace(/\/$/, ''));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  await chrome.tabs.create({ url: authUrl.toString() });
  return authUrl.toString();
}

/**
 * Finish Web → Chrome handoff on auth.html (code+state only).
 * Merges anon device ownership via /auth/upgrade when still on anon:device:*.
 */
export async function completeWebSignIn(
  code: string,
  state: string,
): Promise<StoredSession> {
  const raw = await chrome.storage.session.get(OAUTH_PENDING);
  const pending = raw[OAUTH_PENDING] as OauthPending | undefined;
  if (!pending?.state || !pending.redirectUri) {
    throw new Error('Sign-in session expired. Open Trust and try again.');
  }
  if (pending.state !== state) {
    throw new Error('Invalid callback (state mismatch).');
  }
  if (Date.now() - pending.createdAt > 5 * 60_000) {
    await chrome.storage.session.remove(OAUTH_PENDING);
    throw new Error('Sign-in timed out. Open Trust and try again.');
  }

  const tokens = await exchangeOauthToken({
    code,
    state,
    redirectUri: pending.redirectUri,
  });

  const existing = await loadSession();
  if (!existing?.deviceKey || !existing.ownerId) {
    throw new Error('No device session to upgrade. Reopen the side panel first.');
  }

  // Prefer ID token (matches Web/IDE); fall back to access_token.
  const cognitoToken = (
    tokens.id_token ??
    tokens.access_token
  ).trim();
  if (!cognitoToken) {
    throw new Error('Connect response missing tokens.');
  }

  // Re-connect after prior Cognito upgrade: ownerId is already the Cognito sub.
  // Upgrade still verifies deviceKey possession for already-linked devices.
  const result = await upgradeAuth(
    cognitoToken,
    existing.ownerId,
    existing.deviceKey,
  );

  const expiresAt =
    Date.now() +
    Math.max(60, tokens.expires_in ?? 55 * 60) * 1000;

  const session: StoredSession = {
    deviceKey: existing.deviceKey,
    accessToken: cognitoToken,
    ownerId: result.ownerId ?? existing.ownerId,
    source: 'cognito',
    expiresAt,
  };
  await saveSession(session);
  await chrome.storage.local.set({
    [REFRESH_TOKEN]: tokens.refresh_token ?? null,
    [ID_TOKEN]: tokens.id_token ?? cognitoToken,
  });
  await chrome.storage.session.remove(OAUTH_PENDING);
  return session;
}

/**
 * After Cognito sign-in (paste fallback): merge anon workspaces/captures.
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

/** Drop Cognito credentials; keep deviceKey so a fresh device session can mint. */
export async function signOutToDevice(
  createSession: (deviceKey?: string) => Promise<{
    accessToken: string;
    ownerId: string;
    deviceKey?: string;
    expiresIn?: number;
  }>,
): Promise<StoredSession> {
  const existing = await loadSession();
  const deviceKey = existing?.deviceKey ?? mintClientDeviceKey();
  await chrome.storage.local.remove([REFRESH_TOKEN, ID_TOKEN]);
  const minted = await createSession(deviceKey);
  const session: StoredSession = {
    deviceKey: minted.deviceKey ?? deviceKey,
    accessToken: minted.accessToken,
    ownerId: minted.ownerId,
    source: 'device',
    expiresAt: Date.now() + (minted.expiresIn ?? 30 * 24 * 3600) * 1000,
  };
  await saveSession(session);
  return session;
}
