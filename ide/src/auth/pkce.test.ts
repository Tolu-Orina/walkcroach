import { describe, expect, it, vi } from 'vitest';
import {
  generateOAuthState,
  generateCodeVerifier,
  codeChallengeS256,
  refreshWithSpaClient,
} from './pkce.js';

describe('generateOAuthState', () => {
  it('returns a base64url string', () => {
    const s = generateOAuthState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThan(10);
  });
});

describe('PKCE re-exports', () => {
  // The implementation and its RFC 7636 vector live in the engine
  // (packages/agent-engine/src/pkce.test.ts). What matters here is only that the
  // IDE re-exports the real thing — these names were `@deprecated` stubs wired to
  // nothing until PKCE was actually implemented.
  const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('re-exports a working S256 derivation', () => {
    expect(codeChallengeS256(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('re-exports a verifier generator inside the RFC length range', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });
});

describe('refreshWithSpaClient', () => {
  it('posts InitiateAuth REFRESH_TOKEN_AUTH', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        AuthenticationResult: {
          AccessToken: 'at',
          IdToken: 'id',
          ExpiresIn: 3600,
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await refreshWithSpaClient({
      region: 'eu-west-2',
      clientId: 'spa-client',
      refreshToken: 'rt',
    });

    expect(tokens.access_token).toBe('at');
    expect(tokens.refresh_token).toBe('rt');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cognito-idp.eu-west-2.amazonaws.com/',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as { body: string }).body,
    );
    expect(body.AuthFlow).toBe('REFRESH_TOKEN_AUTH');
    expect(body.ClientId).toBe('spa-client');

    vi.unstubAllGlobals();
  });
});
