import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Higher than the repo's usual 40: this is a published client and a
    // regression here breaks third parties, not just us.
    coverage: { thresholds: { statements: 60 } },
  },
});
