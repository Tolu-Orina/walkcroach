import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    alias: {
      vscode: resolve(__dirname, 'src/__mocks__/vscode.ts'),
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/auth/pkce.ts',
        'src/api/ideClient.ts',
        'src/host/messageBridge.ts',
      ],
      exclude: ['src/**/*.test.ts'],
      thresholds: { statements: 40 },
    },
  },
});
