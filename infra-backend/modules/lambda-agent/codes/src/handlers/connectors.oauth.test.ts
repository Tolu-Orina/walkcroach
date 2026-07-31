import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthContext } from '../auth.js';

/**
 * OAuth start and callback (Phase F/E).
 *
 * This is the highest-consequence route in the connector platform: it is what
 * turns an authorization code into stored credentials. It had no test coverage,
 * so these pin the properties that actually protect an account —
 * state is single-use, bound to the owner who began the flow, and PKCE verifiers
 * are never handed back to the client.
 */

type Row = Record<string, unknown>;
const script: Array<{ match: RegExp; rows: Row[] }> = [];
const queries: Array<{ sql: string; params: unknown[] }> = [];
const stored: Array<{ ref: string; tokens: unknown }> = [];
let exchangeResult: unknown = null;

const db = {
  query: async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    const hit = script.find((s) => s.match.test(sql));
    return { rows: hit?.rows ?? [] };
  },
  close: async () => {},
};

vi.mock('@walkcroach/connectors', async () => {
  const actual =
    await vi.importActual<typeof import('@walkcroach/connectors')>(
      '@walkcroach/connectors',
    );
  return {
    ...actual,
    // Only the network and the vault are stubbed; state hashing, PKCE and the
    // provider registry stay real.
    exchangeCode: async () => exchangeResult,
    storeTokens: async (ref: string, tokens: unknown) => {
      stored.push({ ref, tokens });
    },
  };
});

const { handleConnectorOauthStart, handleConnectorOauthCallback } =
  await import('./connectors.js');
const { hashState } = await import('@walkcroach/connectors');

const auth: AuthContext = {
  ownerId: 'cognito-sub-1',
  isAnonymous: false,
  source: 'jwt',
} as AuthContext;

function body(res: { body: string }): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>;
}

beforeEach(() => {
  script.length = 0;
  queries.length = 0;
  stored.length = 0;
  exchangeResult = {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    scopes: ['https://www.googleapis.com/auth/gmail.compose'],
    accountLabel: 'alex@acme.test',
  };
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'gsecret';
  process.env.WEB_APP_URL = 'https://walkcroach.test';
  delete process.env.SLACK_OAUTH_CLIENT_ID;
  delete process.env.SLACK_OAUTH_CLIENT_SECRET;
});

