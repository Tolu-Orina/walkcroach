import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts', 'lib/site-profiles/profiles.v1.json'],
      thresholds: { statements: 40, lines: 40 },
    },
  },
});
