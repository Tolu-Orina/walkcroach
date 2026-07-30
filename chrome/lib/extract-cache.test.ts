import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EXTRACT_CACHE_TTL_MS,
  cacheKey,
  clearAllCachedExtracts,
  clearCachedExtract,
  readCachedExtract,
  writeCachedExtract,
} from './extract-cache';
import type { PageExtract } from './extract';

let store: Record<string, unknown>;

const extract = (url: string): PageExtract => ({
  url,
  title: 'T',
  extractedText: 'body text',
  contentHash: 'fnv:abc',
});

beforeEach(() => {
  store = {};
  globalThis.chrome = {
    storage: {
      session: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null) return { ...store };
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        }),
      },
    },
  } as unknown as typeof chrome;
});

describe('extract cache', () => {
  it('round-trips an extract for the same tab and URL', async () => {
    await writeCachedExtract(4, extract('https://a.test/x'), 1_000);
    await expect(
      readCachedExtract(4, 'https://a.test/x', 1_500),
    ).resolves.toEqual(extract('https://a.test/x'));
  });

  it('keys by tab so two tabs never bleed into each other', async () => {
    await writeCachedExtract(4, extract('https://a.test/x'), 1_000);
    expect(cacheKey(4)).not.toBe(cacheKey(5));
    await expect(
      readCachedExtract(5, 'https://a.test/x', 1_000),
    ).resolves.toBeNull();
  });

  it('misses after the tab navigates, even within TTL', async () => {
    await writeCachedExtract(4, extract('https://a.test/x'), 1_000);
    await expect(
      readCachedExtract(4, 'https://a.test/other', 1_100),
    ).resolves.toBeNull();
  });

  it('expires so a long-open panel never serves stale page text', async () => {
    await writeCachedExtract(4, extract('https://a.test/x'), 0);
    await expect(
      readCachedExtract(4, 'https://a.test/x', EXTRACT_CACHE_TTL_MS - 1),
    ).resolves.not.toBeNull();
    await expect(
      readCachedExtract(4, 'https://a.test/x', EXTRACT_CACHE_TTL_MS + 1),
    ).resolves.toBeNull();
  });

  it('clears one tab', async () => {
    await writeCachedExtract(4, extract('https://a.test/x'));
    await clearCachedExtract(4);
    await expect(
      readCachedExtract(4, 'https://a.test/x'),
    ).resolves.toBeNull();
  });

  it('clears every extract without touching unrelated session keys', async () => {
    await writeCachedExtract(4, extract('https://a.test/x'));
    await writeCachedExtract(5, extract('https://b.test/y'));
    store['wc_oauth_pending'] = { state: 's' };

    await clearAllCachedExtracts();

    await expect(readCachedExtract(4, 'https://a.test/x')).resolves.toBeNull();
    await expect(readCachedExtract(5, 'https://b.test/y')).resolves.toBeNull();
    expect(store['wc_oauth_pending']).toEqual({ state: 's' });
  });
});
