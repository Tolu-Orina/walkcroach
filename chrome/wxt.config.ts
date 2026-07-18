import { defineConfig } from 'wxt';

// Fail closed only for release/zip builds (set WALKCROACH_REQUIRE_PROD_ENV=true).
// Unit-test `wxt build` may still use localhost defaults.
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

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'WalkCroach',
    description:
      'Summarize, draft, and remember. A trust-first browser copilot for SMEs.',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    host_permissions: [],
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
