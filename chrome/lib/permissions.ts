/**
 * Optional host permissions (v0.2.0 — Phase A1).
 *
 * Why this file came back: `activeTab` is only activated by a toolbar action
 * click, a context-menu item, a commands shortcut, or an omnibox suggestion.
 * A click *inside the side panel* is none of those, so the v0.1.3 activeTab-only
 * model could never satisfy "open the panel once, then Summarize as you browse".
 *
 * The manifest therefore declares `optional_host_permissions` for http(s) and we
 * request a single origin from the button click that needs it — `permissions.request`
 * itself counts as a qualifying user gesture. Install stays warning-free, and the
 * Sites list in the panel becomes a real capability again (grant + revoke).
 *
 * Every function here is safe to call from the side panel; `request()` in particular
 * MUST be called from the panel (a gesture-bearing context), never from the worker.
 */

import { API_BASE } from './api';

declare const __WALKCROACH_IDE_API_BASE__: string;

/** IDE / SDK host — install-time grant in split-origin local builds. */
const IDE_API_BASE =
  typeof __WALKCROACH_IDE_API_BASE__ !== 'undefined'
    ? __WALKCROACH_IDE_API_BASE__
    : 'http://localhost:3003';

/** Schemes no extension can script, regardless of permissions. */
const RESTRICTED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'chrome-search:',
  'chrome-devtools:',
  'devtools:',
  'about:',
  'edge:',
  'brave:',
  'opera:',
  'vivaldi:',
  'view-source:',
  'data:',
  'blob:',
  'javascript:',
  'filesystem:',
];

/** Hosts Chrome blocks extension scripting on even over https. */
const RESTRICTED_HOSTS = [
  'chrome.google.com',
  'chromewebstore.google.com',
];

export type RestrictedReason =
  | 'scheme'
  | 'webstore'
  | 'local-file'
  | 'unparseable';

/**
 * Why a URL can never be read, or `null` when it is readable in principle
 * (it may still need a grant — see `hasOriginPermission`).
 */
export function restrictedReason(url: string): RestrictedReason | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'unparseable';
  }
  if (parsed.protocol === 'file:') return 'local-file';
  if (RESTRICTED_SCHEMES.includes(parsed.protocol)) return 'scheme';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'scheme';
  }
  if (RESTRICTED_HOSTS.includes(parsed.hostname)) return 'webstore';
  return null;
}

export function isSupportedPageUrl(url: string): boolean {
  return restrictedReason(url) === null;
}

/**
 * `https://www.example.com/a?b=1` → `https://www.example.com/*`.
 * Returns null for anything we could never be granted access to.
 *
 * Deliberately host-exact (not wildcard-subdomain): the user grants the site
 * they are looking at, not `*.example.com`.
 */
export function originPatternFromUrl(url: string): string | null {
  if (!isSupportedPageUrl(url)) return null;
  const u = new URL(url);
  return `${u.protocol}//${u.host}/*`;
}

/** `https://www.example.com/*` → `www.example.com` (for user-facing copy). */
export function originLabel(originPattern: string): string {
  return originPattern.replace(/^\w+:\/\//, '').replace(/\/\*$/, '');
}

/** Install-time API / IDE hosts — never shown or revokable in the Sites list. */
function protectedOriginPatterns(): string[] {
  const out: string[] = [];
  for (const base of [API_BASE, IDE_API_BASE]) {
    try {
      const u = new URL(base);
      out.push(`${u.protocol}//${u.host}/*`);
    } catch {
      // ignore malformed define
    }
  }
  return out;
}

function isProtectedOrigin(originPattern: string): boolean {
  return protectedOriginPatterns().includes(originPattern);
}

export async function hasOriginPermission(
  originPattern: string,
): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [originPattern] });
  } catch {
    return false;
  }
}

/**
 * Prompt for a single origin. Must be called synchronously enough after a click
 * that Chrome still considers it a user gesture — i.e. do not `await` network
 * calls before this.
 *
 * Resolves false when the user declines; only throws on a malformed pattern.
 */
export async function requestOriginPermission(
  originPattern: string,
): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}

/** Grant the origin for `pageUrl` if we do not already hold it. */
export async function ensureOriginPermission(
  pageUrl: string,
): Promise<boolean> {
  const pattern = originPatternFromUrl(pageUrl);
  if (!pattern) return false;
  if (await hasOriginPermission(pattern)) return true;
  return requestOriginPermission(pattern);
}

/**
 * Origins the user has granted, excluding the install-time API host.
 * Sorted for a stable Sites list.
 */
export async function listGrantedOrigins(): Promise<string[]> {
  try {
    const all = await chrome.permissions.getAll();
    const protectedOrigins = new Set(protectedOriginPatterns());
    return (all.origins ?? [])
      .filter((o) => !protectedOrigins.has(o))
      .filter((o) => o !== 'http://*/*' && o !== 'https://*/*')
      .sort((a, b) => originLabel(a).localeCompare(originLabel(b)));
  } catch {
    return [];
  }
}

export async function revokeOrigin(originPattern: string): Promise<boolean> {
  if (isProtectedOrigin(originPattern)) return false;
  try {
    return await chrome.permissions.remove({ origins: [originPattern] });
  } catch {
    return false;
  }
}
