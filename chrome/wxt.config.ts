import { defineConfig } from 'wxt';

// Fail closed only for release/zip builds (set WALKCROACH_REQUIRE_PROD_ENV=true).
const requireProdEnv = process.env.WALKCROACH_REQUIRE_PROD_ENV === 'true';

const apiBase =
  process.env.WALKCROACH_API_BASE ?? 'http://localhost:3002';
const privacyUrl =
  process.env.WALKCROACH_PRIVACY_URL ??
  'http://localhost:5173/chrome-privacy.html';

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
if (requireProdEnv) {
  if (!apiBase.startsWith('https://') || apiBase.includes('localhost')) {
    throw new Error(
      'WALKCROACH_API_BASE must be an https production URL (not localhost)',
    );
  }
  if (!privacyUrl.startsWith('https://') || privacyUrl.includes('localhost')) {
    throw new Error(
      'WALKCROACH_PRIVACY_URL must be an https production URL (not localhost)',
    );
  }
}

/** Narrow host permission for our BFF only — not page hosts / not <all_urls>. */
function apiHostPermission(base: string): string {
  const u = new URL(base);
  return `${u.protocol}//${u.host}/*`;
}

const apiHost = apiHostPermission(apiBase);

// https://wxt.dev/api/config.html
// Path B: no page hosts / no content_scripts. API host is required so the
// side panel can fetch the WalkCroach Chrome BFF (CORS otherwise blocks
// chrome-extension:// origins when ACAO is locked to the web SPA).
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
    },
  }),
});
