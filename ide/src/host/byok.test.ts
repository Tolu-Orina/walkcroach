/**
 * BYOK — one resolution rule, in the engine (CLI plan §C4 / master plan §4A).
 *
 * §C4's requirement is not "the IDE supports BYOK" — it already did — but that
 * the rule ships **once** in `packages/agent-engine`, with each host
 * contributing only its own credential UI. Two hosts deciding separately what
 * counts as "configured" is not a style problem: `webviewProvider` used to
 * check `AWS_ACCESS_KEY_ID` alone, so a developer on `AWS_PROFILE` was told
 * Bedrock was not configured while their runs worked, and the CLI on the same
 * machine said the opposite.
 *
 * The behaviour itself is covered in the engine
 * (`inference-credentials.test.ts`). What is asserted here is structural: that
 * this package still delegates, rather than growing a third copy of the rule.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENV_BEDROCK_BEARER,
  resolveInferenceCredentials,
  withInferenceCredentials,
} from '@walkcroach/agent-engine';

const providerSource = readFileSync(
  join(import.meta.dirname, 'webviewProvider.ts'),
  'utf8',
);

/**
 * The same file with comments removed.
 *
 * Asserting on identifier names alone would flag the comment that *explains*
 * why a variable is no longer read here — the difference between using
 * something and documenting that you do not.
 */
const providerCode = providerSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the host delegates credential resolution', () => {
  it('calls the shared resolver rather than reading the environment itself', () => {
    expect(providerSource).toContain('resolveInferenceCredentials');
    expect(providerSource).toContain('withInferenceCredentials');
  });

  it('re-implements no part of the credential rule', () => {
    // Each of these appearing here again would mean a second opinion about
    // the same machine. They belong in inference-credentials.ts only.
    for (const marker of [
      'AWS_ACCESS_KEY_ID',
      'AWS_PROFILE',
      'AWS_ROLE_ARN',
      'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    ]) {
      expect(providerCode, `${marker} is resolved in the engine, not here`).not.toContain(
        marker,
      );
    }
  });

  it('does not mutate the bearer environment variable by hand', () => {
    // Env mutation is process-global; the engine serialises it so two panels
    // cannot restore each other's value. A local assignment would reopen that.
    expect(providerSource).not.toMatch(
      new RegExp(`process\\.env\\.${ENV_BEDROCK_BEARER}\\s*=`),
    );
    expect(providerSource).not.toMatch(
      new RegExp(`delete\\s+process\\.env\\.${ENV_BEDROCK_BEARER}`),
    );
  });
});

describe('the shared rule, as this host will see it', () => {
  const noSecrets = { get: async () => undefined };

  it('counts an AWS profile as configured — the case the old rule missed', async () => {
    const got = await resolveInferenceCredentials(noSecrets, {
      env: { AWS_PROFILE: 'dev' },
    });
    expect(got.configured).toBe(true);
    expect(got.source).toBe('ambient-aws');
  });

  it('counts a stored key as configured, and prefers it', async () => {
    const got = await resolveInferenceCredentials(
      { get: async () => 'sk-byok' },
      { env: { AWS_PROFILE: 'dev' } },
    );
    expect(got.source).toBe('byok-key');
  });

  it('reports nothing configured on a bare machine', async () => {
    const got = await resolveInferenceCredentials(noSecrets, { env: {} });
    expect(got).toMatchObject({ source: 'none', configured: false });
  });

  it('exposes the stored key to a run and restores the environment after', async () => {
    const env: NodeJS.ProcessEnv = {};
    const during = await withInferenceCredentials(
      { get: async () => 'sk-byok' },
      async () => env[ENV_BEDROCK_BEARER],
      { env },
    );
    expect(during).toBe('sk-byok');
    expect(ENV_BEDROCK_BEARER in env).toBe(false);
  });
});
