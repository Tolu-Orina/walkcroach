import { createHash, randomBytes } from 'node:crypto';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

const ALLOWED_REDIRECTS = new Set([
  'vscode://walkcroach.walkcroach-ide/auth',
  'cursor://walkcroach.walkcroach-ide/auth',
]);

const CODE_TTL_MS = 5 * 60_000;

function newAuthCode(): string {
  return randomBytes(32).toString('base64url');
}

function stateFingerprint(state: string): string {
  return createHash('sha256').update(state).digest('hex').slice(0, 32);
}

/**
 * POST /ide/v1/oauth/session-code
 * Authenticated (Web session Bearer). Issues a one-time code for IDE exchange.
 * Body: { state, redirectUri, refreshToken?, idToken?, expiresAt? }
 */
export async function handleCreateSessionCode(
  auth: AuthContext,
  rawBody: string | undefined,
  accessToken: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    state?: string;
    redirectUri?: string;
    refreshToken?: string;
    idToken?: string;
    expiresAt?: number;
  }>(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;
  const state = body.state?.trim();
  const redirectUri = body.redirectUri?.trim();
  if (!state || state.length < 8) {
    return jsonResponse(400, { error: 'state is required' });
  }
  if (!redirectUri || !ALLOWED_REDIRECTS.has(redirectUri)) {
    return jsonResponse(400, { error: 'redirectUri is not allowed' });
  }
  if (accessToken.startsWith('dev:')) {
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
         token_expires_at, code_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        code,
        stateFingerprint(state),
        redirectUri,
        auth.ownerId,
        accessToken,
        body.refreshToken?.trim() || null,
        body.idToken?.trim() || null,
        tokenExpiresAt.toISOString(),
        codeExpiresAt.toISOString(),
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
  }>(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;
  const code = body.code?.trim();
  const state = body.state?.trim();
  const redirectUri = body.redirectUri?.trim();
  if (!code || !state || !redirectUri) {
    return jsonResponse(400, {
      error: 'code, state, and redirectUri are required',
    });
  }
  if (!ALLOWED_REDIRECTS.has(redirectUri)) {
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
    }>(
      `UPDATE ide_auth_codes
       SET consumed_at = now()
       WHERE code = $1
         AND consumed_at IS NULL
         AND code_expires_at > now()
       RETURNING code, state, redirect_uri, access_token, refresh_token, id_token,
                 token_expires_at, code_expires_at`,
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
