import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Never touch the developer's real credential store. A temp
    // WALKCROACH_HOME isolates the file backend; nothing isolates the OS
    // keychain, so the suite runs on the file backend by default and
    // credential-store.test.ts opts back in deliberately.
    env: { WALKCROACH_NO_KEYCHAIN: '1' },
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/lib/**/*.ts',
        'src/commands/**/*.ts',
        'src/host/CliHostAdapter.ts',
        // The command surface itself — pinned by surface.test.ts (C0.1).
        'src/program.ts',
        'src/auth/**/*.ts',
      ],
      exclude: ['src/**/*.test.ts'],
      thresholds: { statements: 40 },
    },
  },
});
