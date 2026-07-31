import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
    // Node stays the default — most suites are pure logic and boot faster
    // without a DOM. Component suites opt in per file with
    // `@vitest-environment jsdom`, matching how chrome/ does it.
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [
        'src/api/**/*.ts',
        'src/auth/**/*.ts',
        'src/lib/**/*.ts',
        'src/templates/**/*.ts',
        'src/webcontainer/**/*.ts',
        'src/features/visual/**/*.ts',
        'src/hooks/**/*.ts',
        'src/features/deploy/useDeploy.ts',
        'src/features/chat/markdown.tsx',
        'src/features/chat/markdownPrepare.ts',
        'src/features/chat/ConnectorConfirmCard.tsx',
        'src/app/ConnectionsPage.tsx',
        'src/app/ConnectionsCallbackPage.tsx',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/vite-env.d.ts',
        'src/auth/AuthContext.tsx',
        // Type-only modules: no runtime statements exist to execute, so they
        // can only ever report 0% and drag the denominator down. Excluding
        // them makes the number mean "untested behaviour", not "declarations".
        'src/api/types.ts',
        'src/auth/types.ts',
      ],
      thresholds: { statements: 40, lines: 40 },
    },
  },
});
