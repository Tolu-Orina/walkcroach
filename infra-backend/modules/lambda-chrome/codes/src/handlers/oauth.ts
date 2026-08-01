import { createHash, randomBytes } from 'node:crypto';
import { createDbClient } from '@walkcroach/db';
import { verifyPkce, PKCE_METHOD } from '@walkcroach/agent-harness';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

/**
 * Chrome extension redirects only.
 * Must stay in sync with web ConnectChromePage + chrome client (lib/auth.ts).
 *
 * Two accepted shapes:
 *  - `https://<id>.chromiumapp.org/auth` — chrome.identity.launchWebAuthFlow
 *    (preferred; Chrome intercepts the navigation, nothing is ever loaded).
 *  - `chrome-extension://<id>/auth.html` — legacy tab redirect, retained as a
 *    rollout fallback for builds without the `identity` permission.
 *
 * Both bind the redirect to a 32-char [a-p] extension ID, so a third party
 * cannot register an arbitrary destination for a one-time connect code.
 */
export const CHROME_REDIRECT_PATTERN =
  /^(?:chrome-extension:\/\/[a-p]{32}\/auth\.html|https:\/\/[a-p]{32}\.chromiumapp\.org\/auth)$/;

const CODE_TTL_MS = 5 * 60_000;

function newAuthCode(): string {
  return randomBytes(32).toString('base64url');
}

function stateFingerprint(state: string): string {
  return createHash('sha256').update(state).digest('hex').slice(0, 32);
}

/**
 * POST /chrome/v1/oauth/session-code
 * Authenticated (Web session Bearer = Cognito ID token).
 */
