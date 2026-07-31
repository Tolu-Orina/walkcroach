/**
 * `AuthService` — master plan §7B backfill.
 *
 * The IDE's coverage gate was computed over three files and reported 40%; the
 * true figure across the package was 9%. `session.ts` sat at 10% despite
 * holding every credential decision the extension makes: what counts as signed
 * in, when a token is too old to use, and what a sign-out actually erases.
 *
 * The invariant worth defending: **never keep a forever "signed in" dead
 * credential.** A token with no recorded expiry, or one inside its last
 * minute, must be refreshed or cleared — an extension that shows "signed in"
 * while every request 401s is worse than one that shows signed out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SECRET_KEYS } from '@walkcroach/agent-engine';
import { AuthService, jwtExpiresInSeconds } from './session.js';

/** Adapter matching the `vscode.SecretStorage` shape the service expects. */
function secretStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const api = {
    get: vi.fn(async (key: string) => map.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      map.delete(key);
    }),
    onDidChange: vi.fn(),
  };
  return { api: api as never, map };
}

function futureExpiry(msFromNow: number): string {
  return String(Date.now() + msFromNow);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

describe('getAccessToken', () => {
  it('returns nothing when no token is stored', async () => {
    const { api } = secretStorage();
    expect(await new AuthService(api).getAccessToken()).toBeUndefined();
  });

  it('returns a token that is comfortably in date', async () => {
    const { api } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'good-token',
      [SECRET_KEYS.cognitoExpiresAt]: futureExpiry(60 * 60_000),
    });
    expect(await new AuthService(api).getAccessToken()).toBe('good-token');
  });

  it('does not hand back a token inside its last minute', async () => {
    // A token that expires mid-request is indistinguishable from a broken
    // extension, so the last 60s is treated as already expired.
    const { api } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'nearly-dead',
      [SECRET_KEYS.cognitoExpiresAt]: futureExpiry(30_000),
    });
    expect(await new AuthService(api).getAccessToken()).toBeUndefined();
  });

  it('does not trust a token with no recorded expiry', async () => {
    // Legacy pasted tokens have no TTL. Treating "unknown" as "valid forever"
    // is what produces a permanently signed-in UI over dead credentials.
    const { api } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'legacy-paste',
    });
    expect(await new AuthService(api).getAccessToken()).toBeUndefined();
  });

  it('does not trust an unparseable expiry', async () => {
    const { api } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'token',
      [SECRET_KEYS.cognitoExpiresAt]: 'not-a-number',
    });
    expect(await new AuthService(api).getAccessToken()).toBeUndefined();
  });

  it('refreshes an expired token when a refresh token is available', async () => {
    const { api, map } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'stale',
      [SECRET_KEYS.cognitoExpiresAt]: String(Date.now() - 1000),
      [SECRET_KEYS.cognitoRefreshToken]: 'refresh-me',
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        AuthenticationResult: {
          AccessToken: 'fresh-token',
          ExpiresIn: 3600,
        },
      }),
    });

    const token = await new AuthService(api).getAccessToken();

    expect(token).toBe('fresh-token');
    expect(map.get(SECRET_KEYS.cognitoAccessToken)).toBe('fresh-token');
    // And the new expiry is recorded, or the next call refreshes again.
    expect(Number(map.get(SECRET_KEYS.cognitoExpiresAt))).toBeGreaterThan(Date.now());
  });

  it('clears the session when the refresh is rejected', async () => {
    // A refresh token Cognito no longer accepts is not worth keeping: the
    // user has to sign in again, and pretending otherwise hides that.
    const { api, map } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'stale',
      [SECRET_KEYS.cognitoExpiresAt]: String(Date.now() - 1000),
      [SECRET_KEYS.cognitoRefreshToken]: 'revoked',
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ __type: 'NotAuthorizedException' }),
    });

    const service = new AuthService(api);
    expect(await service.getAccessToken()).toBeUndefined();
    expect(map.get(SECRET_KEYS.cognitoAccessToken)).toBeUndefined();
    expect(map.get(SECRET_KEYS.cognitoRefreshToken)).toBeUndefined();
  });

  it('survives a network failure during refresh without wedging', async () => {
    const { api } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'stale',
      [SECRET_KEYS.cognitoExpiresAt]: String(Date.now() - 1000),
      [SECRET_KEYS.cognitoRefreshToken]: 'refresh-me',
    });
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const service = new AuthService(api);
    await expect(service.getAccessToken()).resolves.toBeUndefined();
    // A second attempt must still be possible — no permanently in-flight state.
    await expect(service.getAccessToken()).resolves.toBeUndefined();
  });

  it('coalesces concurrent refreshes into one network call', async () => {
    // Three panels asking at once must not mint three refreshes; Cognito
    // rotates refresh tokens, so racing them can invalidate the session.
    const { api } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'stale',
      [SECRET_KEYS.cognitoExpiresAt]: String(Date.now() - 1000),
      [SECRET_KEYS.cognitoRefreshToken]: 'refresh-me',
    });
    fetchMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          AuthenticationResult: { AccessToken: 'fresh', ExpiresIn: 3600 },
        }),
      };
    });

    const service = new AuthService(api);
    const results = await Promise.all([
      service.getAccessToken(),
      service.getAccessToken(),
      service.getAccessToken(),
    ]);

    expect(results).toEqual(['fresh', 'fresh', 'fresh']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('isSignedIn', () => {
  it('is false for an expired session even though a token exists', async () => {
    const { api } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'stale',
      [SECRET_KEYS.cognitoExpiresAt]: String(Date.now() - 1000),
    });
    expect(await new AuthService(api).isSignedIn()).toBe(false);
  });

  it('is true for a live session', async () => {
    const { api } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'good',
      [SECRET_KEYS.cognitoExpiresAt]: futureExpiry(3600_000),
    });
    expect(await new AuthService(api).isSignedIn()).toBe(true);
  });
});

