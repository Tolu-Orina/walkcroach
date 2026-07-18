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
      } as unknown as chrome.storage.LocalStorageArea,
      session: {} as chrome.storage.SessionStorageArea,
    },
    runtime: { id: 'ext-id' },
    permissions: {} as chrome.Permissions,
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

  it('refreshes existing device session', async () => {
    storage['wc_device_key'] = 'dk-old';
    storage['wc_access_token'] = 'tok-old';
    storage['wc_owner_id'] = 'owner-old';
    storage['wc_auth_source'] = 'device';

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

  it('falls back to device session when cognito token is near-expired', async () => {
    storage['wc_device_key'] = 'dk';
    storage['wc_access_token'] = 'expired-cognito';
    storage['wc_owner_id'] = 'owner';
    storage['wc_auth_source'] = 'cognito';
    storage['wc_token_expires_at'] = Date.now() + 30_000;

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
  });
});
