import { describe, expect, it, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import {
  recordStdioConsent,
  describeConfiguredMcpServers,
  buildStdioEnv,
  isDeniedEnvName,
  resolveStdioCommand,
  StdioCommandError,
  stdioServerFingerprint,
  readStdioConsents,
  revokeStdioConsent,
  STDIO_CONSENT_KEY,
  describeStdioServer,
  qualifyToolName,
  isValidMcpServerName,
  StdioMcpSupervisor,
  registerConfiguredMcpServers,
  type StdioRegistrationHost,
  type RegistrationTarget,
} from './mcp-stdio.js';
import { McpServerRegistry } from './mcp.js';

/**
 * The acceptance bar from `docs/walkcroach-stdio-mcp-security-review.md` §7,
 * written before the feature so the requirements could not drift to match the
 * implementation. Each §7 bullet is a `describe` below, labelled T1–T7.
 *
 * These matter more than most tests: the thing being gated is arbitrary code
 * execution triggered by cloning a repository.
 */

const WORKSPACE = process.platform === 'win32' ? 'C:\\repo' : '/repo';
const REAL_BIN = process.platform === 'win32' ? 'C:\\tools\\npx.CMD' : '/usr/bin/npx';

/** PATH-resolution fixture: only the paths listed here "exist". */
function existsIn(paths: string[]) {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (p: string) => set.has(p.toLowerCase());
}

const PLATFORM = process.platform;
const PATH_ENV =
  PLATFORM === 'win32'
    ? { PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' }
    : { PATH: '/usr/bin' };

function makeHost(over: Partial<StdioRegistrationHost> = {}) {
  const warnings: string[] = [];
  const stored = new Map<string, string>();
  const prompts: string[] = [];
  const host: StdioRegistrationHost = {
    getWorkspaceRoot: () => WORKSPACE,
    secrets: {
      get: async (k) => stored.get(k),
      store: async (k, v) => void stored.set(k, v),
    },
    emit: (e) => void warnings.push(e.message),
    confirmCommand: async (cmd) => {
      prompts.push(cmd);
      return 'approve';
    },
    isStdioMcpAllowed: () => true,
    ...over,
  };
  return { host, warnings, stored, prompts };
}

function makeRegistry() {
  const registered: string[] = [];
  const adopted: string[] = [];
  const target: RegistrationTarget = {
    register: (name) => void registered.push(name),
    adopt: (name) => void adopted.push(name),
  };
  return { target, registered, adopted };
}

function fakeSupervisor() {
  const started: Array<{ name: string; env: Record<string, string>; args?: string[] }> = [];
  const supervisor = {
    has: () => false,
    get: () => undefined,
    start: async (p: { name: string; env: Record<string, string>; args?: string[] }) => {
      started.push(p);
      return {} as never;
    },
  } as unknown as StdioMcpSupervisor;
  return { supervisor, started };
}

const stdioEntry = (over: Record<string, unknown> = {}) => ({
  srv: {
    transport: 'stdio' as const,
    command: 'npx',
    args: ['-y', 'some-server'],
    env: [] as string[],
    ...over,
  },
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
describe('T1 — a config with a command and no recorded consent spawns nothing', () => {
  it('prompts, and does not start when the user declines', async () => {
    const { host, warnings } = makeHost({
      confirmCommand: async () => 'reject',
    });
    const { target, adopted } = makeRegistry();
    const { supervisor, started } = fakeSupervisor();

    await registerConfiguredMcpServers({
      host,
      registry: target,
      fileServers: stdioEntry(),
      supervisor,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });

    expect(started).toHaveLength(0);
    expect(adopted).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/was not approved/);
  });

  it('starts only after consent is given', async () => {
    const { host, prompts, stored } = makeHost();
    const { target } = makeRegistry();
    const { supervisor, started } = fakeSupervisor();

    await registerConfiguredMcpServers({
      host,
      registry: target,
      fileServers: stdioEntry(),
      supervisor,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });

    expect(prompts).toHaveLength(1);
    // The prompt shows the RESOLVED path, not the bare name that was written.
    expect(prompts[0]).toContain(REAL_BIN);
    expect(started).toHaveLength(1);
    const consents = JSON.parse(stored.get(STDIO_CONSENT_KEY)!);
    expect(Object.values(consents)).toHaveLength(1);
    expect(Object.values(consents)[0]).toMatchObject({ name: 'srv' });
  });

  it('does not re-prompt once consent is recorded', async () => {
    const { host, prompts } = makeHost();
    const { target } = makeRegistry();
    const { supervisor } = fakeSupervisor();
    const args = {
      host,
      registry: target,
      fileServers: stdioEntry(),
      supervisor,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    };

    await registerConfiguredMcpServers(args);
    await registerConfiguredMcpServers(args);

    expect(prompts).toHaveLength(1);
  });
});

// ===========================================================================
describe('T2 — consent for one command does not authorise a changed command', () => {
  it('changes the fingerprint when args change', () => {
    const base = { name: 'srv', resolvedCommand: '/usr/bin/npx' };
    expect(stdioServerFingerprint({ ...base, args: ['a'] })).not.toBe(
      stdioServerFingerprint({ ...base, args: ['a', 'b'] }),
    );
  });

  it('changes the fingerprint when the resolved command changes', () => {
    expect(
      stdioServerFingerprint({ name: 'srv', resolvedCommand: '/usr/bin/npx' }),
    ).not.toBe(
      stdioServerFingerprint({ name: 'srv', resolvedCommand: '/tmp/npx' }),
    );
  });

  it('changes the fingerprint when the env allowlist changes', () => {
    const base = { name: 'srv', resolvedCommand: '/usr/bin/npx' };
    expect(stdioServerFingerprint({ ...base, envAllow: [] })).not.toBe(
      stdioServerFingerprint({ ...base, envAllow: ['FOO'] }),
    );
  });

  it('is stable across allowlist ordering, which is not a behaviour change', () => {
    const base = { name: 'srv', resolvedCommand: '/usr/bin/npx' };
    expect(stdioServerFingerprint({ ...base, envAllow: ['A', 'B'] })).toBe(
      stdioServerFingerprint({ ...base, envAllow: ['B', 'A'] }),
    );
  });

  it('re-prompts when the command changes after a prior approval', async () => {
    const { host, prompts } = makeHost();
    const { target } = makeRegistry();
    const { supervisor } = fakeSupervisor();
    const common = {
      host,
      registry: target,
      supervisor,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    };

    await registerConfiguredMcpServers({ ...common, fileServers: stdioEntry() });
    // Same server name, different arguments — a different program in practice.
    await registerConfiguredMcpServers({
      ...common,
      fileServers: stdioEntry({ args: ['-y', 'something-else'] }),
    });

    expect(prompts).toHaveLength(2);
  });
});

// ===========================================================================
describe('T3 — the spawned environment carries no credentials', () => {
  const dirty = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    AWS_BEARER_TOKEN_BEDROCK: 'secret',
    AWS_PROFILE: 'default',
    WALKCROACH_API_KEY: 'secret',
    GITHUB_TOKEN: 'secret',
    CRDB_CONNECTION_STRING: 'secret',
    E2B_API_KEY: 'secret',
    STRIPE_SECRET_KEY: 'secret',
    OPENAI_API_KEY: 'secret',
    SOME_PASSWORD: 'secret',
    MY_PRIVATE_KEY: 'secret',
    HARMLESS: 'ok',
  };

  it('passes only the minimal inherit set by default', () => {
    const env = buildStdioEnv({ baseEnv: dirty, platform: 'linux' });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
    expect(Object.keys(env)).not.toContain('HARMLESS');
  });

  it('contains no AWS_* or WALKCROACH_* variable', () => {
    const env = buildStdioEnv({ baseEnv: dirty, platform: 'linux' });
    for (const key of Object.keys(env)) {
      expect(key).not.toMatch(/^AWS_/);
      expect(key).not.toMatch(/^WALKCROACH_/);
    }
  });

  it('refuses to pass a credential even when explicitly allow-listed', () => {
    // The allowlist is a convenience, not an override. This is the assertion
    // that keeps T2 (credential theft) closed if someone misconfigures.
    const env = buildStdioEnv({
      baseEnv: dirty,
      platform: 'linux',
      allow: [
        'AWS_BEARER_TOKEN_BEDROCK',
        'GITHUB_TOKEN',
        'CRDB_CONNECTION_STRING',
        'E2B_API_KEY',
        'OPENAI_API_KEY',
        'SOME_PASSWORD',
        'MY_PRIVATE_KEY',
      ],
    });
    expect(Object.values(env)).not.toContain('secret');
  });

  it('does pass a genuinely harmless allow-listed variable', () => {
    const env = buildStdioEnv({
      baseEnv: dirty,
      platform: 'linux',
      allow: ['HARMLESS'],
    });
    expect(env.HARMLESS).toBe('ok');
  });

  it('recognises credential-shaped names generically, not by enumeration', () => {
    expect(isDeniedEnvName('SOME_NEW_VENDOR_API_KEY')).toBe(true);
    expect(isDeniedEnvName('THING_ACCESS_TOKEN')).toBe(true);
    expect(isDeniedEnvName('DB_PASSWORD')).toBe(true);
    expect(isDeniedEnvName('EDITOR')).toBe(false);
  });

  it('builds the spawn env through the same denylist during registration', async () => {
    const { host } = makeHost();
    const { target } = makeRegistry();
    const { supervisor, started } = fakeSupervisor();

    await registerConfiguredMcpServers({
      host,
      registry: target,
      fileServers: stdioEntry({ env: ['AWS_PROFILE'] }),
      supervisor,
      baseEnv: { ...PATH_ENV, AWS_PROFILE: 'default' },
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });

    expect(Object.keys(started[0]!.env)).not.toContain('AWS_PROFILE');
  });
});

// ===========================================================================
describe('T4 — relative and in-workspace commands are refused', () => {
  it('refuses a relative path', () => {
    expect(() =>
      resolveStdioCommand('./server', {
        workspaceRoot: WORKSPACE,
        env: PATH_ENV,
        platform: PLATFORM,
        exists: () => true,
      }),
    ).toThrow(StdioCommandError);
  });

  it('refuses a nested relative path', () => {
    expect(() =>
      resolveStdioCommand('bin/server', {
        workspaceRoot: WORKSPACE,
        env: PATH_ENV,
        platform: PLATFORM,
        exists: () => true,
      }),
    ).toThrow(/relative path/);
  });

  it('refuses an absolute command inside the workspace', () => {
    const inside = join(WORKSPACE, 'node_modules', '.bin', 'evil');
    expect(() =>
      resolveStdioCommand(inside, {
        workspaceRoot: WORKSPACE,
        env: PATH_ENV,
        platform: PLATFORM,
        exists: existsIn([inside]),
      }),
    ).toThrow(/inside the workspace/);
  });

  it('refuses a bare name that PATH resolves into the workspace', () => {
    // The T3 attack from the threat model: a workspace-local node_modules/.bin
    // ahead on PATH silently redirects `npx`.
    //
    // Platform must stay consistent with WORKSPACE here — a Windows path split
    // on a POSIX ':' separator breaks at the drive letter and the lookup fails
    // for the wrong reason, which would make this test pass vacuously.
    const shadowDir = join(WORKSPACE, 'node_modules', '.bin');
    const shadow = join(shadowDir, PLATFORM === 'win32' ? 'npx.CMD' : 'npx');
    expect(() =>
      resolveStdioCommand('npx', {
        workspaceRoot: WORKSPACE,
        env: { ...PATH_ENV, PATH: shadowDir },
        platform: PLATFORM,
        exists: existsIn([shadow]),
      }),
    ).toThrow(/inside the workspace/);
  });

  it('refuses a bare name that is not on PATH at all', () => {
    expect(() =>
      resolveStdioCommand('nope', {
        workspaceRoot: WORKSPACE,
        env: PATH_ENV,
        platform: PLATFORM,
        exists: () => false,
      }),
    ).toThrow(/not found on PATH/);
  });

  it('refuses an empty command', () => {
    expect(() => resolveStdioCommand('   ')).toThrow(StdioCommandError);
  });

  it('accepts a bare name resolving outside the workspace, returning an absolute path', () => {
    const resolved = resolveStdioCommand('npx', {
      workspaceRoot: WORKSPACE,
      env: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });
    expect(resolved.toLowerCase()).toBe(REAL_BIN.toLowerCase());
  });

  it('skips a refused server without stopping the others', async () => {
    const { host, warnings } = makeHost();
    const { target, registered } = makeRegistry();
    const { supervisor, started } = fakeSupervisor();

    await registerConfiguredMcpServers({
      host,
      registry: target,
      fileServers: {
        bad: { transport: 'stdio', command: './evil', args: [], env: [] },
        good: { transport: 'http', url: 'https://example.test/mcp' },
      },
      supervisor,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });

    expect(started).toHaveLength(0);
    expect(registered).toEqual(['good']);
    expect(warnings.join(' ')).toMatch(/relative path/);
  });
});

// ===========================================================================
describe('T5 — allowStdio false ignores stdio but keeps HTTP working', () => {
  it('spawns nothing and warns', async () => {
    const { host, warnings } = makeHost({ isStdioMcpAllowed: () => false });
    const { target, registered } = makeRegistry();
    const { supervisor, started } = fakeSupervisor();

    await registerConfiguredMcpServers({
      host,
      registry: target,
      fileServers: {
        ...stdioEntry(),
        api: { transport: 'http', url: 'https://example.test/mcp' },
      },
      supervisor,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });

    expect(started).toHaveLength(0);
    expect(registered).toEqual(['api']);
    expect(warnings.join(' ')).toMatch(/off by default/);
  });

  it('never even prompts for consent when disabled', async () => {
    const { host, prompts } = makeHost({ isStdioMcpAllowed: () => false });
    const { target } = makeRegistry();
    const { supervisor } = fakeSupervisor();

    await registerConfiguredMcpServers({
      host,
      registry: target,
      fileServers: stdioEntry(),
      supervisor,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });

    expect(prompts).toHaveLength(0);
  });

  it('defaults to disabled when the host does not implement the gate', async () => {
    // A host that never heard of stdio must not be able to spawn one.
    const { host, warnings } = makeHost({ isStdioMcpAllowed: undefined });
    const { target } = makeRegistry();
    const { supervisor, started } = fakeSupervisor();

    await registerConfiguredMcpServers({
      host,
      registry: target,
      fileServers: stdioEntry(),
      supervisor,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });

    expect(started).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/off by default/);
  });

  it('spawns nothing when the host has no supervisor', async () => {
    const { host, warnings } = makeHost();
    const { target } = makeRegistry();

    await registerConfiguredMcpServers({
      host,
      registry: target,
      fileServers: stdioEntry(),
      supervisor: undefined,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });

    expect(warnings.join(' ')).toMatch(/cannot supervise/);
  });
});

// ===========================================================================
describe('T6 — a configured server cannot collide with a first-party tool name', () => {
  it('qualifies every tool with its server', () => {
    expect(qualifyToolName('files', 'write_file')).toBe('files__write_file');
  });

  it('reports qualified names from the registry', () => {
    const registry = new McpServerRegistry();
    registry.adopt('files', {
      connected: true,
      connect: async () => {},
      listTools: () => [{ name: 'write_file' }],
      callTool: async () => '',
      close: async () => {},
    });
    const [tool] = registry.listAllTools();
    // A server offering `write_file` can never be addressed as the first-party
    // `write_file` — the qualified name is what any prompt surface must use.
    expect(tool?.qualifiedName).toBe('files__write_file');
    expect(tool?.qualifiedName).not.toBe('write_file');
  });

  it('refuses a server name that would make a qualified name ambiguous', () => {
    const registry = new McpServerRegistry();
    expect(() =>
      registry.register('a__b', { url: 'https://example.test/mcp' }),
    ).toThrow(/Invalid MCP server name/);
    expect(isValidMcpServerName('a__b')).toBe(false);
  });

  it('refuses to let a configured server take the reserved CockroachDB name', () => {
    const registry = new McpServerRegistry();
    expect(() =>
      registry.register('cockroachdb', { url: 'https://example.test/mcp' }),
    ).toThrow(/reserved/);
  });

  it('refuses names with characters that could confuse a prompt surface', () => {
    expect(isValidMcpServerName('has space')).toBe(false);
    expect(isValidMcpServerName('')).toBe(false);
    expect(isValidMcpServerName('ok-name.1_x')).toBe(true);
  });
});

// ===========================================================================
describe('T7 — disposal kills the process tree', () => {
  it('closes every client and empties the supervisor', async () => {
    const supervisor = new StdioMcpSupervisor();
    const closed: string[] = [];
    // Reach past start() so no real process is spawned; what is under test is
    // that disposeAll reaches every tracked client exactly once.
    const clients = (supervisor as unknown as { clients: Map<string, unknown> })
      .clients;
    clients.set('a', { close: async () => void closed.push('a') });
    clients.set('b', { close: async () => void closed.push('b') });

    await supervisor.disposeAll();

    expect(closed.sort()).toEqual(['a', 'b']);
    expect(supervisor.size).toBe(0);
  });

  it('is idempotent, so a double disposal path cannot throw', async () => {
    const supervisor = new StdioMcpSupervisor();
    await supervisor.disposeAll();
    await expect(supervisor.disposeAll()).resolves.toBeUndefined();
  });

  it('reports status for the Setup view and `mcp status`', () => {
    const supervisor = new StdioMcpSupervisor();
    const clients = (supervisor as unknown as { clients: Map<string, unknown> })
      .clients;
    clients.set('a', { pid: 1234, connected: true });
    expect(supervisor.status()).toEqual([
      { name: 'a', pid: 1234, connected: true },
    ]);
  });
});

// ===========================================================================
describe('consent prompt copy', () => {
  it('names the resolved command and states that credentials are withheld', () => {
    const text = describeStdioServer({
      name: 'files',
      resolvedCommand: '/usr/bin/npx',
      args: ['-y', 'server'],
      envAllow: [],
    });
    expect(text).toContain('/usr/bin/npx');
    expect(text).toMatch(/never passed/i);
    expect(text).toMatch(/trust this repository/i);
  });

  it('stores every consent under one revocable key', async () => {
    const store = new Map<string, string>();
    const secrets = {
      get: async (k: string) => store.get(k),
      store: async (k: string, v: string) => void store.set(k, v),
    };
    expect(await readStdioConsents(secrets)).toEqual({});
    await recordStdioConsent(secrets, 'fp1', {
      name: 'a',
      command: '/usr/bin/a',
      args: [],
      envAllow: [],
      approvedAt: new Date().toISOString(),
    });
    expect(Object.keys(await readStdioConsents(secrets))).toEqual(['fp1']);
    expect([...store.keys()]).toEqual([STDIO_CONSENT_KEY]);
  });

  it('revokes consent for one server, and for all', async () => {
    const store = new Map<string, string>();
    const secrets = {
      get: async (k: string) => store.get(k),
      store: async (k: string, v: string) => void store.set(k, v),
    };
    const rec = (name: string) => ({
      name,
      command: `/usr/bin/${name}`,
      args: [],
      envAllow: [],
      approvedAt: new Date().toISOString(),
    });
    await recordStdioConsent(secrets, 'fp1', rec('a'));
    await recordStdioConsent(secrets, 'fp2', rec('b'));

    expect(await revokeStdioConsent(secrets, 'a')).toBe(1);
    expect(Object.keys(await readStdioConsents(secrets))).toEqual(['fp2']);
    expect(await revokeStdioConsent(secrets)).toBe(1);
    expect(await readStdioConsents(secrets)).toEqual({});
  });

  it('fails closed on a corrupt consent store', async () => {
    // Garbage must not be readable as "approved".
    const secrets = {
      get: async () => 'not json',
      store: async () => {},
    };
    expect(await readStdioConsents(secrets)).toEqual({});
  });
});

// ===========================================================================
describe('describeConfiguredMcpServers — shared by Setup view and `mcp list`', () => {
  const secretsFrom = (consents: Record<string, unknown> = {}) => ({
    get: async () => JSON.stringify(consents),
    store: async () => {},
  });

  it('reports an http server as ready with its url', async () => {
    const [row] = await describeConfiguredMcpServers({
      fileServers: { api: { transport: 'http', url: 'https://x.test/mcp' } },
      secrets: secretsFrom(),
      allowStdio: true,
    });
    expect(row).toMatchObject({
      name: 'api',
      transport: 'http',
      detail: 'https://x.test/mcp',
      running: true,
    });
  });

  it('marks a stdio server blocked when the machine does not allow stdio', async () => {
    const [row] = await describeConfiguredMcpServers({
      fileServers: stdioEntry(),
      secrets: secretsFrom(),
      allowStdio: false,
      workspaceRoot: WORKSPACE,
    });
    expect(row?.approved).toBe(false);
    expect(row?.blockedReason).toMatch(/off/i);
  });

  it('shows the RESOLVED command, not what mcp.json wrote', async () => {
    const [row] = await describeConfiguredMcpServers({
      fileServers: stdioEntry(),
      secrets: secretsFrom(),
      allowStdio: true,
      workspaceRoot: WORKSPACE,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });
    // A user judging whether to approve needs the path that will actually run.
    expect(row?.detail).toContain(REAL_BIN);
  });

  it('surfaces a refused command as the blocked reason rather than hiding it', async () => {
    const [row] = await describeConfiguredMcpServers({
      fileServers: { bad: { transport: 'stdio', command: './evil', args: [], env: [] } },
      secrets: secretsFrom(),
      allowStdio: true,
      workspaceRoot: WORKSPACE,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: () => true,
    });
    expect(row?.blockedReason).toMatch(/relative path/);
    expect(row?.approved).toBe(false);
  });

  it('reports approved once consent exists for that exact command', async () => {
    const resolved = resolveStdioCommand('npx', {
      workspaceRoot: WORKSPACE,
      env: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });
    const fp = stdioServerFingerprint({
      name: 'srv',
      resolvedCommand: resolved,
      args: ['-y', 'some-server'],
      envAllow: [],
    });
    const [row] = await describeConfiguredMcpServers({
      fileServers: stdioEntry(),
      secrets: secretsFrom({ [fp]: { name: 'srv' } }),
      allowStdio: true,
      workspaceRoot: WORKSPACE,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });
    expect(row?.approved).toBe(true);
    expect(row?.blockedReason).toBeUndefined();
  });

  it('reports not-running when no supervisor is supplied', async () => {
    // `mcp list` passes no supervisor precisely so it cannot claim otherwise.
    const [row] = await describeConfiguredMcpServers({
      fileServers: stdioEntry(),
      secrets: secretsFrom(),
      allowStdio: true,
      workspaceRoot: WORKSPACE,
      baseEnv: PATH_ENV,
      platform: PLATFORM,
      exists: existsIn([REAL_BIN]),
    });
    expect(row?.running).toBe(false);
    expect(row?.pid).toBeNull();
  });
});
