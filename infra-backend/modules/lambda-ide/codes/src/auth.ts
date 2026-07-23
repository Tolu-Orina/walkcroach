/**
 * Cognito JWT (and optional local dev:) auth for IDE BFF.
 * Accepts access tokens from the shared WalkCroach Web SPA Cognito client.
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { CognitoJwtVerifierSingleUserPool } from 'aws-jwt-verify/cognito-verifier';

export type AuthContext = {
  ownerId: string;
  isAnonymous: boolean;
  source: 'jwt' | 'dev';
};

let accessVerifier: CognitoJwtVerifierSingleUserPool<{
  userPoolId: string;
  tokenUse: 'access';
  clientId: string | string[];
}> | null = null;

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

function cognitoClientIds(): string[] {
  const id = process.env.COGNITO_CLIENT_ID?.trim();
  return id ? [id] : [];
}

function getAccessVerifier():
  | CognitoJwtVerifierSingleUserPool<{
      userPoolId: string;
      tokenUse: 'access';
      clientId: string | string[];
    }>
  | null {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientIds = cognitoClientIds();
  if (!userPoolId || clientIds.length === 0) return null;
  if (!accessVerifier) {
    accessVerifier = CognitoJwtVerifier.create({
      userPoolId,
      clientId: clientIds.length === 1 ? clientIds[0]! : clientIds,
      tokenUse: 'access',
    });
  }
  return accessVerifier;
}

function resolveDevToken(token: string): AuthContext | null {
  if (!token.startsWith('dev:')) return null;
  // Opt-in only — missing/unset must not accept forged Bearer dev:* tokens.
  if (process.env.ALLOW_DEV_AUTH !== 'true') return null;
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

  const verifier = getAccessVerifier();
  if (!verifier) return null;
  try {
    const payload = await verifier.verify(token);
    if (!payload.sub) return null;
    return { ownerId: payload.sub, isAnonymous: false, source: 'jwt' };
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
  if (auth.isAnonymous) {
    return {
      error: 'Cognito sign-in required for IDE memory linking',
      status: 401,
    };
  }
  return auth;
}

export async function requireCognitoAuth(
  headers: Record<string, string | undefined> | undefined,
): Promise<AuthContext | { error: string; status: number }> {
  const auth = await requireAuth(headers);
  if ('error' in auth) return auth;
  // Dev tokens are allowed in local/ALLOW_DEV_AUTH for integration tests.
  return auth;
}
