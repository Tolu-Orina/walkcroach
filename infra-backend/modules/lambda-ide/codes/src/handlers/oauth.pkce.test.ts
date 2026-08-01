import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthContext } from '../auth.js';

/**
 * Handler coverage for the IDE/CLI one-time-code exchange.
 *
 * `oauth.test.ts` covers only the pure redirect-URI predicates — until now
 * `handleCreateSessionCode` and `handleExchangeToken` themselves had no tests at
 * all, on the most security-sensitive endpoint pair in the repo. That gap is why
 * making PKCE mandatory broke nothing: nothing was watching.
 *
 * The real `verifyPkce` from @walkcroach/agent-harness runs here — mocking the
 * comparison would leave the actual check unexercised, which is the only part
 * that matters.
 */

type Row = Record<string, unknown>;
let updateRows: Row[] = [];
const queries: Array<{ sql: string; params: unknown[] }> = [];
const closed = { count: 0 };

vi.mock('@walkcroach/db', () => ({
  createDbClient: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/UPDATE ide_auth_codes/.test(sql)) return { rows: updateRows };
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
const REDIRECT = 'vscode://walkcroach.walkcroach-ide/auth';
const STATE = 'a-state-value-long-enough';

const auth: AuthContext = { ownerId: 'sub-1', isAnonymous: false, source: 'jwt' };
const stateFp = (s: string) =>
  createHash('sha256').update(s).digest('hex').slice(0, 32);

const body = (res: { body: string }) => JSON.parse(res.body) as Record<string, unknown>;

function liveCodeRow(over: Row = {}): Row {
  return {
    code: 'the-code',
    state: stateFp(STATE),
    redirect_uri: REDIRECT,
    access_token: 'at',
    refresh_token: 'rt',
    id_token: 'it',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    code_expires_at: new Date(Date.now() + 300_000).toISOString(),
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
    const insert = queries.find((q) => /INSERT INTO ide_auth_codes/.test(q.sql));
    expect(insert?.sql).toMatch(/code_challenge, code_challenge_method/);
    expect(insert?.params).toContain(RFC_CHALLENGE);
    expect(insert?.params).toContain('S256');
  });

  it('refuses to issue a code with no challenge', async () => {
    const res = await issue({ codeChallenge: undefined });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toMatch(/codeChallenge is required/);
    expect(queries.some((q) => /INSERT INTO ide_auth_codes/.test(q.sql))).toBe(false);
  });

  it('refuses the "plain" method, which proves nothing', async () => {
    const res = await issue({ codeChallengeMethod: 'plain' });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toMatch(/must be S256/);
  });

  it('refuses an unknown method rather than defaulting to S256', async () => {
    expect((await issue({ codeChallengeMethod: 'S512' })).statusCode).toBe(400);
    expect((await issue({ codeChallengeMethod: undefined })).statusCode).toBe(400);
  });

  it('still enforces the pre-existing state and redirect checks', async () => {
    expect((await issue({ state: 'short' })).statusCode).toBe(400);
    expect((await issue({ redirectUri: 'https://evil.example/auth' })).statusCode).toBe(400);
  });

  it('always closes the connection', async () => {
    await issue();
    expect(closed.count).toBe(1);
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
    // Whoever saw only the authorize URL holds the challenge, not the verifier.
    const res = await exchange({ codeVerifier: RFC_CHALLENGE });
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid_grant');
  });

  it('burns the code even when PKCE fails, so it cannot be brute-forced', async () => {
    await exchange({ codeVerifier: 'wrong-but-well-formed-verifier-abcdefghijklmno' });
    // The consuming UPDATE ran before verification — the code is spent.
    expect(queries.some((q) => /UPDATE ide_auth_codes/.test(q.sql))).toBe(true);
  });

  it('reports a PKCE failure identically to every other failure', async () => {
    const pkceFail = body(await exchange({ codeVerifier: RFC_CHALLENGE }));
    updateRows = [];
    const unknownCode = body(await exchange());
    // No oracle: the caller cannot tell which check rejected them.
    expect(pkceFail).toEqual(unknownCode);
  });

  it('rejects a stored code that somehow carries no challenge', async () => {
    // Defence in depth: even if a row predating the migration surfaced, it must
    // not become an unauthenticated exchange.
    updateRows = [liveCodeRow({ code_challenge: null, code_challenge_method: null })];
    const res = await exchange();
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe('invalid_grant');
  });

  it('still enforces state and redirect binding before PKCE', async () => {
    expect((await exchange({ state: 'different-state-value' })).statusCode).toBe(400);
    updateRows = [liveCodeRow()];
    expect(
      (await exchange({ redirectUri: 'cursor://walkcroach.walkcroach-ide/auth' }))
        .statusCode,
    ).toBe(400);
  });

  it('does not delete the code row when PKCE fails', async () => {
    await exchange({ codeVerifier: RFC_CHALLENGE });
    expect(queries.some((q) => /DELETE FROM ide_auth_codes WHERE code/.test(q.sql))).toBe(
      false,
    );
  });
});
