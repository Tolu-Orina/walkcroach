import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredSession } from './auth';

const storage: Record<string, unknown> = {};

function setupChrome() {
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const result: Record<string, unknown> = {};
          for (const k of keys) {
            if (k in storage) result[k] = storage[k];
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete storage[k];
        }),
      } as unknown as chrome.storage.LocalStorageArea,
      session: {
        get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
          const list = Array.isArray(keys)
            ? keys
            : typeof keys === 'string'
              ? [keys]
              : Object.keys(keys);
          const result: Record<string, unknown> = {};
          for (const k of list) {
            if (k in storage) result[k] = storage[k];
          }
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storage, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete storage[k];
        }),
      } as unknown as chrome.storage.SessionStorageArea,
    },
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
    tabs: {
      create: vi.fn(async () => ({ id: 1 })),
    } as unknown as typeof chrome.tabs,
    permissions: {} as typeof chrome.permissions,
  } as unknown as typeof chrome;
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(storage)) delete storage[k];
  setupChrome();
});

describe('loadSession', () => {
  it('returns null when nothing stored', async () => {
    const { loadSession } = await import('./auth');
    expect(await loadSession()).toBeNull();
  });

  it('returns session when all keys present', async () => {
    storage['wc_device_key'] = 'dk-1';
    storage['wc_access_token'] = 'tok';
    storage['wc_owner_id'] = 'owner';
    storage['wc_auth_source'] = 'device';
    storage['wc_token_expires_at'] = 9999999999999;

    const { loadSession } = await import('./auth');
    const session = await loadSession();
    expect(session).toEqual({
      deviceKey: 'dk-1',
      accessToken: 'tok',
      ownerId: 'owner',
      source: 'device',
      expiresAt: 9999999999999,
    });
  });

  it('defaults source to device when not stored', async () => {
    storage['wc_device_key'] = 'dk';
    storage['wc_access_token'] = 'tok';
    storage['wc_owner_id'] = 'o';
    const { loadSession } = await import('./auth');
    const session = await loadSession();
    expect(session!.source).toBe('device');
  });

  it('returns null when accessToken is missing', async () => {
    storage['wc_device_key'] = 'dk';
    storage['wc_owner_id'] = 'o';
    const { loadSession } = await import('./auth');
    expect(await loadSession()).toBeNull();
  });
});

describe('saveSession', () => {
  it('persists session to storage', async () => {
    const { saveSession } = await import('./auth');
    const session: StoredSession = {
      deviceKey: 'dk-2',
      accessToken: 'tok-2',
      ownerId: 'owner-2',
      source: 'cognito',
      expiresAt: 12345,
    };
    await saveSession(session);
    expect(storage['wc_device_key']).toBe('dk-2');
    expect(storage['wc_access_token']).toBe('tok-2');
    expect(storage['wc_owner_id']).toBe('owner-2');
    expect(storage['wc_auth_source']).toBe('cognito');
    expect(storage['wc_token_expires_at']).toBe(12345);
  });

  it('stores null for undefined expiresAt', async () => {
    const { saveSession } = await import('./auth');
    await saveSession({
      deviceKey: 'dk',
      accessToken: 't',
      ownerId: 'o',
      source: 'device',
    });
    expect(storage['wc_token_expires_at']).toBeNull();
  });
});

