import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  walkcroachHome,
  configPath,
  secretsPath,
  ensureHome,
  loadConfig,
  saveConfig,
  loadSecrets,
  saveSecrets,
  getSecret,
  setSecret,
  deleteSecret,
} from './config.js';

let tempDir: string;
const origHome = process.env.WALKCROACH_HOME;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wc-test-'));
  process.env.WALKCROACH_HOME = tempDir;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.WALKCROACH_HOME = origHome;
  else delete process.env.WALKCROACH_HOME;
  await rm(tempDir, { recursive: true, force: true });
});

describe('walkcroachHome', () => {
  it('uses WALKCROACH_HOME env var', () => {
    expect(walkcroachHome()).toBe(tempDir);
  });
});

describe('configPath / secretsPath', () => {
  it('returns paths under WALKCROACH_HOME', () => {
    expect(configPath()).toBe(join(tempDir, 'config.json'));
    expect(secretsPath()).toBe(join(tempDir, 'secrets.json'));
  });
});

describe('ensureHome', () => {
  it('creates the home directory if it does not exist', async () => {
    const sub = join(tempDir, 'sub');
    process.env.WALKCROACH_HOME = sub;
    await ensureHome();
    const { stat } = await import('node:fs/promises');
    const s = await stat(sub);
    expect(s.isDirectory()).toBe(true);
  });
});

describe('loadConfig / saveConfig', () => {
  it('returns defaults when no config file', async () => {
    const cfg = await loadConfig();
    expect(cfg.apiBaseUrl).toBe('http://localhost:3003');
    expect(cfg.defaultAutonomy).toBe('strict');
  });

  it('saves and loads config', async () => {
    await saveConfig({ apiBaseUrl: 'https://api.test.com' });
    const cfg = await loadConfig();
    expect(cfg.apiBaseUrl).toBe('https://api.test.com');
    expect(cfg.cognitoRegion).toBe('eu-west-2');
  });

  it('merges with defaults on partial file', async () => {
    await saveConfig({ cognitoClientId: 'cid-123' });
    const cfg = await loadConfig();
    expect(cfg.cognitoClientId).toBe('cid-123');
    expect(cfg.apiBaseUrl).toBe('http://localhost:3003');
  });
});

describe('loadSecrets / saveSecrets', () => {
  it('returns empty object when no file', async () => {
    const s = await loadSecrets();
    expect(s).toEqual({});
  });

  it('saves and loads secrets', async () => {
    await saveSecrets({ key1: 'val1', key2: 'val2' });
    const s = await loadSecrets();
    expect(s.key1).toBe('val1');
    expect(s.key2).toBe('val2');
  });
});

describe('getSecret / setSecret / deleteSecret', () => {
  it('stores, retrieves, and deletes a secret', async () => {
    await setSecret('my.test.key', 'secretValue');
    const v = await getSecret('my.test.key');
    expect(v).toBe('secretValue');

    await deleteSecret('my.test.key');
    const v2 = await getSecret('my.test.key');
    expect(v2).toBeUndefined();
  });

  it('reads from env var when available', async () => {
    process.env.WALKCROACH_MY_TEST_KEY = 'from-env';
    const v = await getSecret('my.test.key');
    expect(v).toBe('from-env');
    delete process.env.WALKCROACH_MY_TEST_KEY;
  });

  it('reads WALKCROACH_ACCESS_TOKEN for accessToken keys', async () => {
    process.env.WALKCROACH_ACCESS_TOKEN = 'tok-123';
    const v = await getSecret('walkcroach.auth.accessToken');
    expect(v).toBe('tok-123');
    delete process.env.WALKCROACH_ACCESS_TOKEN;
  });
});
