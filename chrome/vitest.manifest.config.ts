import { defineConfig } from 'vitest/config';

/**
 * Post-build suite: asserts the produced `.output/chrome-mv3` artifact.
 *
 * Separate from `vitest.config.ts` because CI runs unit tests *before* `build`
 * (see buildspec.yml) — these need the build to exist, so they run after it and
 * fail rather than skip when it is missing.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
