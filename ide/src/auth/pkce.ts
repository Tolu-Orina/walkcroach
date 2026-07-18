import { createHash, randomBytes } from 'node:crypto';

/** RFC 7636 PKCE helpers (no vscode imports). */
export function generateCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

export function codeChallengeS256(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier, 'utf8').digest());
}

export function generateOAuthState(): string {
  return base64Url(randomBytes(16));
}

function base64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export type CognitoTokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

export function buildAuthorizeUrl(params: {
  hostedUiBaseUrl: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: string[];
}): string {
  const u = new URL(`${params.hostedUiBaseUrl.replace(/\/$/, '')}/oauth2/authorize`);
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set(
    'scope',
    (params.scopes ?? ['openid', 'email', 'profile']).join(' '),
  );
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('code_challenge', params.codeChallenge);
  u.searchParams.set('state', params.state);
  return u.toString();
}

export async function exchangeAuthorizationCode(params: {
  hostedUiBaseUrl: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<CognitoTokenResponse> {
  const tokenUrl = `${params.hostedUiBaseUrl.replace(/\/$/, '')}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Cognito token exchange failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as CognitoTokenResponse;
}

export async function refreshAccessToken(params: {
  hostedUiBaseUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<CognitoTokenResponse> {
  const tokenUrl = `${params.hostedUiBaseUrl.replace(/\/$/, '')}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: params.clientId,
    refresh_token: params.refreshToken,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Cognito token refresh failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as CognitoTokenResponse;
}
