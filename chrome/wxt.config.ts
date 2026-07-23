import { defineConfig } from 'wxt';

// Fail closed only for release/zip builds (set WALKCROACH_REQUIRE_PROD_ENV=true).
const requireProdEnv = process.env.WALKCROACH_REQUIRE_PROD_ENV === 'true';

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
  const api = process.env.WALKCROACH_API_BASE ?? '';
  const privacy = process.env.WALKCROACH_PRIVACY_URL ?? '';
  if (!api.startsWith('https://') || api.includes('localhost')) {
    throw new Error(
      'WALKCROACH_API_BASE must be an https production URL (not localhost)',
    );
  }
  if (!privacy.startsWith('https://') || privacy.includes('localhost')) {
    throw new Error(
      'WALKCROACH_PRIVACY_URL must be an https production URL (not localhost)',
    );
  }
}

// https://wxt.dev/api/config.html
// v0.1.3: activeTab + scripting only — no broad host permissions / content_scripts
// (faster CWS review; open via toolbar / side panel).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'WalkCroach',
    description:
      'Summarize, draft, and remember. A trust-first browser copilot for SMEs.',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
    action: {
      default_title: 'WalkCroach',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
  vite: () => ({
    define: {
      __WALKCROACH_API_BASE__: JSON.stringify(
        process.env.WALKCROACH_API_BASE ?? 'http://localhost:3002',
      ),
      __WALKCROACH_PRIVACY_URL__: JSON.stringify(
        process.env.WALKCROACH_PRIVACY_URL ??
          'http://localhost:5173/chrome-privacy.html',
      ),
    },
  }),
});
