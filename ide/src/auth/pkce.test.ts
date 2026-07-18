import { describe, expect, it, vi } from 'vitest';
import {
  generateCodeVerifier,
  codeChallengeS256,
  generateOAuthState,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from './pkce.js';

describe('generateCodeVerifier', () => {
  it('returns a base64url string of consistent length', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThan(20);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique values each call', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe('codeChallengeS256', () => {
  it('produces a deterministic SHA-256 base64url digest', () => {
    const verifier = 'test-verifier-1234';
    const c1 = codeChallengeS256(verifier);
    const c2 = codeChallengeS256(verifier);
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c1.length).toBeGreaterThan(10);
  });

  it('differs for different verifiers', () => {
    expect(codeChallengeS256('aaa')).not.toBe(codeChallengeS256('bbb'));
  });
});

describe('generateOAuthState', () => {
  it('returns a base64url string', () => {
    const s = generateOAuthState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeGreaterThan(10);
  });
});

describe('buildAuthorizeUrl', () => {
  it('constructs a valid Cognito authorize URL', () => {
    const url = buildAuthorizeUrl({
      hostedUiBaseUrl: 'https://auth.example.com',
      clientId: 'client-abc',
      redirectUri: 'vscode://walkcroach/auth',
      codeChallenge: 'challenge123',
      state: 'state456',
    });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/oauth2/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-abc');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('redirect_uri')).toBe('vscode://walkcroach/auth');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge123');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('state456');
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
  });

  it('accepts custom scopes', () => {
    const url = buildAuthorizeUrl({
      hostedUiBaseUrl: 'https://auth.example.com/',
      clientId: 'c1',
      redirectUri: 'http://localhost',
      codeChallenge: 'cc',
      state: 'ss',
      scopes: ['openid'],
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toBe('openid');
  });

  it('strips trailing slash from hostedUiBaseUrl', () => {
    const url = buildAuthorizeUrl({
      hostedUiBaseUrl: 'https://auth.example.com/',
      clientId: 'c1',
      redirectUri: 'x',
      codeChallenge: 'cc',
      state: 'ss',
    });
    expect(url).toContain('https://auth.example.com/oauth2/authorize');
    expect(url).not.toContain('//oauth2');
  });
});

describe('exchangeAuthorizationCode', () => {
  it('posts to token endpoint and returns tokens', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'at-123',
          id_token: 'it-456',
          refresh_token: 'rt-789',
          expires_in: 3600,
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await exchangeAuthorizationCode({
      hostedUiBaseUrl: 'https://auth.example.com',
      clientId: 'c1',
      redirectUri: 'http://localhost/callback',
      code: 'auth-code',
      codeVerifier: 'verifier-abc',
    });

    expect(result.access_token).toBe('at-123');
    expect(result.refresh_token).toBe('rt-789');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://auth.example.com/oauth2/token',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      exchangeAuthorizationCode({
        hostedUiBaseUrl: 'https://auth.example.com',
        clientId: 'c1',
        redirectUri: 'x',
        code: 'bad-code',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(/400/);

    vi.unstubAllGlobals();
  });
});

describe('refreshAccessToken', () => {
  it('posts refresh_token grant and returns tokens', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'new-at',
          expires_in: 3600,
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await refreshAccessToken({
      hostedUiBaseUrl: 'https://auth.example.com',
      clientId: 'c1',
      refreshToken: 'rt-old',
    });

    expect(result.access_token).toBe('new-at');
    vi.unstubAllGlobals();
  });

  it('throws on non-ok response', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('token_expired'),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      refreshAccessToken({
        hostedUiBaseUrl: 'https://auth.example.com',
        clientId: 'c1',
        refreshToken: 'bad-rt',
      }),
    ).rejects.toThrow(/401/);

    vi.unstubAllGlobals();
  });
});
