export type CognitoTokens = {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
};

const PKCE_VERIFIER_KEY = 'walkcroach.cognito.pkce';

function base64Url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

export function isCognitoEnabled(): boolean {
  return Boolean(
    import.meta.env.VITE_COGNITO_CLIENT_ID &&
      import.meta.env.VITE_COGNITO_HOSTED_DOMAIN,
  );
}

export function allowDevAuth(): boolean {
  return import.meta.env.VITE_ALLOW_DEV_AUTH === 'true';
}

export function cognitoHostedDomain(): string {
  return String(import.meta.env.VITE_COGNITO_HOSTED_DOMAIN ?? '');
}

export function cognitoClientId(): string {
  return String(import.meta.env.VITE_COGNITO_CLIENT_ID ?? '');
}

export function redirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

export async function startCognitoSignIn(): Promise<void> {
  const verifier = randomVerifier();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  const challenge = base64Url(await sha256(verifier));
  const params = new URLSearchParams({
    client_id: cognitoClientId(),
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.assign(
    `https://${cognitoHostedDomain()}/oauth2/authorize?${params}`,
  );
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<CognitoTokens> {
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!verifier) throw new Error('Missing PKCE verifier');
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cognitoClientId(),
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch(`https://${cognitoHostedDomain()}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(await res.text());

  const data = (await res.json()) as {
    access_token: string;
    id_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshCognitoTokens(
  refreshToken: string,
): Promise<CognitoTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cognitoClientId(),
    refresh_token: refreshToken,
  });

  const res = await fetch(`https://${cognitoHostedDomain()}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(await res.text());

  const data = (await res.json()) as {
    access_token: string;
    id_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export function parseIdToken(idToken: string): {
  sub: string;
  email?: string;
  name?: string;
} {
  const payload = idToken.split('.')[1];
  if (!payload) throw new Error('invalid id token');
  const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
    sub?: string;
    email?: string;
    name?: string;
  };
  if (!json.sub) throw new Error('id token missing sub');
  return { sub: json.sub, email: json.email, name: json.name };
}

export function cognitoLogoutUrl(): string {
  const params = new URLSearchParams({
    client_id: cognitoClientId(),
    logout_uri: window.location.origin,
  });
  return `https://${cognitoHostedDomain()}/logout?${params}`;
}
