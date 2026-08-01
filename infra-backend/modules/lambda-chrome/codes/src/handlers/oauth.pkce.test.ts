import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthContext } from '../auth.js';

/**
 * Handler coverage for the Chrome one-time-code exchange — the twin of
 * `lambda-ide/src/handlers/oauth.pkce.test.ts`. Neither handler had tests before
 * PKCE landed.
 *
 * Chrome's exchange differs from the IDE's in one good way: state and
 * redirect_uri are folded into the consuming UPDATE rather than compared after
 * it, so a mismatched callback never burns a valid code. PKCE still has to be
 * checked after the consume — see the assertion on brute-force resistance.
 */

type Row = Record<string, unknown>;
let updateRows: Row[] = [];
const queries: Array<{ sql: string; params: unknown[] }> = [];
const closed = { count: 0 };

vi.mock('@walkcroach/db', () => ({
  createDbClient: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/UPDATE chrome_auth_codes/.test(sql)) return { rows: updateRows };
      return { rows: [] };
    },
    close: async () => {
      closed.count++;
    },
  }),
}));

const { handleCreateSessionCode, handleExchangeToken } = await import('./oauth.js');

const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'; // 32 chars, [a-p]
const REDIRECT = `https://${EXT_ID}.chromiumapp.org/auth`;
const STATE = 'a-state-value-long-enough';

const auth: AuthContext = { ownerId: 'sub-1', isAnonymous: false, source: 'jwt' };
const stateFp = (s: string) =>
  createHash('sha256').update(s).digest('hex').slice(0, 32);

const body = (res: { body: string }) => JSON.parse(res.body) as Record<string, unknown>;

function liveCodeRow(over: Row = {}): Row {
  return {
    code: 'the-code',
    access_token: 'at',
    refresh_token: 'rt',
    id_token: 'it',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    code_challenge: RFC_CHALLENGE,
    code_challenge_method: 'S256',
    ...over,
  };
}

const issue = (over: Record<string, unknown> = {}) =>
  handleCreateSessionCode(
    auth,
    JSON.stringify({
      state: STATE,
      redirectUri: REDIRECT,
      codeChallenge: RFC_CHALLENGE,
      codeChallengeMethod: 'S256',
      ...over,
    }),
    'cognito-id-token',
  );

const exchange = (over: Record<string, unknown> = {}) =>
  handleExchangeToken(
    JSON.stringify({
      code: 'the-code',
      state: STATE,
      redirectUri: REDIRECT,
      codeVerifier: RFC_VERIFIER,
      ...over,
    }),
  );

beforeEach(() => {
  queries.length = 0;
  closed.count = 0;
  updateRows = [liveCodeRow()];
});

describe('handleCreateSessionCode — PKCE is mandatory', () => {
  it('issues a code when a valid S256 challenge is supplied', async () => {
    const res = await issue();
    expect(res.statusCode).toBe(200);
    expect(body(res).code).toEqual(expect.any(String));
  });

  it('persists the challenge and its method with the code', async () => {
    await issue();
    const insert = queries.find((q) => /INSERT INTO chrome_auth_codes/.test(q.sql));
    expect(insert?.sql).toMatch(/code_challenge, code_challenge_method/);
    expect(insert?.params).toContain(RFC_CHALLENGE);
    expect(insert?.params).toContain('S256');
  });

  it('refuses to issue a code with no challenge', async () => {
    const res = await issue({ codeChallenge: undefined });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toMatch(/codeChallenge is required/);
    expect(queries.some((q) => /INSERT INTO chrome_auth_codes/.test(q.sql))).toBe(false);
  });

  it('refuses the "plain" method, which proves nothing', async () => {
    const res = await issue({ codeChallengeMethod: 'plain' });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toMatch(/must be S256/);
  });

  it('still enforces the extension-ID-bound redirect', async () => {
    const res = await issue({ redirectUri: 'https://evil.example/auth' });
    expect(res.statusCode).toBe(400);
  });
});

describe('handleExchangeToken — proof of possession', () => {
  it('returns tokens for the matching verifier', async () => {
    const res = await exchange();
    expect(res.statusCode).toBe(200);
    expect(body(res).access_token).toBe('at');
  });

  it('rejects a wrong verifier', async () => {
    const res = await exchange({
      codeVerifier: randomBytes(48).toString('base64url'),
    });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid_grant');
  });

  it('rejects an absent verifier — an intercepted code alone is not enough', async () => {
    const res = await exchange({ codeVerifier: undefined });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid_grant');
  });

  it('rejects the challenge replayed as the verifier', async () => {
    const res = await exchange({ codeVerifier: RFC_CHALLENGE });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid_grant');
  });

  it('burns the code even when PKCE fails, so it cannot be brute-forced', async () => {
    await exchange({ codeVerifier: RFC_CHALLENGE });
    expect(queries.some((q) => /UPDATE chrome_auth_codes/.test(q.sql))).toBe(true);
    expect(
      queries.some((q) => /DELETE FROM chrome_auth_codes WHERE code/.test(q.sql)),
    ).toBe(false);
  });

  it('binds state into the consuming UPDATE, not a later comparison', async () => {
    await exchange();
    const update = queries.find((q) => /UPDATE chrome_auth_codes/.test(q.sql));
    expect(update?.sql).toMatch(/AND state = \$2/);
    expect(update?.params?.[1]).toBe(stateFp(STATE));
  });

  it('rejects a stored code that somehow carries no challenge', async () => {
    updateRows = [liveCodeRow({ code_challenge: null, code_challenge_method: null })];
    const res = await exchange();
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid_grant');
  });

  it('reports a PKCE failure identically to an unknown code', async () => {
    const pkceFail = body(await exchange({ codeVerifier: RFC_CHALLENGE }));
    updateRows = [];
    const unknownCode = body(await exchange());
    expect(pkceFail).toEqual(unknownCode);
  });
});