describe('ensureDeviceSession', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('mints a new device session when none exists', async () => {
    const { ensureDeviceSession } = await import('./auth');
    const createSession = vi.fn().mockResolvedValueOnce({
      accessToken: 'new-tok',
      ownerId: 'new-owner',
      deviceKey: 'server-dk',
      expiresIn: 3600,
    });

    const session = await ensureDeviceSession(createSession);
    expect(session.source).toBe('device');
    expect(session.accessToken).toBe('new-tok');
    expect(session.ownerId).toBe('new-owner');
    expect(session.deviceKey).toBe('server-dk');
  });

  it('returns existing fresh device session without reminting', async () => {
    storage['wc_device_key'] = 'dk-old';
    storage['wc_access_token'] = 'tok-old';
    storage['wc_owner_id'] = 'owner-old';
    storage['wc_auth_source'] = 'device';
    storage['wc_token_expires_at'] = Date.now() + 600_000;

    const { ensureDeviceSession } = await import('./auth');
    const createSession = vi.fn();

    const session = await ensureDeviceSession(createSession);
    expect(session.accessToken).toBe('tok-old');
    expect(session.deviceKey).toBe('dk-old');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('remints device session when near expiry', async () => {
    storage['wc_device_key'] = 'dk-old';
    storage['wc_access_token'] = 'tok-old';
    storage['wc_owner_id'] = 'owner-old';
    storage['wc_auth_source'] = 'device';
    storage['wc_token_expires_at'] = Date.now() + 30_000;

    const { ensureDeviceSession } = await import('./auth');
    const createSession = vi.fn().mockResolvedValueOnce({
      accessToken: 'tok-refreshed',
      ownerId: 'owner-old',
      expiresIn: 7200,
    });

    const session = await ensureDeviceSession(createSession);
    expect(session.accessToken).toBe('tok-refreshed');
    expect(session.deviceKey).toBe('dk-old');
    expect(createSession).toHaveBeenCalledWith('dk-old');
  });

  it('returns existing cognito session if not expired', async () => {
    storage['wc_device_key'] = 'dk';
    storage['wc_access_token'] = 'cognito-tok';
    storage['wc_owner_id'] = 'owner';
    storage['wc_auth_source'] = 'cognito';
    storage['wc_token_expires_at'] = Date.now() + 600_000;

    const { ensureDeviceSession } = await import('./auth');
    const createSession = vi.fn();

    const session = await ensureDeviceSession(createSession);
    expect(session.source).toBe('cognito');
    expect(session.accessToken).toBe('cognito-tok');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('falls back to device session when cognito token is near-expired and refresh fails', async () => {
    storage['wc_device_key'] = 'dk';
    storage['wc_access_token'] = 'expired-cognito';
    storage['wc_owner_id'] = 'owner';
    storage['wc_auth_source'] = 'cognito';
    storage['wc_token_expires_at'] = Date.now() + 30_000;
    storage['wc_refresh_token'] = 'rt-bad';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { ensureDeviceSession } = await import('./auth');
    const createSession = vi.fn().mockResolvedValueOnce({
      accessToken: 'device-tok',
      ownerId: 'owner',
      expiresIn: 3600,
    });

    const session = await ensureDeviceSession(createSession);
    expect(session.source).toBe('device');
    expect(session.accessToken).toBe('device-tok');
  });

  it('refreshes cognito via BFF when near expiry', async () => {
    storage['wc_device_key'] = 'dk';
    storage['wc_access_token'] = 'expired-cognito';
    storage['wc_owner_id'] = 'cognito-sub';
    storage['wc_auth_source'] = 'cognito';
    storage['wc_token_expires_at'] = Date.now() + 30_000;
    storage['wc_refresh_token'] = 'rt-good';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-access',
          id_token: 'new-id',
          refresh_token: 'rt-good',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { ensureDeviceSession } = await import('./auth');
    const createSession = vi.fn();

    const session = await ensureDeviceSession(createSession);
    expect(session.source).toBe('cognito');
    expect(session.accessToken).toBe('new-id');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent calls', async () => {
    const { ensureDeviceSession } = await import('./auth');
    let resolveFirst!: (v: unknown) => void;
    const deferred = new Promise((r) => {
      resolveFirst = r;
    });
    const createSession = vi.fn().mockImplementation(() => deferred);

    const p1 = ensureDeviceSession(createSession);
    const p2 = ensureDeviceSession(createSession);

    resolveFirst({
      accessToken: 'tok',
      ownerId: 'o',
      deviceKey: 'dk',
      expiresIn: 3600,
    });

    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toBe(s2);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('mints new session when refresh of existing device session fails', async () => {
    storage['wc_device_key'] = 'dk-fail';
    storage['wc_access_token'] = 'tok-fail';
    storage['wc_owner_id'] = 'owner-fail';
    storage['wc_auth_source'] = 'device';
    storage['wc_token_expires_at'] = Date.now() + 30_000;

    const { ensureDeviceSession } = await import('./auth');
    const createSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        accessToken: 'minted-tok',
        ownerId: 'minted-owner',
        deviceKey: 'dk-fail',
        expiresIn: 3600,
      });

    const session = await ensureDeviceSession(createSession);
    expect(session.accessToken).toBe('minted-tok');
    expect(createSession).toHaveBeenCalledTimes(2);
  });
});

describe('chromeRedirectUri', () => {
  it('builds auth.html redirect for this extension id', async () => {
    const { chromeRedirectUri } = await import('./auth');
    expect(chromeRedirectUri()).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/auth.html',
    );
  });
});

describe('startWebSignIn', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('stores pending oauth and opens WalkCroach connect tab', async () => {
    const { startWebSignIn } = await import('./auth');
    // No chrome.identity in this mock, so we take the tab fallback and the
    // exchange is completed later by auth.html.
    const outcome = await startWebSignIn('https://walkcroach.example');
    expect(outcome.kind).toBe('delegated');
    const url = outcome.kind === 'delegated' ? outcome.url : '';
    expect(url).toContain('/connect/chrome?');
    expect(url).toContain('state=');
    expect(url).toContain(
      encodeURIComponent(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/auth.html',
      ),
    );
    expect(chrome.tabs.create).toHaveBeenCalled();
    expect(storage['wc_oauth_pending']).toMatchObject({
      redirectUri:
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/auth.html',
    });
  });
});

describe('upgradeToCognito', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when no device session exists', async () => {
    const { upgradeToCognito } = await import('./auth');
    await expect(upgradeToCognito('cognito-tok')).rejects.toThrow(
      'no device session to upgrade',
    );
  });

  it('upgrades existing device session to cognito', async () => {
    storage['wc_device_key'] = 'dk';
    storage['wc_access_token'] = 'old-tok';
    storage['wc_owner_id'] = 'old-owner';
    storage['wc_auth_source'] = 'device';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, merged: true, ownerId: 'cognito-sub' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { upgradeToCognito } = await import('./auth');
    const session = await upgradeToCognito('cognito-access');
    expect(session.source).toBe('cognito');
    expect(session.accessToken).toBe('cognito-access');
    expect(session.ownerId).toBe('cognito-sub');
    expect(session.deviceKey).toBe('dk');
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    // Opaque paste must not claim to be a Cognito access_token for the SDK.
    expect(storage['wc_cognito_access_token']).toBeUndefined();
    expect(storage['wc_id_token']).toBe('cognito-access');
  });
});

