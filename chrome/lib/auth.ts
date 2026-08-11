import {
  exchangeOauthToken,
  refreshCognitoSession,
  revokeCognitoSession,
  upgradeAuth,
  WEB_APP_URL,
} from './api';
import { classifyCognitoJwt } from './cognito-jwt';
import { generatePkce, PKCE_METHOD } from './pkce';

const DEVICE_KEY = 'wc_device_key';
const ACCESS_TOKEN = 'wc_access_token';
const OWNER_ID = 'wc_owner_id';
const AUTH_SOURCE = 'wc_auth_source'; // 'device' | 'cognito'
const TOKEN_EXPIRES_AT = 'wc_token_expires_at';
const REFRESH_TOKEN = 'wc_refresh_token';
const ID_TOKEN = 'wc_id_token';
/** Real Cognito access_token (for `@walkcroach/sdk` / IDE `/v1`). */
const COGNITO_ACCESS_TOKEN = 'wc_cognito_access_token';
const OAUTH_PENDING = 'wc_oauth_pending';

async function storeCognitoTokenPair(tokens: {
  access_token?: string;
  id_token?: string;
}): Promise<void> {
  const patch: Record<string, string | null> = {};
  const access = tokens.access_token?.trim();
  const id = tokens.id_token?.trim();
  // Never put an id JWT into the SDK access slot.
  if (access && classifyCognitoJwt(access) !== 'id') {
    patch[COGNITO_ACCESS_TOKEN] = access;
  }
  if (id) {
    patch[ID_TOKEN] = id;
  } else if (access && classifyCognitoJwt(access) === 'id') {
    patch[ID_TOKEN] = access;
  }
  if (Object.keys(patch).length) {
    await chrome.storage.local.set(patch);
  }
}

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
  /**
   * PKCE verifier. Lives in `chrome.storage.session` (cleared when the browser
   * closes), never `storage.local`, and never travels to Web — only its S256
   * challenge does.
   */
  codeVerifier: string;
};

/** Outcome of starting sign-in — see `startWebSignIn`. */
export type SignInOutcome =
  /** launchWebAuthFlow ran to completion inside the panel. */
  | { kind: 'completed'; session: StoredSession }
  /** Fell back to a tab; auth.html finishes the exchange. */
  | { kind: 'delegated'; url: string };

let ensureInFlight: Promise<StoredSession> | null = null;

/**
 * Extension ID, validated.
 *
 * `chrome.runtime.id` being empty or malformed used to produce redirect URIs like
 * `chrome-extension://invalid/auth.html`, which the BFF allowlist rejects with an
 * opaque error. Fail loudly and early instead.
 */
export function extensionId(): string {
  const id = chrome.runtime?.id;
  if (!id || !/^[a-p]{32}$/.test(id)) {
    throw new Error(
      'Extension ID is unavailable or non-standard. Reload the extension; if you are running unpacked, pin it with a manifest "key" (see VERSIONING.md).',
    );
  }
  return id;
}

/** Legacy tab-redirect target. Requires auth.html in web_accessible_resources. */
export function chromeRedirectUri(): string {
  return `chrome-extension://${extensionId()}/auth.html`;
}

/**
 * Preferred redirect (Phase B1): Chrome intercepts this host during
 * launchWebAuthFlow, so nothing is ever navigated to and no web-accessible
 * resource is involved. Cancellation is observable, unlike the tab flow.
 */
export function identityRedirectUri(): string {
  return `https://${extensionId()}.chromiumapp.org/auth`;
}

