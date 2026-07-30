/**
 * Per-tab page-extract cache in `chrome.storage.session` (Phase A2).
 *
 * Two jobs:
 *  1. Warm the panel — when the toolbar click that opened the panel leaves
 *     `activeTab` live for a moment, we spend it once and keep the result, so
 *     later in-panel clicks do not need a gesture they cannot produce.
 *  2. Avoid re-scripting the same unchanged page on every action.
 *
 * Session storage (not local) on purpose: page text must not survive the browser
 * session on disk. Entries are also dropped on navigation, tab close, and
 * permission revocation.
 */

import type { PageExtract } from './extract';

export const EXTRACT_CACHE_TTL_MS = 5 * 60_000;
const KEY_PREFIX = 'extract:';

export type CachedExtract = {
  extract: PageExtract;
  /** URL at capture time — a mismatch means the tab navigated. */
  url: string;
  capturedAt: number;
};

export function cacheKey(tabId: number): string {
  return `${KEY_PREFIX}${tabId}`;
}

export async function readCachedExtract(
  tabId: number,
  url: string,
  now = Date.now(),
): Promise<PageExtract | null> {
  const key = cacheKey(tabId);
  const raw = await chrome.storage.session.get(key);
  const entry = raw[key] as CachedExtract | undefined;
  if (!entry?.extract) return null;
  if (entry.url !== url) return null;
  if (now - entry.capturedAt > EXTRACT_CACHE_TTL_MS) return null;
  return entry.extract;
}

export async function writeCachedExtract(
  tabId: number,
  extract: PageExtract,
  now = Date.now(),
): Promise<void> {
  const entry: CachedExtract = {
    extract,
    url: extract.url,
    capturedAt: now,
  };
  await chrome.storage.session.set({ [cacheKey(tabId)]: entry });
}

export async function clearCachedExtract(tabId: number): Promise<void> {
  await chrome.storage.session.remove(cacheKey(tabId));
}

/**
 * Drop every cached extract. Used when the user revokes a site grant — we do not
 * keep page text for an origin they just withdrew — and on install/update.
 */
export async function clearAllCachedExtracts(): Promise<void> {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(KEY_PREFIX));
  if (keys.length) await chrome.storage.session.remove(keys);
}
