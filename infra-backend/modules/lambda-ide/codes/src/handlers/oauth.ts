import { createHash, randomBytes } from 'node:crypto';
import { createDbClient } from '@walkcroach/db';
import { verifyPkce, PKCE_METHOD } from '@walkcroach/agent-harness';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

/** Accept known editor schemes; reject arbitrary custom schemes. */
const REDIRECT_PATTERN =
  /^(vscode|cursor|vscode-insiders|vscodium|windsurf|code-oss):\/\/walkcroach\.walkcroach-ide\/auth$/;

/**
 * The CLI cannot receive a custom scheme, so it listens on the loopback
 * interface instead — the pattern RFC 8252 §7.3 prescribes for native apps.
 *
 * Deliberately a separate check rather than a widened `REDIRECT_PATTERN`: the
 * editor pattern is duplicated in `web/src/app/auth/ConnectIdePage.tsx` and
 * annotated "must stay in sync". Editing it here would silently break IDE
 * sign-in for every editor, to add a case the IDE never uses.
 *
 * Parsed rather than regex-matched, because the interesting failures are
 * hosts that only *look* like loopback — `127.0.0.1.attacker.example` matches
 * a careless `/^http:\/\/127\.0\.0\.1/` and resolves to someone else's server.
 * The port is free (the OS assigns it), everything else is fixed.
 */
export function isLoopbackRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:') return false;
  // Hostname must be a literal loopback address. `localhost` is excluded on
  // purpose: it goes through DNS, and DNS can be made to point elsewhere.
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return false;
  if (url.pathname !== '/callback') return false;
  if (url.search || url.hash || url.username || url.password) return false;
  // An absent port would mean :80, which needs privileges and is never ours.
  if (!url.port) return false;
  const port = Number(url.port);
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

/** Every redirect target this BFF will issue a code for. */
export function isAllowedRedirectUri(raw: string): boolean {
  return REDIRECT_PATTERN.test(raw) || isLoopbackRedirectUri(raw);
}

const CODE_TTL_MS = 5 * 60_000;

function newAuthCode(): string {
  return randomBytes(32).toString('base64url');
}

function stateFingerprint(state: string): string {
  return createHash('sha256').update(state).digest('hex').slice(0, 32);
}

/**
 * POST /ide/v1/oauth/session-code
 * Authenticated (Web session Bearer = Cognito ID token). Issues a one-time
 * code for IDE exchange.
 * Body: { state, redirectUri, refreshToken?, idToken?, expiresAt? }
 */
export async function handleCreateSessionCode(
  auth: AuthContext,
  rawBody: string | undefined,
  /** Cognito ID token from the Web session (Bearer). Stored for IDE reuse. */
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
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;
  const state = body.state?.trim();
  const redirectUri = body.redirectUri?.trim();
  const codeChallenge = body.codeChallenge?.trim();
  const codeChallengeMethod = body.codeChallengeMethod?.trim();
  if (!state || state.length < 8) {
    return jsonResponse(400, { error: 'state is required' });
  }
  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    return jsonResponse(400, { error: 'redirectUri is not allowed' });
  }
  // PKCE is mandatory, not negotiated. No client has ever shipped without it, so
  // there is no legacy caller to tolerate — and a code issued without a challenge
  // could later be exchanged by anyone who intercepted it. This matters most on
  // this endpoint: the IDE receives its code on a custom scheme and the CLI on a
  // loopback port, both local channels another process can plausibly observe.
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
      error: 'Dev tokens cannot be used for IDE connect',
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
    // Best-effort cleanup of expired rows
    await db.query(
      `DELETE FROM ide_auth_codes
       WHERE code_expires_at < now() OR consumed_at IS NOT NULL`,
    );
    await db.query(
      `INSERT INTO ide_auth_codes (
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
    metricLog('ide.oauth.session_code', { ok: true });
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
 * POST /ide/v1/oauth/token
 * Public. Exchanges a one-time code for Cognito tokens (native-app OAuth pattern).
 * Body: { code, state, redirectUri }
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
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;
  const code = body.code?.trim();
  const state = body.state?.trim();
  const redirectUri = body.redirectUri?.trim();
  const codeVerifier = body.codeVerifier?.trim();
  if (!code || !state || !redirectUri) {
    return jsonResponse(400, {
      error: 'code, state, and redirectUri are required',
    });
  }
  if (!isAllowedRedirectUri(redirectUri)) {
    return jsonResponse(400, { error: 'redirectUri is not allowed' });
  }

  const db = createDbClient();
  try {
    const { rows } = await db.query<{
      code: string;
      state: string;
      redirect_uri: string;
      access_token: string;
      refresh_token: string | null;
      id_token: string | null;
      token_expires_at: string;
      code_expires_at: string;
      code_challenge: string | null;
      code_challenge_method: string | null;
    }>(
      `UPDATE ide_auth_codes
       SET consumed_at = now()
       WHERE code = $1
         AND consumed_at IS NULL
         AND code_expires_at > now()
       RETURNING code, state, redirect_uri, access_token, refresh_token, id_token,
                 token_expires_at, code_expires_at,
                 code_challenge, code_challenge_method`,
      [code],
    );
    const row = rows[0];
    if (!row) {
      return jsonResponse(400, { error: 'invalid_grant' });
    }
    if (row.state !== stateFingerprint(state)) {
      return jsonResponse(400, { error: 'invalid_grant' });
    }
    if (row.redirect_uri !== redirectUri) {
      return jsonResponse(400, { error: 'invalid_grant' });
    }
    // Checked after the atomic consume, deliberately: the code is spent either
    // way, so a wrong verifier cannot be retried against it. RFC 6749 §4.1.2 asks
    // for exactly this — a failed exchange invalidates the code.
    if (!verifyPkce(codeVerifier, row.code_challenge, row.code_challenge_method)) {
      metricLog('ide.oauth.token', { ok: false, reason: 'pkce' });
      // Same undifferentiated error as every other failure above; naming the
      // failed check would be a free oracle.
      return jsonResponse(400, { error: 'invalid_grant' });
    }

    await db.query(`DELETE FROM ide_auth_codes WHERE code = $1`, [code]);

    const expiresIn = Math.max(
      60,
      Math.floor(
        (new Date(row.token_expires_at).getTime() - Date.now()) / 1000,
      ),
    );

    metricLog('ide.oauth.token', { ok: true });
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

/** Extract Bearer token for session-code issuance. */
export function extractBearer(
  headers: Record<string, string | undefined> | undefined,
): string | null {
  if (!headers) return null;
  const auth =
    headers.authorization ??
    headers.Authorization ??
    Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  return token || null;
}
