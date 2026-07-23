import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  originFromUrl,
  ensureOriginPermission,
  revokeOrigin,
  listGrantedOrigins,
} from './permissions';

const storage: Record<string, unknown> = {};

beforeEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(storage)) delete storage[k];

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
    permissions: {
      contains: vi.fn(),
      request: vi.fn(),
      remove: vi.fn(),
      getAll: vi.fn(),
    } as unknown as typeof chrome.permissions,
  } as unknown as typeof chrome;
});

describe('originFromUrl', () => {
  it('extracts https origin pattern', async () => {
    expect(await originFromUrl('https://www.example.com/path?q=1')).toBe(
      'https://www.example.com/*',
    );
  });

  it('extracts http origin pattern', async () => {
    expect(await originFromUrl('http://localhost:3000/api')).toBe(
      'http://localhost:3000/*',
    );
  });

  it('handles URL with port', async () => {
    expect(await originFromUrl('https://app.test:8443/foo')).toBe(
      'https://app.test:8443/*',
    );
  });
});

describe('ensureOriginPermission', () => {
  it('returns true when permission already granted', async () => {
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const result = await ensureOriginPermission('https://example.com/page');
    expect(result).toBe(true);
  });

  it('requests permission and returns true when granted', async () => {
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    (chrome.permissions.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    const result = await ensureOriginPermission('https://new.example.com/x');
    expect(result).toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['https://new.example.com/*'],
    });
  });

  it('returns false when user denies permission', async () => {
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    (chrome.permissions.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const result = await ensureOriginPermission('https://denied.com/page');
    expect(result).toBe(false);
  });
});

describe('revokeOrigin', () => {
  it('removes permission and reports telemetry', async () => {
    (chrome.permissions.remove as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    storage['wc_device_key'] = 'dk';
    storage['wc_access_token'] = 'tok';
    storage['wc_owner_id'] = 'owner';

    const result = await revokeOrigin('https://revoked.com/*');
    expect(result).toBe(true);
    expect(chrome.permissions.remove).toHaveBeenCalledWith({
      origins: ['https://revoked.com/*'],
    });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  it('returns false when removal fails', async () => {
    (chrome.permissions.remove as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const result = await revokeOrigin('https://keep.com/*');
    expect(result).toBe(false);
  });
});

describe('listGrantedOrigins', () => {
  it('returns origins from chrome.permissions.getAll', async () => {
    (chrome.permissions.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      origins: ['https://a.com/*', 'https://b.com/*'],
      permissions: [],
    });
    const origins = await listGrantedOrigins();
    expect(origins).toEqual(['https://a.com/*', 'https://b.com/*']);
  });

  it('returns empty array when no origins', async () => {
    (chrome.permissions.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      permissions: [],
    });
    const origins = await listGrantedOrigins();
    expect(origins).toEqual([]);
  });
});
