import { defineConfig } from 'wxt';

// Fail closed only for release/zip builds (set WALKCROACH_REQUIRE_PROD_ENV=true).
const requireProdEnv = process.env.WALKCROACH_REQUIRE_PROD_ENV === 'true';

const apiBase =
  process.env.WALKCROACH_API_BASE ?? 'http://localhost:3002';
const privacyUrl =
  process.env.WALKCROACH_PRIVACY_URL ??
  'http://localhost:5173/chrome-privacy.html';
const webUrl =
  process.env.WALKCROACH_WEB_URL ?? 'http://localhost:5173';
/**
 * IDE / public SDK API (memory `/v1`). Local default is ide-api :3003.
 * Production shares the custom domain with the chrome BFF — omit to derive
 * from WALKCROACH_API_BASE host.
 */
const ideApiBase =
  process.env.WALKCROACH_IDE_API_BASE ??
  (apiBase.includes('localhost') || apiBase.includes('127.0.0.1')
    ? 'http://localhost:3003'
    : apiBase.replace(/\/v1\/?$/i, '') || apiBase);

if (requireProdEnv && !process.env.WALKCROACH_API_BASE) {
  throw new Error(
    'WALKCROACH_API_BASE must be set for production Chrome extension builds',
  );
}
if (requireProdEnv && !process.env.WALKCROACH_PRIVACY_URL) {
  throw new Error(
    'WALKCROACH_PRIVACY_URL must be set for production Chrome extension builds',
  );
}
if (requireProdEnv && !process.env.WALKCROACH_WEB_URL) {
  throw new Error(
    'WALKCROACH_WEB_URL must be set for production Chrome extension builds',
  );
}
if (requireProdEnv) {
  for (const [label, value] of [
    ['WALKCROACH_API_BASE', apiBase],
    ['WALKCROACH_IDE_API_BASE', ideApiBase],
    ['WALKCROACH_PRIVACY_URL', privacyUrl],
    ['WALKCROACH_WEB_URL', webUrl],
  ] as const) {
    if (!value.startsWith('https://') || value.includes('localhost')) {
      throw new Error(
        `${label} must be an https production URL (not localhost)`,
      );
    }
  }
}

/** Narrow host permission for our BFF only — not page hosts / not <all_urls>. */
function apiHostPermission(base: string): string {
  const u = new URL(base);
  return `${u.protocol}//${u.host}/*`;
}

const apiHost = apiHostPermission(apiBase);
const ideApiHost = apiHostPermission(ideApiBase);
/** Deduped install-time hosts (prod: chrome BFF + IDE share one origin). */
const apiHosts = [...new Set([apiHost, ideApiHost])];
/** Only WalkCroach Web may navigate to auth.html (Phase A4). */
const webMatchPattern = apiHostPermission(webUrl);

/**
 * Pin the extension ID (Phase A5).
 *
 * Unpacked extensions get an ID derived from their absolute path, so it changes
 * per machine and per checkout — which silently breaks every OAuth redirect URI
 * built from `chrome.runtime.id`. Setting `key` fixes the ID everywhere.
 * See VERSIONING.md for how to generate one and how the CWS ID relates.
 */
const extensionKey = process.env.WALKCROACH_EXTENSION_KEY?.trim();
if (requireProdEnv && extensionKey) {
  // The store assigns the ID from the key it holds; shipping a local dev key in
  // a store zip would produce an ID mismatch against the OAuth allowlists.
  throw new Error(
    'WALKCROACH_EXTENSION_KEY must not be set for store builds — the Chrome Web Store supplies the key.',
  );
}

/**
 * E2E test seam: pre-grant page origins at install time.
 *
 * Chrome's optional-permission prompt is native browser UI that Playwright
 * cannot click, so `tests/e2e/chrome` builds a fixture with the local fixture
 * server already in `host_permissions`. That exercises everything downstream of
 * the grant (extraction, caching, revocation) against real Chrome APIs.
 *
 * Guarded: never permitted in a store build.
 */
const testGrantOrigins = (process.env.WALKCROACH_TEST_GRANT_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (requireProdEnv && testGrantOrigins.length) {
  throw new Error(
    'WALKCROACH_TEST_GRANT_ORIGINS must not be set for store builds — it pre-grants page access.',
  );
}

/**
 * Base64 Ed25519 public key for signed site-profile bundles (Phase D6).
 *
 * Empty until signing keys are provisioned, which disables remote profiles
 * entirely — the packaged bundle stays in force. That is the safe default: a
 * build that cannot verify a signature must never accept an unsigned bundle.
 */
const profilesPublicKey = process.env.WALKCROACH_PROFILES_PUBLIC_KEY?.trim() ?? '';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'WalkCroach',
    description:
      'Summarize, draft, and remember. A trust-first browser copilot for SMEs.',
    ...(extensionKey ? { key: extensionKey } : {}),
    /**
     * `identity` powers launchWebAuthFlow sign-in (Phase B1).
     *
     * `activeTab` + `contextMenus` exist to give us *qualifying gestures*.
     * Chrome activates `activeTab` for a toolbar action click, a context-menu
     * item, and a commands shortcut — but never for a click inside the side
     * panel. We handle the action click ourselves (see background.ts) so that
     * grant is deterministic rather than an undocumented side effect of
     * `openPanelOnActionClick`. Durable page access still comes from the
     * optional hosts below.
     */
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      'sidePanel',
      'identity',
      'contextMenus',
    ],
    /**
     * A keyboard shortcut is a qualifying gesture too. `_execute_action` routes
     * through the same `action.onClicked` handler, so there is one code path.
     */
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+W' },
        description: 'Open WalkCroach for this page',
      },
    },
    host_permissions: [...apiHosts, ...testGrantOrigins],
    /**
     * No install-time page access and no scary warning. The panel requests one
     * origin at a time from the click that needs it (Phase A1), and the Sites
     * list can revoke each one.
     */
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    /**
     * Phase A4 — the sign-in bug. Chrome blocks a navigation from a web origin
     * to an extension resource unless that resource is web-accessible, so
     * WalkCroach Web's redirect back into auth.html was failing with
     * ERR_BLOCKED_BY_CLIENT. Scoped to our own Web origin only.
     */
    web_accessible_resources: [
      {
        resources: ['auth.html'],
        matches: [webMatchPattern],
      },
    ],
    action: {
      default_title: 'WalkCroach',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
  vite: () => ({
    define: {
      __WALKCROACH_API_BASE__: JSON.stringify(apiBase),
      __WALKCROACH_IDE_API_BASE__: JSON.stringify(ideApiBase),
      __WALKCROACH_PRIVACY_URL__: JSON.stringify(privacyUrl),
      __WALKCROACH_WEB_URL__: JSON.stringify(webUrl),
      __WALKCROACH_PROFILES_PUBLIC_KEY__: JSON.stringify(profilesPublicKey),
    },
  }),
});
