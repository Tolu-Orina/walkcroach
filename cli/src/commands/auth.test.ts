import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
const origHome = process.env.WALKCROACH_HOME;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'wc-auth-'));
  process.env.WALKCROACH_HOME = tempDir;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.WALKCROACH_HOME = origHome;
  else delete process.env.WALKCROACH_HOME;
  await rm(tempDir, { recursive: true, force: true });
});

vi.mock('../lib/api.js', () => ({
  ideHealth: vi.fn().mockResolvedValue({ ok: true }),
  ideMe: vi.fn().mockResolvedValue({ ownerId: 'u1', link: null, linkCount: 0 }),
}));

import { authLogin, authLogout, authStatus, configShow, configSet } from './auth.js';
import { getSecret } from '../lib/config.js';
import { SECRET_KEYS } from '@walkcroach/agent-engine';

describe('authLogin', () => {
  it('stores token when passed via --token', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await authLogin({ token: 'test-tok-123' });
    expect(code).toBe(0);
    const stored = await getSecret(SECRET_KEYS.cognitoAccessToken);
    expect(stored).toBe('test-tok-123');
    stdoutSpy.mockRestore();
  });

  it('returns 1 when no token in non-TTY', async () => {
    const origTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await authLogin({});
    expect(code).toBe(1);
    Object.defineProperty(process.stdin, 'isTTY', { value: origTTY, configurable: true });
    stderrSpy.mockRestore();
  });

  it('returns 1 for empty token', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await authLogin({ token: '  ' });
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });
});

describe('authLogout', () => {
  it('clears stored tokens', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authLogin({ token: 'tok' });
    const code = await authLogout({});
    expect(code).toBe(0);
    const stored = await getSecret(SECRET_KEYS.cognitoAccessToken);
    expect(stored).toBeUndefined();
    stdoutSpy.mockRestore();
  });
});

describe('authStatus', () => {
  it('returns 0 with status info', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await authStatus({});
    expect(code).toBe(0);
    stdoutSpy.mockRestore();
  });

  it('outputs JSON when json=true', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await authStatus({ json: true });
    const line = (stdoutSpy.mock.calls[0]![0] as string).trim();
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('command');
    stdoutSpy.mockRestore();
  });
});

describe('configShow', () => {
  it('outputs current config', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await configShow({});
    expect(code).toBe(0);
    stdoutSpy.mockRestore();
  });
});

describe('configSet', () => {
  it('sets allowed config key', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await configSet('apiBaseUrl', 'https://new.api.com', {});
    expect(code).toBe(0);
    stdoutSpy.mockRestore();
  });

  it('rejects unknown config key', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await configSet('unknownKey', 'val', {});
    expect(code).toBe(1);
    stderrSpy.mockRestore();
  });
});
