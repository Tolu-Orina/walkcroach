import { randomBytes } from 'node:crypto';

/** CSRF / handoff state for Web → IDE auth (no Hosted UI). */
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

/**
 * Refresh via Cognito InitiateAuth (same SPA client as Web — USER_PASSWORD pool).
 */
export async function refreshWithSpaClient(params: {
  region: string;
  clientId: string;
  refreshToken: string;
}): Promise<CognitoTokenResponse> {
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
      AuthParameters: {
        REFRESH_TOKEN: params.refreshToken,
      },
    }),
  });
  const data = (await res.json()) as {
    AuthenticationResult?: {
      AccessToken?: string;
      IdToken?: string;
      ExpiresIn?: number;
    };
    message?: string;
    __type?: string;
  };
  if (!res.ok || !data.AuthenticationResult?.AccessToken) {
    throw new Error(
      `Cognito token refresh failed (${res.status}): ${data.message ?? data.__type ?? 'unknown'}`,
    );
  }
  return {
    access_token: data.AuthenticationResult.AccessToken,
    id_token: data.AuthenticationResult.IdToken,
    refresh_token: params.refreshToken,
    expires_in: data.AuthenticationResult.ExpiresIn,
  };
}

/**
 * Real PKCE now lives in the engine (`@walkcroach/agent-engine`), shared with the
 * CLI so both surfaces derive challenges identically.
 *
 * These names previously existed here as `@deprecated` leftovers of a removed
 * Hosted-UI flow — wired to nothing, tested only by their own test, and enough to
 * make this file look like it implemented PKCE when it did not. Re-exported rather
 * than reimplemented so that reading `auth/pkce.ts` and finding PKCE is true again.
 */
export {
  generateCodeVerifier,
  codeChallengeS256,
  generatePkce,
  PKCE_METHOD,
  type PkcePair,
} from '@walkcroach/agent-engine';
