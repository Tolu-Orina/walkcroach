/**
 * Configuration precedence and the project-config trust boundary (C0.2, C0.3).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_API_BASE_URL,
  findProjectConfig,
  isTrustedProjectApiUrl,
  resolveApiBaseUrl,
} from './config.js';
import { resetRuntimeFlags, setRuntimeFlags } from './runtime.js';

let home: string;
let workspace: string;
const noEnv: NodeJS.ProcessEnv = {};

function writeProjectConfig(dir: string, body: unknown): void {
  mkdirSync(join(dir, '.walkcroach'), { recursive: true });
  writeFileSync(
    join(dir, '.walkcroach', 'config.json'),
    JSON.stringify(body),
    'utf8',
  );
}

function writeUserConfig(body: unknown): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify(body), 'utf8');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'wc-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'wc-ws-'));
  process.env.WALKCROACH_HOME = home;
  resetRuntimeFlags();
});

afterEach(() => {
  delete process.env.WALKCROACH_HOME;
  resetRuntimeFlags();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('resolveApiBaseUrl precedence', () => {
  it('falls back to the production API, not localhost', async () => {
    const got = await resolveApiBaseUrl({ cwd: workspace, env: noEnv });
    expect(got).toEqual({ value: DEFAULT_API_BASE_URL, source: 'default' });
  });

  it('prefers user config over the default', async () => {
    writeUserConfig({ apiBaseUrl: 'https://user.example.com/v1' });
    const got = await resolveApiBaseUrl({ cwd: workspace, env: noEnv });
    expect(got).toEqual({ value: 'https://user.example.com/v1', source: 'user' });
  });

  it('still reports `user` when the user pinned the production URL', async () => {
    // Otherwise `doctor` would say `default` and leave someone puzzled about
    // why their env change did not take effect.
    writeUserConfig({ apiBaseUrl: DEFAULT_API_BASE_URL });
    const got = await resolveApiBaseUrl({ cwd: workspace, env: noEnv });
    expect(got.source).toBe('user');
  });

  it('prefers project config over user config', async () => {
    writeUserConfig({ apiBaseUrl: 'https://user.example.com/v1' });
    writeProjectConfig(workspace, { apiBaseUrl: 'https://team.example.com/v1' });
    const got = await resolveApiBaseUrl({ cwd: workspace, env: noEnv });
    expect(got).toEqual({ value: 'https://team.example.com/v1', source: 'project' });
  });

  it('prefers env over project config', async () => {
    writeProjectConfig(workspace, { apiBaseUrl: 'https://team.example.com/v1' });
    const got = await resolveApiBaseUrl({
      cwd: workspace,
      env: { WALKCROACH_API_BASE_URL: 'https://env.example.com/v1' },
    });
    expect(got).toEqual({ value: 'https://env.example.com/v1', source: 'env' });
  });

  it('prefers the flag over everything', async () => {
    writeUserConfig({ apiBaseUrl: 'https://user.example.com/v1' });
    writeProjectConfig(workspace, { apiBaseUrl: 'https://team.example.com/v1' });
    setRuntimeFlags({ apiBaseUrl: 'https://flag.example.com/v1' });
    const got = await resolveApiBaseUrl({
      cwd: workspace,
      env: { WALKCROACH_API_BASE_URL: 'https://env.example.com/v1' },
    });
    expect(got).toEqual({ value: 'https://flag.example.com/v1', source: 'flag' });
  });

  it('normalises trailing slashes so paths never double up', async () => {
    setRuntimeFlags({ apiBaseUrl: 'https://flag.example.com/v1///' });
    const got = await resolveApiBaseUrl({ cwd: workspace, env: noEnv });
    expect(got.value).toBe('https://flag.example.com/v1');
  });

  it('ignores an empty env value rather than resolving to nothing', async () => {
    const got = await resolveApiBaseUrl({
      cwd: workspace,
      env: { WALKCROACH_API_BASE_URL: '   ' },
    });
    expect(got.source).toBe('default');
  });
});

describe('project config discovery', () => {
  it('finds config from a nested working directory, like git does', () => {
    writeProjectConfig(workspace, { apiBaseUrl: 'https://team.example.com/v1' });
    const nested = join(workspace, 'packages', 'api', 'src');
    mkdirSync(nested, { recursive: true });
    expect(findProjectConfig(nested)?.config.apiBaseUrl).toBe(
      'https://team.example.com/v1',
    );
  });

  it('survives a malformed project config instead of bricking the CLI', async () => {
    // The repo may not be one the user controls or can fix.
    mkdirSync(join(workspace, '.walkcroach'), { recursive: true });
    writeFileSync(join(workspace, '.walkcroach', 'config.json'), '{ not json', 'utf8');
    expect(findProjectConfig(workspace)).toBeNull();
    const got = await resolveApiBaseUrl({ cwd: workspace, env: noEnv });
    expect(got.source).toBe('default');
  });
});

describe('project config trust boundary', () => {
  it('accepts https and loopback', () => {
    expect(isTrustedProjectApiUrl('https://team.example.com/v1')).toBe(true);
    expect(isTrustedProjectApiUrl('http://127.0.0.1:3003')).toBe(true);
    expect(isTrustedProjectApiUrl('http://localhost:3003')).toBe(true);
    expect(isTrustedProjectApiUrl('http://[::1]:3003')).toBe(true);
  });

  it('refuses plaintext http to a remote host', () => {
    // Cloning a repository must not be enough to redirect an authenticated
    // CLI: every request carries a bearer token to whatever host wins here.
    expect(isTrustedProjectApiUrl('http://evil.example.com/v1')).toBe(false);
  });

  it('refuses a host that merely looks like loopback', () => {
    expect(isTrustedProjectApiUrl('http://127.0.0.1.evil.example.com/v1')).toBe(false);
    expect(isTrustedProjectApiUrl('http://localhost.evil.example.com/v1')).toBe(false);
  });

  it('refuses credentials embedded in the URL and non-http schemes', () => {
    expect(isTrustedProjectApiUrl('https://user:pass@team.example.com')).toBe(false);
    expect(isTrustedProjectApiUrl('file:///etc/passwd')).toBe(false);
    expect(isTrustedProjectApiUrl('not a url')).toBe(false);
  });

  it('ignores an untrusted project value, keeps working, and says why', async () => {
    writeUserConfig({ apiBaseUrl: 'https://user.example.com/v1' });
    writeProjectConfig(workspace, { apiBaseUrl: 'http://evil.example.com/v1' });
    const got = await resolveApiBaseUrl({ cwd: workspace, env: noEnv });
    expect(got.value).toBe('https://user.example.com/v1');
    expect(got.source).toBe('user');
    expect(got.note).toMatch(/Ignored apiBaseUrl/);
    expect(got.note).toMatch(/loopback/);
  });
});
