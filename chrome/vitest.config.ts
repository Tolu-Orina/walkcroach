import { defineConfig } from 'vitest/config';

/*
  No @vitejs/plugin-react here on purpose. Vitest's esbuild transform already
  handles JSX from `jsx: "react-jsx"` in tsconfig, and the plugin only adds Fast
  Refresh, which tests never use. Including it also drags in a second `vite`
  (WXT builds on rolldown-vite) whose Plugin type is structurally incompatible —
  a typecheck failure bought for no runtime benefit.
*/
export default defineConfig({
  test: {
    // Default to node; component tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock, so the fast lib suite never pays
    // for a DOM it does not touch.
    environment: 'node',
    include: [
      'lib/**/*.test.ts',
      'entrypoints/**/*.test.ts',
      'entrypoints/**/*.test.tsx',
    ],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['lib/**/*.ts', 'entrypoints/sidepanel/components/**/*.tsx'],
      exclude: [
        'lib/**/*.test.ts',
        'lib/site-profiles/profiles.v1.json',
        'entrypoints/**/*.test.tsx',
      ],
      thresholds: { statements: 40, lines: 40 },
    },
  },
});
