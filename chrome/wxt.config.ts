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

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'WalkCroach',
    description:
      'Summarize, draft, and remember. A trust-first browser copilot for SMEs.',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
    host_permissions: [apiHost],
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
      __WALKCROACH_PRIVACY_URL__: JSON.stringify(privacyUrl),
      __WALKCROACH_WEB_URL__: JSON.stringify(webUrl),
    },
  }),
});
