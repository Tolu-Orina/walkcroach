import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
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
      ],
      exclude: ['src/**/*.test.ts', 'src/vite-env.d.ts', 'src/auth/AuthContext.tsx'],
      thresholds: { statements: 40, lines: 40 },
    },
  },
});