describe('signOut', () => {
  it('erases every credential, not just the access token', async () => {
    // A sign-out that leaves the refresh token behind is not a sign-out: the
    // next call would silently mint a new session.
    const { api, map } = secretStorage({
      [SECRET_KEYS.cognitoAccessToken]: 'a',
      [SECRET_KEYS.cognitoRefreshToken]: 'r',
      [SECRET_KEYS.cognitoIdToken]: 'i',
      [SECRET_KEYS.cognitoExpiresAt]: futureExpiry(3600_000),
      [SECRET_KEYS.pendingPkce]: 'p',
    });

    await new AuthService(api).signOut();

    expect(map.size).toBe(0);
  });

  it('is safe to call when already signed out', async () => {
    const { api } = secretStorage();
    await expect(new AuthService(api).signOut()).resolves.toBeUndefined();
  });
});

describe('storeAccessToken', () => {
  it('records a TTL so the token cannot become immortal', async () => {
    const { api, map } = secretStorage();
    await new AuthService(api).storeAccessToken('t', { expiresIn: 3600 });
    expect(Number(map.get(SECRET_KEYS.cognitoExpiresAt))).toBeGreaterThan(Date.now());
  });

  it('stores refresh and id tokens when supplied', async () => {
    const { api, map } = secretStorage();
    await new AuthService(api).storeAccessToken('t', {
      refreshToken: 'r',
      idToken: 'i',
      expiresIn: 3600,
    });
    expect(map.get(SECRET_KEYS.cognitoRefreshToken)).toBe('r');
    expect(map.get(SECRET_KEYS.cognitoIdToken)).toBe('i');
  });

  it('trims a pasted token, which usually arrives with whitespace', async () => {
    const { api, map } = secretStorage();
    await new AuthService(api).storeAccessToken('  padded-token \n');
    expect(map.get(SECRET_KEYS.cognitoAccessToken)).toBe('padded-token');
  });
});

describe('jwtExpiresInSeconds', () => {
  it('reads a future exp as remaining seconds', () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;
    const secs = jwtExpiresInSeconds(token);
    expect(secs).toBeGreaterThan(500);
    expect(secs).toBeLessThanOrEqual(600);
  });

  it('treats an already-expired token as having no time left', () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const token = `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;
    expect(jwtExpiresInSeconds(token)).toBeUndefined();
  });

  it('returns undefined rather than throwing on malformed input', () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.!!!.c']) {
      expect(jwtExpiresInSeconds(bad), bad).toBeUndefined();
    }
  });

  it('returns undefined when the payload has no numeric exp', () => {
    const token = `x.${Buffer.from(JSON.stringify({ sub: '1' })).toString('base64url')}.y`;
    expect(jwtExpiresInSeconds(token)).toBeUndefined();
  });
});