describe('redirect URIs (Phase A5 / B1)', () => {
  const ID = 'abcdefghijklmnopabcdefghijklmnop';

  it('builds the launchWebAuthFlow redirect from the extension ID', async () => {
    const { identityRedirectUri } = await import('./auth');
    expect(identityRedirectUri()).toBe(`https://${ID}.chromiumapp.org/auth`);
  });

  it('builds the legacy auth.html redirect', async () => {
    const { chromeRedirectUri } = await import('./auth');
    expect(chromeRedirectUri()).toBe(`chrome-extension://${ID}/auth.html`);
  });

  it('both forms satisfy the BFF allowlist pattern', async () => {
    // Mirrors CHROME_REDIRECT_PATTERN in lambda-chrome oauth.ts and
    // REDIRECT_PATTERN in web ConnectChromePage.tsx.
    const pattern =
      /^(?:chrome-extension:\/\/[a-p]{32}\/auth\.html|https:\/\/[a-p]{32}\.chromiumapp\.org\/auth)$/;
    const { chromeRedirectUri, identityRedirectUri } = await import('./auth');
    expect(pattern.test(chromeRedirectUri())).toBe(true);
    expect(pattern.test(identityRedirectUri())).toBe(true);
  });

  it('refuses to build a URI from a missing or malformed runtime id', async () => {
    // This is what produced `chrome-extension://invalid/auth.html` and an
    // opaque "redirectUri is not allowed" from the BFF.
    const { extensionId } = await import('./auth');
    (globalThis.chrome as unknown as { runtime: { id?: string } }).runtime.id =
      undefined;
    expect(() => extensionId()).toThrow(/Extension ID is unavailable/);
    (globalThis.chrome as unknown as { runtime: { id?: string } }).runtime.id =
      'ZZZZ';
    expect(() => extensionId()).toThrow(/Extension ID is unavailable/);
  });
});

describe('buildConnectUrl', () => {
  it('targets /connect/chrome with state, redirect_uri and the PKCE challenge', async () => {
    const { buildConnectUrl } = await import('./auth');
    const url = new URL(
      buildConnectUrl(
        'https://web.test/',
        'st8',
        'https://x.chromiumapp.org/auth',
        'the-challenge',
      ),
    );
    expect(url.origin + url.pathname).toBe('https://web.test/connect/chrome');
    expect(url.searchParams.get('state')).toBe('st8');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://x.chromiumapp.org/auth',
    );
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never puts the verifier in the URL', async () => {
    const { buildConnectUrl } = await import('./auth');
    const { generatePkce } = await import('./pkce');
    const { verifier, challenge } = await generatePkce();
    const url = buildConnectUrl(
      'https://web.test/',
      'st8',
      'https://x.chromiumapp.org/auth',
      challenge,
    );
    // The entire point: Web sees the challenge, never what redeems it.
    expect(url).not.toContain(verifier);
    expect(url).toContain(encodeURIComponent(challenge).replace(/%2D/g, '-'));
  });
});

