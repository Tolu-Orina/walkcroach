import { createHash, randomBytes } from 'node:crypto';
import { getProvider, type ProviderDef } from './providers.js';

/**
 * OAuth plumbing shared by every surface.
 *
 * The flow always completes on WalkCroach Web, whichever surface began it. That
 * is deliberate: registering one redirect URI per provider instead of one per
 * surface keeps the provider consoles manageable, and means the Chrome
 * extension never has to be an OAuth client in its own right — it opens Web and
 * polls for the connection to appear. `surface` on the state row is what lets
 * the completion page send the user back where they started.
 */

export type PkcePair = { verifier: string; challenge: string };

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function generateStateValue(): string {
  return b64url(randomBytes(32));
}

/** Stored hashed, so a leaked state table cannot be replayed against a provider. */
export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function generatePkce(): PkcePair {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(
    createHash('sha256').update(verifier).digest(),
  );
  return { verifier, challenge };
}

export type AuthorizeUrlInput = {
  provider: ProviderDef;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
};

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const { provider, clientId, redirectUri, state, codeChallenge } = input;
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);

  // Slack splits user and bot scopes; everyone else uses a single space or
  // comma separated list. Space is accepted by all providers here.
  url.searchParams.set('scope', provider.scopes.join(' '));

  if (provider.usePkce && codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [k, v] of Object.entries(provider.extraAuthParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. Absent when the provider issues non-expiring tokens (Slack). */
  expiresAt?: number;
  scopes: string[];
  /** Display-only, e.g. the connected mailbox. Never a credential. */
  accountLabel?: string;
};

type RawTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  // Slack shape
  authed_user?: { access_token?: string; scope?: string };
  team?: { name?: string };
  ok?: boolean;
  error?: string;
  // Stripe shape
  stripe_user_id?: string;
};

/** Normalise the several provider response shapes into one TokenSet. */
export function parseTokenResponse(
  providerId: string,
  raw: unknown,
  now = Date.now(),
): TokenSet | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'malformed token response' };
  const r = raw as RawTokenResponse;

  if (r.ok === false || (r.error && !r.access_token)) {
    return { error: r.error ?? 'token exchange failed' };
  }

  // Slack returns the bot token at the top level and the user token nested.
  const accessToken = r.access_token ?? r.authed_user?.access_token;
  if (!accessToken) return { error: 'token response had no access token' };

  const scopeStr = r.scope ?? r.authed_user?.scope ?? '';
  const scopes = scopeStr
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const accountLabel =
    r.team?.name ?? (providerId === 'stripe' ? r.stripe_user_id : undefined);

  return {
    accessToken,
    refreshToken: r.refresh_token,
    expiresAt:
      typeof r.expires_in === 'number'
        ? now + Math.max(60, r.expires_in) * 1000
        : undefined,
    scopes,
    ...(accountLabel ? { accountLabel } : {}),
  };
}

export type ExchangeInput = {
  providerId: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  now?: number;
};

export async function exchangeCode(
  input: ExchangeInput,
): Promise<TokenSet | { error: string }> {
  const provider = getProvider(input.providerId);
  if (!provider) return { error: 'unknown provider' };
  const env = input.env ?? process.env;
  const clientId = env[provider.clientIdEnv]?.trim();
  const clientSecret = env[provider.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) {
    return { error: `${provider.label} is not configured` };
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (provider.usePkce && input.codeVerifier) {
    body.set('code_verifier', input.codeVerifier);
  }

  const doFetch = input.fetchImpl ?? fetch;
  try {
    const res = await doFetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const parsed = parseTokenResponse(provider.id, json, input.now);
      return 'error' in parsed ? parsed : { error: `token exchange ${res.status}` };
    }
    return parseTokenResponse(provider.id, json, input.now);
  } catch {
    return { error: 'could not reach the provider' };
  }
}

export async function refreshAccessToken(input: {
  providerId: string;
  refreshToken: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<TokenSet | { error: string }> {
  const provider = getProvider(input.providerId);
  if (!provider) return { error: 'unknown provider' };
  const env = input.env ?? process.env;
  const clientId = env[provider.clientIdEnv]?.trim();
  const clientSecret = env[provider.clientSecretEnv]?.trim();
  if (!clientId || !clientSecret) {
    return { error: `${provider.label} is not configured` };
  }

  const doFetch = input.fetchImpl ?? fetch;
  try {
    const res = await doFetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    const json = (await res.json()) as unknown;
    const parsed = parseTokenResponse(provider.id, json, input.now);
    if ('error' in parsed) return parsed;
    // Providers routinely omit the refresh token on refresh; keep the old one.
    return { ...parsed, refreshToken: parsed.refreshToken ?? input.refreshToken };
  } catch {
    return { error: 'could not reach the provider' };
  }
}

/** A token needs refreshing slightly before it actually expires. */
export function isExpired(tokens: TokenSet, now = Date.now(), skewMs = 60_000): boolean {
  if (!tokens.expiresAt) return false;
  return tokens.expiresAt <= now + skewMs;
}
