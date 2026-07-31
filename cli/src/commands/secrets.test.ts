/**
 * `walkcroach secrets` (C1.5).
 *
 * The two properties worth defending: a secret never arrives as a flag, and
 * `list` never prints one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SETTABLE_SECRETS,
  isSettableSecret,
  secretsList,
  secretsRemove,
  secretsSet,
} from './secrets.js';
import { setSecret, secretsPath } from '../lib/config.js';
import { EXIT } from '../lib/exit-codes.js';
import { resetRuntimeFlags, setRuntimeFlags } from '../lib/runtime.js';

let home: string;
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

function lastJson(): any {
  const line = String(stdout.mock.calls.at(-1)?.[0] ?? '{}');
  return JSON.parse(line);
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'wc-secrets-'));
  process.env.WALKCROACH_HOME = home;
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  // Default to non-interactive so no test can block on a prompt.
  setRuntimeFlags({ noInput: true });
});

afterEach(async () => {
  stdout.mockRestore();
  stderr.mockRestore();
  resetRuntimeFlags();
  delete process.env.WALKCROACH_HOME;
  await rm(home, { recursive: true, force: true });
});

describe('key allowlist', () => {
  it('accepts only keys the other surfaces also read', () => {
    expect(isSettableSecret('mcp.apiKey')).toBe(true);
    expect(isSettableSecret('ccloud.apiKey')).toBe(true);
    expect(isSettableSecret('nonsense')).toBe(false);
  });

  it('does not offer the Cognito tokens as settable', () => {
    // Those are written by `auth login`; pasting one by hand is the workflow
    // C1.1 replaced, and offering it here would keep it alive.
    const keys = Object.keys(SETTABLE_SECRETS);
    expect(keys.some((k) => k.toLowerCase().includes('cognito'))).toBe(false);
    expect(keys.some((k) => k.toLowerCase().includes('auth'))).toBe(false);
  });

  it('rejects an unknown key with the allowed list, and writes nothing', async () => {
    const code = await secretsSet('mcp.apKey', { stdin: true, json: true });
    expect(code).toBe(EXIT.USAGE);
    expect(lastJson().error).toContain('mcp.apiKey');
  });
});

describe('secrets set', () => {
  it('refuses to run non-interactively without --stdin, naming the fix', async () => {
    const code = await secretsSet('mcp.apiKey', { json: true });
    expect(code).toBe(EXIT.USAGE);
    expect(lastJson().error).toContain('--stdin');
  });

  it('never echoes the value it stored', async () => {
    await setSecret(SETTABLE_SECRETS['mcp.apiKey'], 'super-secret-value');
    await secretsList({ json: true });
    const printed = stdout.mock.calls.map(String).join('');
    expect(printed).not.toContain('super-secret-value');
  });
});

describe('secrets list', () => {
  it('reports which keys are configured without their values', async () => {
    await setSecret(SETTABLE_SECRETS['mcp.url'], 'https://mcp.example.com');
    const code = await secretsList({ json: true });
    expect(code).toBe(EXIT.OK);

    const { data } = lastJson();
    const url = data.secrets.find((s: any) => s.key === 'mcp.url');
    expect(url).toEqual({ key: 'mcp.url', set: true, source: 'file' });
    // The value is absent from the payload entirely — not masked, not present.
    expect(JSON.stringify(data)).not.toContain('mcp.example.com');
  });

  it('reports an unset key as unset rather than omitting it', async () => {
    await secretsList({ json: true });
    const key = lastJson().data.secrets.find((s: any) => s.key === 'ccloud.apiKey');
    expect(key).toEqual({ key: 'ccloud.apiKey', set: false, source: null });
  });

  it('says when a value comes from the environment, not the file', async () => {
    // getSecret consults env first, so "configured" must reflect what a run
    // would actually see — otherwise doctor lies about a working setup.
    process.env.WALKCROACH_WALKCROACH_CCLOUD_APIKEY = 'from-env';
    try {
      await secretsList({ json: true });
      const key = lastJson().data.secrets.find((s: any) => s.key === 'ccloud.apiKey');
      expect(key).toEqual({ key: 'ccloud.apiKey', set: true, source: 'env' });
    } finally {
      delete process.env.WALKCROACH_WALKCROACH_CCLOUD_APIKEY;
    }
  });
});

describe('secrets rm', () => {
  it('removes a stored secret from the file', async () => {
    await setSecret(SETTABLE_SECRETS['mcp.apiKey'], 'value');
    expect(await readFile(secretsPath(), 'utf8')).toContain('value');

    const code = await secretsRemove('mcp.apiKey', { json: true });
    expect(code).toBe(EXIT.OK);
    expect(await readFile(secretsPath(), 'utf8')).not.toContain('value');
  });

  it('rejects an unknown key', async () => {
    expect(await secretsRemove('nope', { json: true })).toBe(EXIT.USAGE);
  });
});
