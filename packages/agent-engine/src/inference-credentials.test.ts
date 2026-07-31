/**
 * BYOK inference credentials (Part 1 §4A / IDE §7C / CLI §6D).
 *
 * Two properties carry the commercial decision: a key the user gave us is
 * preferred over anything ambient, and the environment is left exactly as it
 * was found.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENV_BEDROCK_BEARER,
  describeMissingCredentials,
  resolveInferenceCredentials,
  withInferenceCredentials,
} from './inference-credentials.js';
import { SECRET_KEYS } from './secrets.js';

function secretsWith(values: Record<string, string> = {}) {
  return { get: async (key: string) => values[key] };
}

const noSecrets = secretsWith();

afterEach(() => {
  delete process.env[ENV_BEDROCK_BEARER];
});

describe('resolveInferenceCredentials', () => {
  it('prefers a stored BYOK key over anything ambient', async () => {
    // Someone who pastes a key into Setup expects that key to be used, not a
    // stale AWS_PROFILE they forgot about — which would bill another account.
    const got = await resolveInferenceCredentials(
      secretsWith({ [SECRET_KEYS.bedrockApiKey]: 'bedrock-key' }),
      { env: { AWS_PROFILE: 'other', [ENV_BEDROCK_BEARER]: 'ambient' }, region: 'eu-west-2' },
    );
    expect(got).toEqual({ source: 'byok-key', region: 'eu-west-2', configured: true });
  });

  it('falls back to an ambient bearer token', async () => {
    const got = await resolveInferenceCredentials(noSecrets, {
      env: { [ENV_BEDROCK_BEARER]: 'ambient' },
      region: 'us-east-1',
    });
    expect(got.source).toBe('ambient-bearer');
    expect(got.configured).toBe(true);
  });

  it('recognises the standard AWS credential chain', async () => {
    for (const env of [
      { AWS_ACCESS_KEY_ID: 'AKIA…' },
      { AWS_PROFILE: 'dev' },
      { AWS_ROLE_ARN: 'arn:aws:iam::1:role/x' },
      { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/creds' },
    ]) {
      const got = await resolveInferenceCredentials(noSecrets, { env });
      expect(got.source, JSON.stringify(env)).toBe('ambient-aws');
    }
  });

  it('reports "none" rather than pretending a run would work', async () => {
    const got = await resolveInferenceCredentials(noSecrets, { env: {} });
    expect(got).toMatchObject({ source: 'none', configured: false });
  });

  it('ignores a whitespace-only stored key', async () => {
    const got = await resolveInferenceCredentials(
      secretsWith({ [SECRET_KEYS.bedrockApiKey]: '   ' }),
      { env: {} },
    );
    expect(got.source).toBe('none');
  });

  it('always reports a region, since a key is region-bound', async () => {
    const got = await resolveInferenceCredentials(noSecrets, { env: {} });
    expect(got.region).toBeTruthy();
  });
});

describe('withInferenceCredentials', () => {
  it('exposes the stored key to the SDK for the duration of the run', async () => {
    const env: NodeJS.ProcessEnv = {};
    const seen = await withInferenceCredentials(
      secretsWith({ [SECRET_KEYS.bedrockApiKey]: 'sk-bedrock' }),
      async () => env[ENV_BEDROCK_BEARER],
      { env },
    );
    expect(seen).toBe('sk-bedrock');
    // And nothing is left behind for the next command in the shell.
    expect(ENV_BEDROCK_BEARER in env).toBe(false);
  });

  it('strips a Bearer prefix, so a pasted header value still works', async () => {
    const env: NodeJS.ProcessEnv = {};
    const seen = await withInferenceCredentials(
      secretsWith({ [SECRET_KEYS.bedrockApiKey]: 'Bearer sk-bedrock' }),
      async () => env[ENV_BEDROCK_BEARER],
      { env },
    );
    expect(seen).toBe('sk-bedrock');
  });

  it('restores a pre-existing value exactly', async () => {
    const env: NodeJS.ProcessEnv = { [ENV_BEDROCK_BEARER]: 'original' };
    await withInferenceCredentials(
      secretsWith({ [SECRET_KEYS.bedrockApiKey]: 'sk-bedrock' }),
      async () => undefined,
      { env },
    );
    expect(env[ENV_BEDROCK_BEARER]).toBe('original');
  });

  it('restores an empty string as an empty string, not as absent', async () => {
    // Deleting a variable that existed empty is a different environment.
    const env: NodeJS.ProcessEnv = { [ENV_BEDROCK_BEARER]: '' };
    await withInferenceCredentials(
      secretsWith({ [SECRET_KEYS.bedrockApiKey]: 'sk' }),
      async () => undefined,
      { env },
    );
    expect(ENV_BEDROCK_BEARER in env).toBe(true);
    expect(env[ENV_BEDROCK_BEARER]).toBe('');
  });

  it('restores even when the run throws', async () => {
    const env: NodeJS.ProcessEnv = { [ENV_BEDROCK_BEARER]: 'original' };
    await expect(
      withInferenceCredentials(
        secretsWith({ [SECRET_KEYS.bedrockApiKey]: 'sk' }),
        async () => {
          throw new Error('run failed');
        },
        { env },
      ),
    ).rejects.toThrow('run failed');
    expect(env[ENV_BEDROCK_BEARER]).toBe('original');
  });

  it('leaves the ambient chain untouched when no key is stored', async () => {
    // This is what keeps BYOK additive for anyone already using an AWS profile.
    const env: NodeJS.ProcessEnv = { AWS_PROFILE: 'dev' };
    const ran = vi.fn().mockResolvedValue('ok');
    await withInferenceCredentials(noSecrets, ran, { env });
    expect(ran).toHaveBeenCalled();
    expect(ENV_BEDROCK_BEARER in env).toBe(false);
  });

  it('does not let concurrent runs clobber each other', async () => {
    // The IDE's original private version mutated process.env without
    // serialising: two panels running at once could have had one run restore
    // the environment out from under the other.
    const env: NodeJS.ProcessEnv = {};
    const observed: Array<string | undefined> = [];

    const makeRun = (key: string, delay: number) =>
      withInferenceCredentials(
        secretsWith({ [SECRET_KEYS.bedrockApiKey]: key }),
        async () => {
          observed.push(env[ENV_BEDROCK_BEARER]);
          await new Promise((r) => setTimeout(r, delay));
          // Still ours at the end of the run, not the other run's key.
          observed.push(env[ENV_BEDROCK_BEARER]);
        },
        { env },
      );

    await Promise.all([makeRun('key-a', 20), makeRun('key-b', 1)]);

    expect(observed).toEqual(['key-a', 'key-a', 'key-b', 'key-b']);
    expect(ENV_BEDROCK_BEARER in env).toBe(false);
  });

  it('keeps working after a failed run', async () => {
    const env: NodeJS.ProcessEnv = {};
    const secrets = secretsWith({ [SECRET_KEYS.bedrockApiKey]: 'sk' });
    await expect(
      withInferenceCredentials(secrets, async () => {
        throw new Error('boom');
      }, { env }),
    ).rejects.toThrow('boom');
    // A rejected promise must not wedge the queue for every later run.
    await expect(
      withInferenceCredentials(secrets, async () => 'second', { env }),
    ).resolves.toBe('second');
  });
});

describe('describeMissingCredentials', () => {
  it('names the command for the surface asking', () => {
    expect(describeMissingCredentials('cli')).toContain('walkcroach secrets set bedrock.apiKey');
    expect(describeMissingCredentials('ide')).toContain('Setup');
    // Both mention the ambient route, which many developers already have.
    expect(describeMissingCredentials('cli')).toContain('AWS_PROFILE');
  });
});
