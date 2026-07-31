/**
 * BYOK gating on `walkcroach run` (Part 1 §4A / §6D).
 *
 * The defect this closes: `walkcroach secrets set bedrock.apiKey` stored a key
 * that nothing in the CLI ever read. A user could configure BYOK, watch the
 * command report success, and still have every run authenticate as whatever
 * ambient AWS credentials happened to be lying around — or fail with an opaque
 * SDK error 30 seconds in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_BEDROCK_BEARER, SECRET_KEYS } from '@walkcroach/agent-engine';
import { runAgentCommand } from './run.js';
import { setSecret } from '../lib/config.js';
import { EXIT } from '../lib/exit-codes.js';

/** Capture what the agent loop would have seen, without calling Bedrock. */
const runAgentLoop = vi.hoisted(() => vi.fn());
vi.mock('@walkcroach/agent-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@walkcroach/agent-engine')>()),
  runAgentLoop,
}));

let home: string;
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
let cwd: string;

function lastJson(): any {
  return JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? '{}'));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'wc-byok-'));
  cwd = await mkdtemp(join(tmpdir(), 'wc-byok-ws-'));
  process.env.WALKCROACH_HOME = home;
  // Start from a machine with no ambient AWS credentials at all.
  for (const key of [
    ENV_BEDROCK_BEARER,
    'AWS_ACCESS_KEY_ID',
    'AWS_PROFILE',
    'AWS_ROLE_ARN',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  ]) {
    delete process.env[key];
  }
  runAgentLoop.mockReset().mockResolvedValue(undefined);
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  stdout.mockRestore();
  stderr.mockRestore();
  delete process.env.WALKCROACH_HOME;
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe('run — BYOK gate', () => {
  it('refuses to start with no credentials, and says how to fix it', async () => {
    const code = await runAgentCommand({
      prompt: 'add a health route',
      cwd,
      mode: 'json',
      nonInteractive: true,
    });
    expect(code).toBe(EXIT.USAGE);
    const payload = lastJson();
    // Structured (C5.5): the cause is machine-readable and distinct from an
    // auth failure, because signing in does not fix an unconfigured BYOK.
    expect(payload.code).toBe('no_credentials');
    expect(payload.error).toMatch(/No inference credentials/);
    expect(payload.hint).toContain('walkcroach secrets set bedrock.apiKey');
    // Fails in one line rather than 30 seconds into an opaque SDK error.
    expect(runAgentLoop).not.toHaveBeenCalled();
  });

  it('runs with a stored BYOK key, and the SDK can see it', async () => {
    await setSecret(SECRET_KEYS.bedrockApiKey, 'sk-byok');
    let seenDuringRun: string | undefined;
    runAgentLoop.mockImplementation(async () => {
      seenDuringRun = process.env[ENV_BEDROCK_BEARER];
    });

    const code = await runAgentCommand({
      prompt: 'x',
      cwd,
      mode: 'json',
      nonInteractive: true,
    });

    expect(code).toBe(EXIT.OK);
    expect(runAgentLoop).toHaveBeenCalledOnce();
    // The whole point: the key the user stored is what authenticates the run.
    expect(seenDuringRun).toBe('sk-byok');
    // And the shell is left as it was found.
    expect(ENV_BEDROCK_BEARER in process.env).toBe(false);
  });

  it('runs on ambient AWS credentials without a stored key', async () => {
    // Keeps BYOK additive: an existing AWS profile keeps working untouched.
    process.env.AWS_PROFILE = 'dev';
    try {
      const code = await runAgentCommand({
        prompt: 'x',
        cwd,
        mode: 'json',
        nonInteractive: true,
      });
      expect(code).toBe(EXIT.OK);
      expect(runAgentLoop).toHaveBeenCalledOnce();
      expect(ENV_BEDROCK_BEARER in process.env).toBe(false);
    } finally {
      delete process.env.AWS_PROFILE;
    }
  });

  it('restores the environment when the run fails', async () => {
    await setSecret(SECRET_KEYS.bedrockApiKey, 'sk-byok');
    runAgentLoop.mockRejectedValue(new Error('bedrock rejected the key'));

    const code = await runAgentCommand({
      prompt: 'x',
      cwd,
      mode: 'json',
      nonInteractive: true,
    });

    // A failed agent run is its own exit code, distinct from a usage error.
    expect(code).toBe(EXIT.RUN_FAILED);
    expect(ENV_BEDROCK_BEARER in process.env).toBe(false);
  });
});
