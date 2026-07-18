import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
  },
});
