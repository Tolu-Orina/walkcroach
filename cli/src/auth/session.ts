/**
 * Browser sign-in for the CLI (C1.1b, C1.1c).
 *
 * A Web handoff carrying a one-time code, protected by PKCE (RFC 7636):
 *
 *   1. bind 127.0.0.1:0                     — before anything is published
 *   2. generate a PKCE verifier; keep it in memory
 *   3. open {webAppUrl}/connect/cli?state&redirect_uri&code_challenge
 *   4. Web reuses the ordinary sign-in, then mints a one-time code
 *   5. Web redirects to the loopback URI with ?code&state — never a token
 *   6. CLI verifies state, exchanges code + verifier at POST /ide/v1/oauth/token
 *   7. tokens land under the same SECRET_KEYS the IDE uses
 *
 * Step 5 is why the machinery is worth it: a token never appears in a URL, a
 * shell history, or a terminal scrollback. Step 2 is why an intercepted *code*
 * is worthless — the verifier that redeems it never leaves this process, so
 * another local process winning the port race gains nothing it can spend.
 */
import { spawn } from 'node:child_process';
import { SECRET_KEYS, generatePkce, PKCE_METHOD } from '@walkcroach/agent-engine';
import { resolveApiBaseUrl, getSecret, setSecret } from '../lib/config.js';
import { ApiError, NetworkError } from '../lib/exit-codes.js';
import { startLoopbackListener } from './loopback.js';

export type CognitoTokens = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
};

/**
 * Where the sign-in page lives.
 *
 * Derived from the API base by default so a self-hosted deployment does not
 * need a second setting, and overridable for the (common) case where Web and
 * the API sit on different hosts.
 */
export async function resolveWebAppUrl(): Promise<string> {
  const explicit = process.env.WALKCROACH_WEB_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const api = (await resolveApiBaseUrl()).value;
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(api)) {
    // Local development: the Vite dev server, not the BFF port.
    return 'http://localhost:5173';
  }
  return 'https://walkcroach.conquerorfoundation.com';
}

export function buildAuthorizeUrl(params: {
  webAppUrl: string;
  state: string;
  redirectUri: string;
  /** PKCE challenge (S256). The verifier never appears in this URL. */
  codeChallenge: string;
}): string {
  const url = new URL('/connect/cli', params.webAppUrl);
  url.searchParams.set('state', params.state);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', PKCE_METHOD);
  return url.toString();
}

/**
 * Open a URL in the user's browser, without ever letting it reach a shell.
 *
 * The URL is attacker-influenceable only via configuration, but `spawn` with
 * an argument array (never `exec` with an interpolated string) means a URL
 * containing shell metacharacters is an argument, not a command.
 */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? // `start` is a cmd builtin; the empty string is the window title,
          // which `start` would otherwise take from a quoted URL.
          ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], {
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {
      /* Reported by the caller's --no-browser hint, not fatal here. */
    });
    child.unref();
  } catch {
    // A machine without a browser opener is exactly what --no-browser is for.
  }
}

