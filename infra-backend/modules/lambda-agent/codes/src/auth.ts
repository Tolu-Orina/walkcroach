import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { CognitoJwtVerifierSingleUserPool } from 'aws-jwt-verify/cognito-verifier';

/**
 * Request auth resolution.
 * - Production: Cognito JWT (ID token) verified against JWKS.
 * - Dev/local: optional Bearer dev:user:* / dev:anon:* when ALLOW_DEV_AUTH=true.
 */

export type AuthContext = {
  ownerId: string;
  isAnonymous: boolean;
  source: 'dev' | 'jwt';
};

let idVerifier: CognitoJwtVerifierSingleUserPool<{
  userPoolId: string;
  tokenUse: 'id';
  clientId: string;
}> | null = null;

function devAuthAllowed(): boolean {
  // Opt-in only — missing/unset must never enable forged Bearer dev:* tokens in prod.
  return process.env.ALLOW_DEV_AUTH === 'true';
}

function getIdVerifier():
  | CognitoJwtVerifierSingleUserPool<{
      userPoolId: string;
      tokenUse: 'id';
      clientId: string;
    }>
  | null {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) return null;
  if (!idVerifier) {
    idVerifier = CognitoJwtVerifier.create({
      userPoolId,
      clientId,
      tokenUse: 'id',
    });
  }
  return idVerifier;
}

function normalizeHeaders(
  raw: Record<string, string | undefined> | undefined,
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined) out[k.toLowerCase()] = v;
  }
  return out;
}

function bearerToken(
  headers: Record<string, string | undefined> | undefined,
): string | null {
  const h = normalizeHeaders(headers);
  const auth = h.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length).trim();
  return token || null;
}

function resolveDevToken(token: string): AuthContext | null {
  if (!token.startsWith('dev:')) return null;
  if (!devAuthAllowed()) return null;
  const ownerId = token.slice('dev:'.length).trim();
  if (!ownerId) return null;
  return {
    ownerId,
    isAnonymous: ownerId.startsWith('anon:'),
    source: 'dev',
  };
}

export async function resolveAuth(
  headers: Record<string, string | undefined> | undefined,
): Promise<AuthContext | null> {
  const token = bearerToken(headers);
  if (!token) return null;

  const dev = resolveDevToken(token);
  if (dev) return dev;

  const verifier = getIdVerifier();
  if (!verifier) return null;

  try {
    const payload = await verifier.verify(token);
    const sub = payload.sub;
    if (!sub) return null;
    return { ownerId: sub, isAnonymous: false, source: 'jwt' };
  } catch {
    return null;
  }
}

export async function requireAuth(
  headers: Record<string, string | undefined> | undefined,
): Promise<AuthContext | { error: string; status: number }> {
  const auth = await resolveAuth(headers);
  if (!auth) {
    return { error: 'authorization required', status: 401 };
  }
  return auth;
}

/** @deprecated Use async requireAuth */
export function requireAuthSync(
  headers: Record<string, string | undefined> | undefined,
): AuthContext | { error: string; status: number } {
  const token = bearerToken(headers);
  if (!token) return { error: 'authorization required', status: 401 };
  const dev = resolveDevToken(token);
  if (dev) return dev;
  return { error: 'authorization required', status: 401 };
}