describe('parseAuthCallback', () => {
  it('reads code and state from the query', async () => {
    const { parseAuthCallback } = await import('./auth');
    expect(
      parseAuthCallback('https://x.chromiumapp.org/auth?code=c1&state=s1'),
    ).toEqual({ code: 'c1', state: 's1' });
  });

  it('reads code and state from the fragment', async () => {
    const { parseAuthCallback } = await import('./auth');
    expect(
      parseAuthCallback('https://x.chromiumapp.org/auth#code=c2&state=s2'),
    ).toEqual({ code: 'c2', state: 's2' });
  });

  it('surfaces a provider error instead of a generic failure', async () => {
    const { parseAuthCallback } = await import('./auth');
    expect(() =>
      parseAuthCallback('https://x.chromiumapp.org/auth?error=access_denied'),
    ).toThrow(/access_denied/);
  });

  it('rejects a callback with no code', async () => {
    const { parseAuthCallback } = await import('./auth');
    expect(() =>
      parseAuthCallback('https://x.chromiumapp.org/auth?state=s'),
    ).toThrow(/connect code/);
  });
});

describe('startWebSignIn', () => {
  it('falls back to the auth.html tab flow when identity is unavailable', async () => {
    const { startWebSignIn } = await import('./auth');
    const outcome = await startWebSignIn('https://web.test');
    expect(outcome.kind).toBe('delegated');
    expect(chrome.tabs.create).toHaveBeenCalledOnce();

    const pending = storage['wc_oauth_pending'] as { redirectUri: string };
    expect(pending.redirectUri).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/auth.html',
    );
  });

  it('uses launchWebAuthFlow when identity is available', async () => {
    const launchWebAuthFlow = vi.fn(
      async (_opts: { url: string; interactive: boolean }) =>
        undefined as string | undefined,
    );
    (globalThis.chrome as unknown as { identity: unknown }).identity = {
      launchWebAuthFlow,
    };

    const { startWebSignIn } = await import('./auth');
    // Undefined callback == user closed the window.
    await expect(startWebSignIn('https://web.test')).rejects.toThrow(
      /cancelled/i,
    );
    expect(chrome.tabs.create).not.toHaveBeenCalled();

    const call = launchWebAuthFlow.mock.calls[0]![0];
    expect(call.interactive).toBe(true);
    expect(new URL(call.url).searchParams.get('redirect_uri')).toBe(
      'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth',
    );
    // Pending state must not linger after a cancel.
    expect(storage['wc_oauth_pending']).toBeUndefined();
  });

  it('throws when the Web URL is not configured', async () => {
    const { startWebSignIn } = await import('./auth');
    await expect(startWebSignIn('')).rejects.toThrow(/not configured/);
  });
});

describe('signOutToDevice', () => {
  it('revokes Cognito via the BFF before clearing local slots', async () => {
    storage.wc_device_key = 'dk';
    storage.wc_access_token = 'id-bearer';
    storage.wc_owner_id = 'sub';
    storage.wc_auth_source = 'cognito';
    storage.wc_cognito_access_token = 'access-tok';
    storage.wc_refresh_token = 'refresh-tok';
    storage.wc_id_token = 'id-tok';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { signOutToDevice } = await import('./auth');
    const session = await signOutToDevice(async (deviceKey) => ({
      accessToken: 'device-jwt',
      ownerId: 'anon:device:x',
      deviceKey,
      expiresIn: 3600,
    }));

    expect(fetchMock).toHaveBeenCalled();
    const revokeCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/oauth/revoke'),
    );
    expect(revokeCall).toBeTruthy();
    expect(JSON.parse(String(revokeCall![1]?.body))).toEqual({
      accessToken: 'access-tok',
      refreshToken: 'refresh-tok',
    });
    expect(session.source).toBe('device');
    expect(storage.wc_cognito_access_token).toBeUndefined();
    expect(storage.wc_refresh_token).toBeUndefined();
  });

  it('still remints a device session if Cognito revoke fails', async () => {
    storage.wc_device_key = 'dk';
    storage.wc_access_token = 'id-bearer';
    storage.wc_owner_id = 'sub';
    storage.wc_auth_source = 'cognito';
    storage.wc_cognito_access_token = 'access-tok';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('nope', { status: 502 }),
    );

    const { signOutToDevice } = await import('./auth');
    const session = await signOutToDevice(async () => ({
      accessToken: 'device-jwt',
      ownerId: 'anon:device:y',
      deviceKey: 'dk',
    }));
    expect(session.source).toBe('device');
    expect(session.accessToken).toBe('device-jwt');
  });
});
