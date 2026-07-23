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

describe('legacy PKCE helpers', () => {
  it('generateCodeVerifier returns base64url', () => {
    const v = generateCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('codeChallengeS256 is deterministic', () => {
    expect(codeChallengeS256('abc')).toBe(codeChallengeS256('abc'));
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
