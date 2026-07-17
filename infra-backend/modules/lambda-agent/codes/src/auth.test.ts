import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('resolveAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.ALLOW_DEV_AUTH;
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
  });

  it('returns null without authorization header', async () => {
    const { resolveAuth } = await import('./auth.js');
    expect(await resolveAuth({})).toBeNull();
  });

  it('accepts dev user token when ALLOW_DEV_AUTH is enabled', async () => {
    process.env.ALLOW_DEV_AUTH = 'true';
    const { resolveAuth } = await import('./auth.js');
    const auth = await resolveAuth({ authorization: 'Bearer dev:user:abc-123' });
    expect(auth).toEqual({
      ownerId: 'user:abc-123',
      isAnonymous: false,
      source: 'dev',
    });
  });

  it('accepts dev anon token when ALLOW_DEV_AUTH is enabled', async () => {
    process.env.ALLOW_DEV_AUTH = 'true';
    const { resolveAuth } = await import('./auth.js');
    const auth = await resolveAuth({ authorization: 'Bearer dev:anon:guest-1' });
    expect(auth).toEqual({
      ownerId: 'anon:guest-1',
      isAnonymous: true,
      source: 'dev',
    });
  });

  it('rejects dev tokens when ALLOW_DEV_AUTH is false', async () => {
    process.env.ALLOW_DEV_AUTH = 'false';
    const { resolveAuth } = await import('./auth.js');
    expect(await resolveAuth({ authorization: 'Bearer dev:user:abc' })).toBeNull();
  });

  it('verifies Cognito access tokens when pool is configured', async () => {
    vi.doMock('aws-jwt-verify', () => ({
      CognitoJwtVerifier: {
        create: () => ({
          verify: async (token: string) => {
            if (token === 'valid-access') return { sub: 'cognito-sub-99' };
            throw new Error('invalid jwt');
          },
        }),
      },
    }));

    process.env.ALLOW_DEV_AUTH = 'false';
    process.env.COGNITO_USER_POOL_ID = 'eu-west-2_TestPool';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';

    const { resolveAuth, requireAuth } = await import('./auth.js');
    const auth = await resolveAuth({ authorization: 'Bearer valid-access' });
    expect(auth).toEqual({
      ownerId: 'cognito-sub-99',
      isAnonymous: false,
      source: 'jwt',
    });

    const required = await requireAuth({ authorization: 'Bearer valid-access' });
    expect(required).toEqual(auth);
  });

  it('requireAuth returns 401 when unauthenticated', async () => {
    const { requireAuth } = await import('./auth.js');
    const result = await requireAuth({});
    expect(result).toEqual({ error: 'authorization required', status: 401 });
  });
});