/** Exchange the one-time code for tokens (public endpoint, no bearer). */
export async function exchangeAuthCode(params: {
  code: string;
  state: string;
  redirectUri: string;
  /** PKCE verifier. Proves this process is the one that began the flow. */
  codeVerifier: string;
}): Promise<CognitoTokens> {
  const base = (await resolveApiBaseUrl()).value;
  let res: Response;
  try {
    res = await fetch(`${base}/ide/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    throw new NetworkError(
      `Cannot reach the WalkCroach API at ${base} (${cause?.code ?? cause?.message ?? 'unknown'})`,
    );
  }
  const data = (await res.json().catch(() => ({}))) as CognitoTokens & {
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new ApiError(data.error || `Token exchange failed (${res.status})`, res.status);
  }
  return data;
}

/** Persist under the same logical keys the IDE uses, so the two interoperate. */
export async function storeTokens(tokens: CognitoTokens): Promise<void> {
  await setSecret(SECRET_KEYS.cognitoAccessToken, tokens.access_token);
  if (tokens.refresh_token) {
    await setSecret(SECRET_KEYS.cognitoRefreshToken, tokens.refresh_token);
  }
  if (tokens.id_token) {
    await setSecret(SECRET_KEYS.cognitoIdToken, tokens.id_token);
  }
  if (tokens.expires_in) {
    await setSecret(
      SECRET_KEYS.cognitoExpiresAt,
      String(Date.now() + tokens.expires_in * 1000),
    );
  }
}

/**
 * Refresh via Cognito InitiateAuth with the SPA client — the same call the IDE
 * makes (`ide/src/auth/pkce.ts:refreshWithSpaClient`, which is current, not
 * deprecated).
 */
export async function refreshAccessToken(params: {
  region: string;
  clientId: string;
  refreshToken: string;
}): Promise<CognitoTokens> {
  const endpoint = `https://cognito-idp.${params.region}.amazonaws.com/`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: params.clientId,
      AuthParameters: { REFRESH_TOKEN: params.refreshToken },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    AuthenticationResult?: {
      AccessToken?: string;
      IdToken?: string;
      ExpiresIn?: number;
    };
    message?: string;
    __type?: string;
  };
  if (!res.ok || !data.AuthenticationResult?.AccessToken) {
    throw new ApiError(
      `Cognito token refresh failed: ${data.message ?? data.__type ?? 'unknown'}`,
      res.status,
    );
  }
  return {
    access_token: data.AuthenticationResult.AccessToken,
    id_token: data.AuthenticationResult.IdToken,
    refresh_token: params.refreshToken,
    expires_in: data.AuthenticationResult.ExpiresIn,
  };
}

/** True when the stored access token is absent or within 60s of expiry. */
export async function accessTokenIsStale(): Promise<boolean> {
  const token = await getSecret(SECRET_KEYS.cognitoAccessToken);
  if (!token) return true;
  const expiresAt = Number(await getSecret(SECRET_KEYS.cognitoExpiresAt));
  if (!Number.isFinite(expiresAt) || expiresAt === 0) return false;
  return Date.now() > expiresAt - 60_000;
}

export type SignInResult = {
  redirectUri: string;
  authorizeUrl: string;
  tokens: CognitoTokens;
};

/**
 * The whole browser flow.
 *
 * `onUrl` receives the authorize URL before the wait begins, so the caller can
 * print it — which is the entire implementation of `--no-browser`.
 */
export async function browserSignIn(opts?: {
  openBrowser?: boolean;
  timeoutMs?: number;
  onUrl?: (url: string) => void;
}): Promise<SignInResult> {
  // Bind first: whoever holds the port owns the callback, and we must be that
  // process before the URL exists anywhere outside this function.
  const listener = await startLoopbackListener({ timeoutMs: opts?.timeoutMs });
  // Held in memory for the lifetime of this call only. It is never written to
  // disk, never sent to Web, and never appears in the authorize URL — which is
  // what makes an intercepted code useless to anyone else on the machine.
  const { verifier, challenge } = generatePkce();
  try {
    const webAppUrl = await resolveWebAppUrl();
    const authorizeUrl = buildAuthorizeUrl({
      webAppUrl,
      state: listener.state,
      redirectUri: listener.redirectUri,
      codeChallenge: challenge,
    });
    opts?.onUrl?.(authorizeUrl);
    if (opts?.openBrowser !== false) openBrowser(authorizeUrl);

    const code = await listener.waitForCode();
    const tokens = await exchangeAuthCode({
      code,
      state: listener.state,
      redirectUri: listener.redirectUri,
      codeVerifier: verifier,
    });
    await storeTokens(tokens);
    return { redirectUri: listener.redirectUri, authorizeUrl, tokens };
  } finally {
    await listener.close();
  }
}
