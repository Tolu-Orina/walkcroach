import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Coverage gate — master plan §7B.
 *
 * ## What was wrong
 *
 * `include` listed three files: `auth/pkce.ts`, `api/ideClient.ts` and
 * `host/messageBridge.ts`. All three are well tested (91–95%), so the gate
 * reported a comfortable 40% — while `App.tsx` (1,244 lines) and
 * `webviewProvider.ts` (1,348 lines), the two largest and most
 * business-critical files in the package, were **excluded entirely**.
 *
 * Measured across the whole package the real figure was **9.19%**. The number
 * was not so much wrong as meaningless: it described a hand-picked subset.
 *
 * ## What this does instead
 *
 * `include` is now all source. The global threshold is a **ratchet floor set
 * at the measured figure** — it exists to stop regression, and is meant to be
 * raised as the gap closes, not to imply the package is well covered. Writing
 * a comfortable-looking number here would recreate the problem being fixed.
 *
 * Per-glob thresholds keep the already-tested modules honest: without them,
 * expanding `include` would let `ideClient.ts` rot from 95% to 40% while the
 * global number still passed.
 *
 * ## The gap, stated plainly
 *
 * Reaching a real 40% overall needs `App.tsx` and `webviewProvider.ts`
 * covered, which needs two things this package does not have yet: a DOM test
 * environment for the React webview (jsdom + Testing Library, as `web/` and
 * `chrome/` have), and a richer `vscode` mock covering webview panels,
 * disposables and the PTY surface. Both are tracked follow-ups to §7B rather
 * than something to fake with shallow tests.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    alias: {
      vscode: resolve(__dirname, 'src/__mocks__/vscode.ts'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        // Test scaffolding, not shipped code.
        'src/__mocks__/**',
        // Bundler entry points with no logic of their own.
        'src/webview/main.tsx',
        'src/webview/vscodeApi.ts',
      ],
      thresholds: {
        // Honest global floor. Raise it as the gap above closes; never lower it.
        statements: 12,
        lines: 12,
        // Modules that are genuinely covered must stay that way.
        'src/api/ideClient.ts': { statements: 90, lines: 90 },
        'src/auth/pkce.ts': { statements: 90, lines: 90 },
        'src/host/messageBridge.ts': { statements: 90, lines: 90 },
        'src/auth/session.ts': { statements: 50, lines: 50 },
      },
    },
  },
});
