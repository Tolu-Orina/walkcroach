import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      } as unknown as chrome.storage.SessionStorageArea,
    },
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' },
  } as unknown as typeof chrome;
}

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(storage)) delete storage[k];
  setupChrome();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getSdkAccessToken', () => {
  it('returns undefined for device sessions', async () => {
    storage.wc_device_key = 'dk';
    storage.wc_access_token = 'device-jwt';
    storage.wc_owner_id = 'o';
    storage.wc_auth_source = 'device';

    const { getSdkAccessToken } = await import('./sdkClient');
    expect(await getSdkAccessToken()).toBeUndefined();
  });

  it('prefers real Cognito access_token over id_token', async () => {
    storage.wc_device_key = 'dk';
    storage.wc_access_token = 'id-as-bearer';
    storage.wc_owner_id = 'o';
    storage.wc_auth_source = 'cognito';
    storage.wc_cognito_access_token = 'access-token';
    storage.wc_id_token = 'id-token';

    const { getSdkAccessToken } = await import('./sdkClient');
    expect(await getSdkAccessToken()).toBe('access-token');
  });

  it('falls back to id_token then bearer', async () => {
    storage.wc_device_key = 'dk';
    storage.wc_access_token = 'bearer';
    storage.wc_owner_id = 'o';
    storage.wc_auth_source = 'cognito';
    storage.wc_id_token = 'id-only';

    const { getSdkAccessToken } = await import('./sdkClient');
    expect(await getSdkAccessToken()).toBe('id-only');
  });
});

describe('sdkBaseUrl', () => {
  it('strips trailing /v1', async () => {
    // Compile-time define defaults to localhost:3003 in tests (undefined const).
    const { sdkBaseUrl } = await import('./sdkClient');
    expect(sdkBaseUrl()).not.toMatch(/\/v1$/i);
  });
});
