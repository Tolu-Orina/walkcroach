/**
 * Sign-in handoff wiring (C1.1b, C1.1c).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SECRET_KEYS } from '@walkcroach/agent-engine';
import {
  accessTokenIsStale,
  buildAuthorizeUrl,
  exchangeAuthCode,
  refreshAccessToken,
  storeTokens,
} from './session.js';
import { getSecret, setSecret } from '../lib/config.js';
import { ApiError, NetworkError } from '../lib/exit-codes.js';
import { resetRuntimeFlags, setRuntimeFlags } from '../lib/runtime.js';

let home: string;
const fetchMock = vi.fn();

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'wc-session-'));
  process.env.WALKCROACH_HOME = home;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setRuntimeFlags({ apiBaseUrl: 'https://api.example.com/v1' });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetRuntimeFlags();
  delete process.env.WALKCROACH_HOME;
  await rm(home, { recursive: true, force: true });
});

function jsonRes(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  };
}

describe('buildAuthorizeUrl', () => {
  it('points at /connect/cli carrying state and the loopback redirect', () => {
    const url = new URL(
      buildAuthorizeUrl({
        webAppUrl: 'https://walkcroach.example.com',
        state: 'st_abc',
        redirectUri: 'http://127.0.0.1:49512/callback',
      }),
    );
    expect(url.pathname).toBe('/connect/cli');
    expect(url.searchParams.get('state')).toBe('st_abc');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:49512/callback');
  });

  it('does not reuse the IDE connect route', () => {
    // A shared route would mean one redirect allowlist for two different
    // client shapes — exactly the coupling C1.1d exists to avoid.
    expect(
      buildAuthorizeUrl({
        webAppUrl: 'https://x.example.com',
        state: 's',
        redirectUri: 'http://127.0.0.1:1/callback',
      }),
    ).not.toContain('/connect/ide');
  });
});

describe('exchangeAuthCode', () => {
  it('posts code, state and redirectUri, with no bearer of its own', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ access_token: 'at', expires_in: 3600 }));
    const tokens = await exchangeAuthCode({
      code: 'c1',
      state: 's1',
      redirectUri: 'http://127.0.0.1:49512/callback',
    });
    expect(tokens.access_token).toBe('at');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.com/v1/ide/v1/oauth/token');
    expect(JSON.parse(init.body)).toEqual({
      code: 'c1',
      state: 's1',
      redirectUri: 'http://127.0.0.1:49512/callback',
    });
    // The endpoint is public: the code *is* the credential, and sending a
    // half-established session with it would be meaningless.
    expect(init.headers.authorization).toBeUndefined();
  });

  it('raises an ApiError carrying the status, so the exit code can be right', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ error: 'invalid_grant' }, 400));
    await expect(
      exchangeAuthCode({ code: 'c', state: 's', redirectUri: 'http://127.0.0.1:1/callback' }),
    ).rejects.toMatchObject({ constructor: ApiError, status: 400 });
  });

  it('rejects a 200 that carries no token rather than storing nothing', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({}));
    await expect(
      exchangeAuthCode({ code: 'c', state: 's', redirectUri: 'http://127.0.0.1:1/callback' }),
    ).rejects.toThrow(/Token exchange failed/);
  });

  it('rewrites a transport failure as a NetworkError naming the host', async () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    fetchMock.mockRejectedValueOnce(err);
    await expect(
      exchangeAuthCode({ code: 'c', state: 's', redirectUri: 'http://127.0.0.1:1/callback' }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('storeTokens', () => {
  it('writes under the same logical keys the IDE reads', async () => {
    await storeTokens({
      access_token: 'at',
      refresh_token: 'rt',
      id_token: 'it',
      expires_in: 3600,
    });
    expect(await getSecret(SECRET_KEYS.cognitoAccessToken)).toBe('at');
    expect(await getSecret(SECRET_KEYS.cognitoRefreshToken)).toBe('rt');
    expect(await getSecret(SECRET_KEYS.cognitoIdToken)).toBe('it');
    expect(Number(await getSecret(SECRET_KEYS.cognitoExpiresAt))).toBeGreaterThan(Date.now());
  });

  it('does not blank an existing refresh token when one is not returned', async () => {
    await setSecret(SECRET_KEYS.cognitoRefreshToken, 'existing');
    await storeTokens({ access_token: 'at2' });
    expect(await getSecret(SECRET_KEYS.cognitoRefreshToken)).toBe('existing');
  });
});

describe('accessTokenIsStale', () => {
  it('is stale with no token at all', async () => {
    expect(await accessTokenIsStale()).toBe(true);
  });

  it('is fresh well before expiry', async () => {
    await storeTokens({ access_token: 'at', expires_in: 3600 });
    expect(await accessTokenIsStale()).toBe(false);
  });

  it('is stale inside the last minute, so a run does not start on a dying token', async () => {
    await setSecret(SECRET_KEYS.cognitoAccessToken, 'at');
    await setSecret(SECRET_KEYS.cognitoExpiresAt, String(Date.now() + 30_000));
    expect(await accessTokenIsStale()).toBe(true);
  });

  it('treats a pasted token with no known expiry as usable', async () => {
    // `--token` sets no expiry; assuming staleness would break CI.
    await setSecret(SECRET_KEYS.cognitoAccessToken, 'pasted');
    expect(await accessTokenIsStale()).toBe(false);
  });
});

describe('refreshAccessToken', () => {
  it('calls Cognito InitiateAuth and keeps the refresh token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({
        AuthenticationResult: { AccessToken: 'new-at', IdToken: 'new-it', ExpiresIn: 3600 },
      }),
    );
    const tokens = await refreshAccessToken({
      region: 'eu-west-2',
      clientId: 'cid',
      refreshToken: 'rt',
    });
    expect(tokens).toMatchObject({ access_token: 'new-at', refresh_token: 'rt' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://cognito-idp.eu-west-2.amazonaws.com/');
    expect(JSON.parse(init.body).AuthFlow).toBe('REFRESH_TOKEN_AUTH');
  });

  it('reports a rejected refresh rather than returning an empty token', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ __type: 'NotAuthorizedException' }, 400));
    await expect(
      refreshAccessToken({ region: 'eu-west-2', clientId: 'cid', refreshToken: 'bad' }),
    ).rejects.toThrow(/NotAuthorizedException/);
  });
});
