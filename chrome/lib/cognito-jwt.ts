/**
 * Peek Cognito JWT `token_use` without verifying the signature.
 * Used only to store access vs id tokens in the right slots — never for authz.
 */
export type CognitoTokenUse = 'access' | 'id' | 'opaque';

export function classifyCognitoJwt(token: string): CognitoTokenUse {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return 'opaque';
  const payloadSeg = parts[1];
  if (!payloadSeg) return 'opaque';
  try {
    const b64 = payloadSeg.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { token_use?: string };
    if (payload.token_use === 'access') return 'access';
    if (payload.token_use === 'id') return 'id';
  } catch {
    // not a JWT payload
  }
  return 'opaque';
}