export async function handleCreateSessionCode(
  auth: AuthContext,
  rawBody: string | undefined,
  sessionBearer: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    state?: string;
    redirectUri?: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt?: number;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }>(rawBody);
  if ('error' in parsed && parsed.error === 'invalid JSON body') {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed as {
    state?: string;
    redirectUri?: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt?: number;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  };
  const state = body.state?.trim();
  const redirectUri = body.redirectUri?.trim();
  const codeChallenge = body.codeChallenge?.trim();
  const codeChallengeMethod = body.codeChallengeMethod?.trim();
  if (!state || state.length < 8) {
    return jsonResponse(400, { error: 'state is required' });
  }
  if (!redirectUri || !CHROME_REDIRECT_PATTERN.test(redirectUri)) {
    return jsonResponse(400, { error: 'redirectUri is not allowed' });
  }
  // PKCE is mandatory, not negotiated. No client has ever shipped without it, so
  // there is no legacy caller to tolerate — and a code issued without a challenge
  // could later be exchanged by anyone who intercepted it.
  if (!codeChallenge) {
    return jsonResponse(400, { error: 'codeChallenge is required' });
  }
  if (codeChallengeMethod !== PKCE_METHOD) {
    // 'plain' is refused deliberately: under it the challenge IS the verifier, so
    // it proves nothing to anyone who saw the authorize URL.
    return jsonResponse(400, {
      error: `codeChallengeMethod must be ${PKCE_METHOD}`,
    });
  }
  if (sessionBearer.startsWith('dev:')) {
    return jsonResponse(400, {
      error: 'Dev tokens cannot be used for Chrome connect',
    });
  }

  const code = newAuthCode();
  const now = Date.now();
  const tokenExpiresAt = new Date(
    Number.isFinite(body.expiresAt) && (body.expiresAt as number) > now
      ? (body.expiresAt as number)
      : now + 3600_000,
  );
  const codeExpiresAt = new Date(now + CODE_TTL_MS);

  const db = createDbClient();
  try {
    await db.query(
      `DELETE FROM chrome_auth_codes
       WHERE code_expires_at < now() OR consumed_at IS NOT NULL`,
    );
    await db.query(
      `INSERT INTO chrome_auth_codes (
         code, state, redirect_uri, owner_id,
         access_token, refresh_token, id_token,
         token_expires_at, code_expires_at,
         code_challenge, code_challenge_method
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        code,
        stateFingerprint(state),
        redirectUri,
        auth.ownerId,
        sessionBearer,
        body.refreshToken?.trim() || null,
        body.idToken?.trim() || sessionBearer,
        tokenExpiresAt.toISOString(),
        codeExpiresAt.toISOString(),
        codeChallenge,
        codeChallengeMethod,
      ],
    );
    metricLog('chrome.oauth.session_code', { ok: true });
    return jsonResponse(200, {
      code,
      expiresIn: Math.floor(CODE_TTL_MS / 1000),
      redirectUri,
    });
  } finally {
    await db.close();
  }
}

/**
 * POST /chrome/v1/oauth/token — public one-time code exchange.
 */
export async function handleExchangeToken(
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    code?: string;
    state?: string;
    redirectUri?: string;
    codeVerifier?: string;
  }>(rawBody);
  if ('error' in parsed && parsed.error === 'invalid JSON body') {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed as {
    code?: string;
    state?: string;
    redirectUri?: string;
    codeVerifier?: string;
  };
  const code = body.code?.trim();
  const state = body.state?.trim();
  const redirectUri = body.redirectUri?.trim();
  const codeVerifier = body.codeVerifier?.trim();
  if (!code || !state || !redirectUri) {
    return jsonResponse(400, {
      error: 'code, state, and redirectUri are required',
    });
  }
  if (!CHROME_REDIRECT_PATTERN.test(redirectUri)) {
    return jsonResponse(400, { error: 'redirectUri is not allowed' });
  }

  const stateFp = stateFingerprint(state);
  const db = createDbClient();
  try {
    // Validate state + redirect_uri in the same atomic consume (never burn
    // a valid code on a mismatched callback).
    const { rows } = await db.query<{
      code: string;
      access_token: string;
      refresh_token: string | null;
      id_token: string | null;
      token_expires_at: string;
      code_challenge: string | null;
      code_challenge_method: string | null;
    }>(
      `UPDATE chrome_auth_codes
       SET consumed_at = now()
       WHERE code = $1
         AND consumed_at IS NULL
         AND code_expires_at > now()
         AND state = $2
         AND redirect_uri = $3
       RETURNING code, access_token, refresh_token, id_token, token_expires_at,
                 code_challenge, code_challenge_method`,
      [code, stateFp, redirectUri],
    );
    const row = rows[0];
    if (!row) {
      return jsonResponse(400, { error: 'invalid_grant' });
    }

    // PKCE is checked AFTER the atomic consume, deliberately. The code is now
    // spent either way, so a wrong verifier cannot be retried against it — which
    // is what stops an intercepted code from being brute-forced. RFC 6749 §4.1.2
    // asks for exactly this: a failed exchange invalidates the code.
    if (!verifyPkce(codeVerifier, row.code_challenge, row.code_challenge_method)) {
      metricLog('chrome.oauth.token', { ok: false, reason: 'pkce' });
      // Same undifferentiated error as every other failure — telling the caller
      // which check failed would be a free oracle.
      return jsonResponse(400, { error: 'invalid_grant' });
    }

    await db.query(`DELETE FROM chrome_auth_codes WHERE code = $1`, [code]);

    const expiresIn = Math.max(
      60,
      Math.floor(
        (new Date(row.token_expires_at).getTime() - Date.now()) / 1000,
      ),
    );

    metricLog('chrome.oauth.token', { ok: true });
    return jsonResponse(200, {
      access_token: row.access_token,
      refresh_token: row.refresh_token ?? undefined,
      id_token: row.id_token ?? undefined,
      expires_in: expiresIn,
      token_type: 'Bearer',
    });
  } finally {
    await db.close();
  }
}

/**
 * POST /chrome/v1/oauth/refresh — public Cognito REFRESH_TOKEN_AUTH proxy.
 * Keeps the extension Cognito session alive without demoting to device.
 */
export async function handleRefreshToken(
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{ refreshToken?: string }>(rawBody);
  if ('error' in parsed && parsed.error === 'invalid JSON body') {
    return jsonResponse(400, { error: parsed.error });
  }
  const refreshToken = (parsed as { refreshToken?: string }).refreshToken?.trim();
  if (!refreshToken || refreshToken.length < 20) {
    return jsonResponse(400, { error: 'refreshToken is required' });
  }

  const clientId = process.env.COGNITO_CLIENT_ID?.trim();
  const region =
    process.env.COGNITO_REGION?.trim() ||
    process.env.COGNITO_USER_POOL_ID?.split('_')[0]?.trim() ||
    'eu-west-2';
  if (!clientId) {
    return jsonResponse(503, { error: 'cognito_unconfigured' });
  }

  try {
    const res = await fetch(
      `https://cognito-idp.${region}.amazonaws.com/`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target':
            'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: clientId,
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      },
    );
    const data = (await res.json()) as {
      AuthenticationResult?: {
        AccessToken: string;
        IdToken: string;
        ExpiresIn: number;
        RefreshToken?: string;
      };
      __type?: string;
      message?: string;
    };
    if (!res.ok || !data.AuthenticationResult) {
      metricLog('chrome.oauth.refresh', { ok: false });
      return jsonResponse(400, {
        error: data.message || data.__type || 'invalid_grant',
      });
    }
    const result = data.AuthenticationResult;
    metricLog('chrome.oauth.refresh', { ok: true });
    return jsonResponse(200, {
      access_token: result.AccessToken,
      id_token: result.IdToken,
      refresh_token: result.RefreshToken ?? refreshToken,
      expires_in: result.ExpiresIn,
      token_type: 'Bearer',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'refresh failed';
    console.error('oauth refresh failed', message);
    return jsonResponse(502, { error: 'refresh failed' });
  }
}

export function extractBearer(
  headers: Record<string, string | undefined> | undefined,
): string | null {
  if (!headers) return null;
  const auth =
    headers.authorization ??
    headers.Authorization ??
    Object.entries(headers).find(
      ([k]) => k.toLowerCase() === 'authorization',
    )?.[1];
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  return token || null;
}