function supportsLaunchWebAuthFlow(): boolean {
  return typeof chrome.identity?.launchWebAuthFlow === 'function';
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
    await storeCognitoTokenPair(tokens);
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
          await chrome.storage.local.remove([
            REFRESH_TOKEN,
            ID_TOKEN,
            COGNITO_ACCESS_TOKEN,
          ]);
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

/** Build the /connect/chrome URL for a given redirect target. */
export function buildConnectUrl(
  webAppUrl: string,
  state: string,
  redirectUri: string,
  codeChallenge: string,
): string {
  const authUrl = new URL('/connect/chrome', webAppUrl.replace(/\/$/, ''));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', PKCE_METHOD);
  return authUrl.toString();
}

/** Pull `code` + `state` out of the URL Chrome hands back from the auth flow. */
export function parseAuthCallback(
  callbackUrl: string,
): { code: string; state: string } {
  const parsed = new URL(callbackUrl);
  // Cognito-style errors can arrive in either the query or the fragment.
  const params = new URLSearchParams(parsed.search);
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const err = params.get('error') ?? hash.get('error');
  if (err) throw new Error(`Sign-in failed: ${err}`);
  const code = params.get('code') ?? hash.get('code');
  const state = params.get('state') ?? hash.get('state');
  if (!code || !state) {
    throw new Error('Sign-in did not return a connect code. Please try again.');
  }
  return { code, state };
}

/**
 * Start sign-in against WalkCroach Web /connect/chrome (same custom Cognito
 * pages as Web and IDE — no Hosted UI, no Amplify).
 *
 * Prefers `chrome.identity.launchWebAuthFlow` (Phase B1): the redirect lands on
 * `https://<id>.chromiumapp.org/auth`, which Chrome intercepts, so we never
 * depend on a navigation into an extension page. Falls back to the tab +
 * auth.html flow (kept working by the Phase A4 web_accessible_resources fix)
 * where `identity` is unavailable.
 */
export async function startWebSignIn(
  webAppUrl = WEB_APP_URL,
): Promise<SignInOutcome> {
  if (!webAppUrl) {
    throw new Error('WalkCroach Web URL is not configured.');
  }
  const state = generateOAuthState();
  // Generated once for both branches. WebCrypto's digest is async, which is the
  // only reason this differs in shape from the IDE and CLI implementations.
  const { verifier, challenge } = await generatePkce();

  if (supportsLaunchWebAuthFlow()) {
    const redirectUri = identityRedirectUri();
    const pending: OauthPending = {
      state,
      redirectUri,
      createdAt: Date.now(),
      codeVerifier: verifier,
    };
    await chrome.storage.session.set({ [OAUTH_PENDING]: pending });

    let callbackUrl: string | undefined;
    try {
      callbackUrl = await chrome.identity.launchWebAuthFlow({
        url: buildConnectUrl(webAppUrl, state, redirectUri, challenge),
        interactive: true,
      });
    } catch (err) {
      await chrome.storage.session.remove(OAUTH_PENDING);
      const message = err instanceof Error ? err.message : String(err);
      // Chrome's copy for "user closed the window" varies; normalise it.
      if (/did not approve|canceled|cancelled|closed/i.test(message)) {
        throw new Error('Sign-in cancelled.');
      }
      throw new Error(message || 'Sign-in failed.');
    }
    if (!callbackUrl) {
      await chrome.storage.session.remove(OAUTH_PENDING);
      throw new Error('Sign-in cancelled.');
    }

    const { code, state: returnedState } = parseAuthCallback(callbackUrl);
    const session = await completeWebSignIn(code, returnedState);
    return { kind: 'completed', session };
  }

  const redirectUri = chromeRedirectUri();
  const pending: OauthPending = {
    state,
    redirectUri,
    createdAt: Date.now(),
    codeVerifier: verifier,
  };
  await chrome.storage.session.set({ [OAUTH_PENDING]: pending });
  const url = buildConnectUrl(webAppUrl, state, redirectUri, challenge);
  await chrome.tabs.create({ url });
  return { kind: 'delegated', url };
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
    throw new Error('Sign-in session expired. Open Account & Sites and try again.');
  }
  if (pending.state !== state) {
    throw new Error('Invalid callback (state mismatch).');
  }
  if (Date.now() - pending.createdAt > 5 * 60_000) {
    await chrome.storage.session.remove(OAUTH_PENDING);
    throw new Error('Sign-in timed out. Open Account & Sites and try again.');
  }

  const tokens = await exchangeOauthToken({
    code,
    state,
    redirectUri: pending.redirectUri,
    codeVerifier: pending.codeVerifier,
  });

  const existing = await loadSession();
  if (!existing?.deviceKey || !existing.ownerId) {
    throw new Error('No device session to upgrade. Reopen the side panel first.');
  }

  // Prefer ID token for BFF Bearer (matches Web/IDE); keep real access separate.
  const idToken = (tokens.id_token ?? '').trim();
  const accessToken = (tokens.access_token ?? '').trim();
  const cognitoToken = (idToken || accessToken).trim();
  if (!cognitoToken) {
    throw new Error('Connect response missing tokens.');
  }
  if (!accessToken) {
    throw new Error(
      'Connect response missing Cognito access token. Sign in again on WalkCroach Web.',
    );
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
  });
  await storeCognitoTokenPair({
    access_token: accessToken,
    id_token: idToken || cognitoToken,
  });
  await chrome.storage.session.remove(OAUTH_PENDING);
  return session;
}

/**
 * Dev/test helper: upgrade a device session with a raw Cognito JWT.
 * Product UI uses `startWebSignIn` only (same Web `/connect/chrome` flow as IDE).
 *
 * Stores access vs id tokens by JWT `token_use` — never copies one JWT into both
 * slots (that blurred BFF Bearer vs SDK `/v1` credentials).
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
  const kind = classifyCognitoJwt(cognitoAccessToken);
  if (kind === 'access') {
    await storeCognitoTokenPair({ access_token: cognitoAccessToken });
  } else {
    // id or opaque: BFF bearer only. SDK requires a real access_token from PKCE.
    await storeCognitoTokenPair({ id_token: cognitoAccessToken });
  }
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

  // Best-effort Cognito revoke before clearing local slots (matches Web).
  if (existing?.source === 'cognito') {
    const data = await chrome.storage.local.get([
      COGNITO_ACCESS_TOKEN,
      REFRESH_TOKEN,
    ]);
    const accessToken = (data[COGNITO_ACCESS_TOKEN] as string | undefined)?.trim();
    const refreshToken = (data[REFRESH_TOKEN] as string | undefined)?.trim();
    if (accessToken || refreshToken) {
      try {
        await revokeCognitoSession({ accessToken, refreshToken });
      } catch {
        // Local sign-out must still succeed if Cognito is unreachable.
      }
    }
  }

  await chrome.storage.local.remove([
    REFRESH_TOKEN,
    ID_TOKEN,
    COGNITO_ACCESS_TOKEN,
  ]);
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