describe('oauth start', () => {
  it('rejects an unknown provider', async () => {
    const res = await handleConnectorOauthStart(db as never, auth, 'evilcorp');
    expect(res.statusCode).toBe(400);
  });

  it('refuses a provider with no OAuth app configured', async () => {
    // Better than sending the user to a consent screen that cannot work.
    const res = await handleConnectorOauthStart(db as never, auth, 'slack');
    expect(res.statusCode).toBe(503);
    expect(body(res).error).toBe('provider_not_configured');
  });

  it('builds an authorize URL with the registry scopes and PKCE', async () => {
    const res = await handleConnectorOauthStart(db as never, auth, 'gmail');
    expect(res.statusCode).toBe(200);
    const url = new URL(String(body(res).authorizeUrl));
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('scope')).toBe(
      'https://www.googleapis.com/auth/gmail.compose',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    // Google only issues a refresh token with both of these.
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('stores the state hashed, never in the clear', async () => {
    const res = await handleConnectorOauthStart(db as never, auth, 'gmail');
    const state = String(body(res).state);
    const insert = queries.find((q) =>
      /INSERT INTO connector_oauth_states/.test(q.sql),
    );
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(hashState(state));
    expect(insert!.params).not.toContain(state);
  });

  it('never returns the PKCE verifier to the client', async () => {
    // The verifier is the secret half; only the challenge may leave the server.
    const res = await handleConnectorOauthStart(db as never, auth, 'gmail');
    const insert = queries.find((q) =>
      /INSERT INTO connector_oauth_states/.test(q.sql),
    );
    const verifier = insert!.params[3];
    expect(typeof verifier).toBe('string');
    expect(res.body).not.toContain(String(verifier));
  });

  it('records the surface that began the flow', async () => {
    await handleConnectorOauthStart(db as never, auth, 'gmail', {
      surface: 'chrome',
    });
    const insert = queries.find((q) =>
      /INSERT INTO connector_oauth_states/.test(q.sql),
    );
    expect(insert!.params).toContain('chrome');
  });

  it('falls back to web for an unrecognised surface', async () => {
    await handleConnectorOauthStart(db as never, auth, 'gmail', {
      surface: 'attacker',
    });
    const insert = queries.find((q) =>
      /INSERT INTO connector_oauth_states/.test(q.sql),
    );
    expect(insert!.params).toContain('web');
  });
});

describe('oauth callback', () => {
  const okState = {
    owner_id: auth.ownerId,
    provider: 'gmail',
    code_verifier: 'v-1',
    redirect_uri: 'https://walkcroach.test/app/settings/connections/callback',
    surface: 'chrome',
  };

  it('requires both code and state', async () => {
    for (const b of [{}, { code: 'c' }, { state: 's' }]) {
      const res = await handleConnectorOauthCallback(db as never, auth, b);
      expect(res.statusCode).toBe(400);
    }
    expect(stored).toHaveLength(0);
  });

  it('rejects a state that does not exist or has expired', async () => {
    script.push({ match: /UPDATE connector_oauth_states/, rows: [] });
    const res = await handleConnectorOauthCallback(db as never, auth, {
      code: 'c',
      state: 's',
    });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid_or_expired_state');
    expect(stored).toHaveLength(0);
  });

  it('consumes state atomically, so a replayed callback cannot reuse it', async () => {
    script.push({ match: /UPDATE connector_oauth_states/, rows: [okState] });
    script.push({ match: /INSERT INTO connectors/, rows: [{ id: 'c1', scopes: [] }] });
    await handleConnectorOauthCallback(db as never, auth, {
      code: 'c',
      state: 's',
    });
    const consume = queries.find((q) =>
      /UPDATE connector_oauth_states/.test(q.sql),
    );
    expect(consume!.sql).toMatch(/consumed_at IS NULL/);
    expect(consume!.sql).toMatch(/expires_at > now\(\)/);
  });

  it('refuses a state belonging to a different account', async () => {
    // Session fixation: an attacker starting a flow and getting a victim to
    // complete it must not attach the attacker's account to the victim's token.
    script.push({
      match: /UPDATE connector_oauth_states/,
      rows: [{ ...okState, owner_id: 'someone-else' }],
    });
    const res = await handleConnectorOauthCallback(db as never, auth, {
      code: 'c',
      state: 's',
    });
    expect(res.statusCode).toBe(403);
    expect(body(res).error).toBe('state_owner_mismatch');
    expect(stored).toHaveLength(0);
  });

  it('reports an exchange failure without storing anything', async () => {
    script.push({ match: /UPDATE connector_oauth_states/, rows: [okState] });
    exchangeResult = { error: 'invalid_grant' };
    const res = await handleConnectorOauthCallback(db as never, auth, {
      code: 'c',
      state: 's',
    });
    expect(res.statusCode).toBe(400);
    expect(stored).toHaveLength(0);
    expect(queries.some((q) => /INSERT INTO connectors/.test(q.sql))).toBe(false);
  });

  it('stores tokens in the vault and never in the connectors row', async () => {
    script.push({ match: /UPDATE connector_oauth_states/, rows: [okState] });
    script.push({
      match: /INSERT INTO connectors/,
      rows: [
        {
          id: 'c1',
          provider: 'gmail',
          status: 'connected',
          scopes: [],
          account_label: 'alex@acme.test',
          last_error: null,
          connected_at: new Date().toISOString(),
        },
      ],
    });
    const res = await handleConnectorOauthCallback(db as never, auth, {
      code: 'c',
      state: 's',
    });
    expect(res.statusCode).toBe(200);
    expect(stored).toHaveLength(1);

    const insert = queries.find((q) => /INSERT INTO connectors/.test(q.sql));
    // The row gets a secret *reference*; the access token must appear nowhere
    // in the SQL parameters, and nowhere in the response.
    expect(JSON.stringify(insert!.params)).not.toContain('at-1');
    expect(JSON.stringify(insert!.params)).not.toContain('rt-1');
    expect(res.body).not.toContain('at-1');
    expect(res.body).not.toContain('rt-1');
  });

  it('returns the surface so the caller can route back where it started', async () => {
    script.push({ match: /UPDATE connector_oauth_states/, rows: [okState] });
    script.push({ match: /INSERT INTO connectors/, rows: [{ id: 'c1', scopes: [] }] });
    const res = await handleConnectorOauthCallback(db as never, auth, {
      code: 'c',
      state: 's',
    });
    expect(body(res).surface).toBe('chrome');
  });
});
