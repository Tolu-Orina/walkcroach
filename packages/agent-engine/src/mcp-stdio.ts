/**
 * stdio-spawned MCP servers — the mitigations from
 * `docs/walkcroach-stdio-mcp-security-review.md` §6.
 *
 * ## Why this file is defensive to the point of paranoia
 *
 * Supporting stdio means reading a file out of the workspace and executing the
 * program it names. Unlike `run_terminal` (approved per command) or verify
 * recipes (run only when the agent calls `verify`), an MCP server starts when the
 * *workspace opens* — there is no agent turn to hang an approval on. `git clone
 * && code .` would otherwise be enough to run an attacker's command, and on a
 * machine configured for BYOK that command inherits the user's AWS credentials.
 *
 * The review's conclusion was that anything less than all of §6 is not enough, so
 * every guard here is load-bearing:
 *
 *   §6.2 → buildStdioEnv        no inherited environment (removes T2)
 *   §6.3 → resolveStdioCommand  absolute, resolved, never inside the workspace (T3)
 *   §6.4 → stdioServerFingerprint + consent, keyed so a changed command is a new
 *                               decision rather than a remembered one (T1)
 *   §6.5 → qualifyToolName      no shadowing of first-party tools (T4)
 *   §6.6 → StdioMcpSupervisor   one owner for spawn/health/kill (T6)
 *
 * The `allowStdio` gate itself (§6.4) deliberately lives on the HostAdapter, not
 * in this package's config loader — see `HostAdapter.isStdioMcpAllowed`.
 */

import { createHash } from 'node:crypto';
import { existsSync as fsExistsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpClientLike, McpToolInfo } from './mcp.js';
import type { McpServerView } from './protocol.js';
import { killProcessTree } from './process-kill.js';
import { truncateText } from './truncate.js';

export type McpStdioServerConfig = {
  command: string;
  args?: string[];
  /**
   * Names of environment variables this server may additionally receive.
   * Subject to DENIED_ENV_PATTERNS regardless — an allowlist cannot re-admit a
   * credential.
   */
  env?: string[];
};

// ---------------------------------------------------------------------------
// §6.2 — environment
// ---------------------------------------------------------------------------

/**
 * Never passed to a spawned server, even when explicitly allow-listed.
 *
 * The named prefixes come straight from the threat model (T2). The trailing
 * generic pattern is the important one: it catches `E2B_API_KEY`,
 * `STRIPE_SECRET_KEY`, `OPENAI_API_KEY` and every future credential nobody
 * remembered to enumerate here. Enumeration alone would rot.
 */
export const DENIED_ENV_PATTERNS: RegExp[] = [
  /^AWS_/i,
  /^WALKCROACH_/i,
  /^GITHUB_/i,
  /^COCKROACH/i,
  /^CRDB_/i,
  /^E2B_/i,
  /^STRIPE_/i,
  /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_KEY|SESSION)/i,
];

export function isDeniedEnvName(name: string): boolean {
  return DENIED_ENV_PATTERNS.some((re) => re.test(name));
}

/**
 * Build the complete environment for a spawned server.
 *
 * Starts from the MCP SDK's own curated inherit list (PATH, HOME, TERM and
 * friends) because without those most servers cannot run at all, then adds only
 * what the user allow-listed for this server, then removes anything matching the
 * denylist — in that order, so the denylist has the last word.
 */
/**
 * The minimum a spawned process needs to run at all, per platform.
 *
 * Mirrors the MCP SDK's own `DEFAULT_INHERITED_ENV_VARS`, restated here rather
 * than imported because the SDK computes its constant once at module load from
 * the *host* `process.platform` — which would silently ignore the `platform`
 * argument below and make cross-platform behaviour untestable.
 */
const INHERITED_ENV_VARS: Record<'win32' | 'posix', readonly string[]> = {
  win32: [
    'APPDATA',
    'HOMEDRIVE',
    'HOMEPATH',
    'LOCALAPPDATA',
    'PATH',
    'PROCESSOR_ARCHITECTURE',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'USERNAME',
    'USERPROFILE',
    'PROGRAMFILES',
  ],
  posix: ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'],
};

export function buildStdioEnv(params?: {
  allow?: string[];
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Record<string, string> {
  const baseEnv = params?.baseEnv ?? process.env;
  const out: Record<string, string> = {};

  const inherited =
    (params?.platform ?? process.platform) === 'win32'
      ? INHERITED_ENV_VARS.win32
      : INHERITED_ENV_VARS.posix;

  for (const name of inherited) {
    const value = baseEnv[name];
    if (typeof value === 'string') out[name] = value;
  }

  for (const name of params?.allow ?? []) {
    const value = baseEnv[name];
    if (typeof value === 'string') out[name] = value;
  }

  // Last word: a denied name cannot survive, whatever put it there.
  for (const name of Object.keys(out)) {
    if (isDeniedEnvName(name)) delete out[name];
  }

  return out;
}

// ---------------------------------------------------------------------------
// §6.3 — command resolution
// ---------------------------------------------------------------------------

export class StdioCommandError extends Error {}

/**
 * Resolve a configured command to an absolute path, or refuse it.
 *
 * Refuses, in order:
 *   - an empty command
 *   - a *relative* path (`./server`, `bin/server`) — these are workspace-relative
 *     by nature, which is exactly the redirect T3 describes
 *   - a bare name that does not resolve on PATH
 *   - anything resolving inside the workspace, wherever it came from: a
 *     workspace-local `node_modules/.bin/npx` shadowing the real one is the
 *     canonical form of this attack
 *
 * Note the policy is the *inverse* of `assertHookCommandSafe` in `hooks.ts`,
 * which requires hook commands to be inside the workspace. That is not an
 * inconsistency: a hook is a project's own build tooling, deliberately scoped to
 * the project, whereas an MCP server is a general-purpose binary and a
 * project-local one is a red flag rather than the norm.
 */
export function resolveStdioCommand(
  command: string,
  opts?: {
    workspaceRoot?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    /** Injected for tests; defaults to fs.existsSync. */
    exists?: (path: string) => boolean;
  },
): string {
  const raw = command?.trim() ?? '';
  if (!raw) {
    throw new StdioCommandError('MCP stdio server has no command.');
  }

  const platform = opts?.platform ?? process.platform;
  const env = opts?.env ?? process.env;
  const exists = opts?.exists ?? fsExistsSync;
  const looksLikePath = raw.includes('/') || raw.includes('\\');

  let resolved: string;
  if (isAbsolute(raw)) {
    resolved = resolve(raw);
    if (!exists(resolved)) {
      throw new StdioCommandError(`MCP stdio command not found: ${raw}`);
    }
  } else if (looksLikePath) {
    throw new StdioCommandError(
      `MCP stdio command must be an absolute path or a bare name found on PATH, not a relative path: ${raw}`,
    );
  } else {
    const found = resolveOnPath(raw, env, platform, exists);
    if (!found) {
      throw new StdioCommandError(
        `MCP stdio command not found on PATH: ${raw}`,
      );
    }
    resolved = found;
  }

  const root = opts?.workspaceRoot;
  if (root && isInside(resolved, root)) {
    throw new StdioCommandError(
      `MCP stdio command resolves inside the workspace, which a repository could control: ${resolved}`,
    );
  }

  return resolved;
}

function isInside(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === '') return true;
  return !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

function resolveOnPath(
  cmd: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean,
): string | null {
  const pathVar = env.PATH ?? env.Path ?? '';
  const dirs = pathVar.split(platform === 'win32' ? ';' : ':').filter(Boolean);
  // On Windows the binary is `npx.cmd`, not `npx`. cross-spawn (used by the SDK)
  // executes a resolved .cmd without a shell, so keeping the extension is safe.
  const exts =
    platform === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// §6.4 — consent fingerprint
// ---------------------------------------------------------------------------

/**
 * Identity of an exact spawn decision.
 *
 * Covers everything that changes what actually runs, so editing `args` in a
 * committed `mcp.json` invalidates a previously granted consent instead of
 * silently inheriting it. The resolved command is used rather than the written
 * one so that a PATH change pointing `npx` somewhere new is also a new decision.
 */
export function stdioServerFingerprint(params: {
  name: string;
  resolvedCommand: string;
  args?: string[];
  envAllow?: string[];
}): string {
  const canonical = JSON.stringify({
    name: params.name,
    command: params.resolvedCommand,
    args: params.args ?? [],
    env: [...(params.envAllow ?? [])].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * All recorded consents live under ONE SecretStorage key, as a fingerprint→record
 * map, rather than a key per fingerprint.
 *
 * §6.1 requires consent to be "recorded and revocable", and `HostSecrets` exposes
 * only `get`/`store` — with a key per fingerprint there would be no way to
 * enumerate what had been approved or to withdraw one, so revocability would have
 * been unimplementable without widening the host interface on every surface.
 */
export const STDIO_CONSENT_KEY = 'mcp.stdio.consents';

export type StdioConsentRecord = {
  name: string;
  command: string;
  args: string[];
  envAllow: string[];
  approvedAt: string;
};

type ConsentStore = Pick<StdioRegistrationHost['secrets'], 'get' | 'store'>;

export async function readStdioConsents(
  secrets: ConsentStore,
): Promise<Record<string, StdioConsentRecord>> {
  try {
    const raw = await secrets.get(STDIO_CONSENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, StdioConsentRecord>;
  } catch {
    // A corrupt store must fail closed — nothing is treated as approved.
    return {};
  }
}

export async function recordStdioConsent(
  secrets: ConsentStore,
  fingerprint: string,
  record: StdioConsentRecord,
): Promise<void> {
  const all = await readStdioConsents(secrets);
  all[fingerprint] = record;
  await secrets.store(STDIO_CONSENT_KEY, JSON.stringify(all));
}

/**
 * Withdraw consent. Returns how many records were removed.
 * `serverName` omitted revokes everything.
 */
export async function revokeStdioConsent(
  secrets: ConsentStore,
  serverName?: string,
): Promise<number> {
  const all = await readStdioConsents(secrets);
  const keep: Record<string, StdioConsentRecord> = {};
  let removed = 0;
  for (const [fp, rec] of Object.entries(all)) {
    if (!serverName || rec.name === serverName) removed += 1;
    else keep[fp] = rec;
  }
  if (removed > 0) await secrets.store(STDIO_CONSENT_KEY, JSON.stringify(keep));
  return removed;
}

/** Human-readable summary shown in the consent prompt. */
export function describeStdioServer(params: {
  name: string;
  resolvedCommand: string;
  args?: string[];
  envAllow?: string[];
}): string {
  const lines = [
    `MCP server "${params.name}" wants to run a program on this machine:`,
    ``,
    `  ${params.resolvedCommand}${(params.args ?? []).length ? ` ${(params.args ?? []).join(' ')}` : ''}`,
    ``,
    params.envAllow?.length
      ? `Environment shared with it: ${params.envAllow.join(', ')}`
      : `Environment shared with it: none beyond PATH/HOME basics.`,
    `Credentials (AWS, GitHub, CockroachDB, API keys) are never passed.`,
    ``,
    `This is configured by .walkcroach/mcp.json in this workspace. Approve only if you trust this repository.`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// §6.5 — tool namespacing
// ---------------------------------------------------------------------------

/** Separator between server and tool in a qualified name. */
export const TOOL_NAMESPACE_SEP = '__';

export function qualifyToolName(server: string, tool: string): string {
  return `${server}${TOOL_NAMESPACE_SEP}${tool}`;
}

/**
 * A server name containing the separator would make a qualified name ambiguous
 * (`a__b__c` could split two ways), which is precisely how a namespacing scheme
 * gets defeated. Rejected at registration.
 */
export function isValidMcpServerName(name: string): boolean {
  return (
    !!name &&
    !name.includes(TOOL_NAMESPACE_SEP) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
  );
}

// ---------------------------------------------------------------------------
// §6.1 / §6.6 — the client and its supervisor
// ---------------------------------------------------------------------------

export type StdioSpawnParams = {
  name: string;
  resolvedCommand: string;
  args?: string[];
  env: Record<string, string>;
  cwd?: string;
};

export class StdioMcpClient implements McpClientLike {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: McpToolInfo[] = [];

  constructor(private readonly params: StdioSpawnParams) {}

  get connected(): boolean {
    return this.client !== null;
  }

  /** PID of the spawned process, for process-tree kill on dispose. */
  get pid(): number | null {
    return this.transport?.pid ?? null;
  }

  get name(): string {
    return this.params.name;
  }

  listTools(): McpToolInfo[] {
    return this.tools;
  }

  async connect(): Promise<void> {
    if (this.client) return;
    let client: Client | undefined;
    try {
      // `env` is always explicit. Omitting it would make the SDK fall back to
      // getDefaultEnvironment(), which is reasonable but not ours to reason
      // about — §6.2 requires we decide exactly what is passed.
      const transport = new StdioClientTransport({
        command: this.params.resolvedCommand,
        args: this.params.args ?? [],
        env: this.params.env,
        stderr: 'pipe',
        cwd: this.params.cwd,
      });
      client = new Client({ name: 'walkcroach-ide', version: '0.1.0' });
      await client.connect(transport);
      const listed = await client.listTools();
      this.tools = (listed.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));
      this.transport = transport;
      this.client = client;
    } catch (err) {
      try {
        await client?.close();
      } catch {
        // ignore
      }
      throw new Error(plainStdioError(err, this.params.name));
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (!this.client) {
      throw new Error(`MCP server "${this.params.name}" is not running.`);
    }
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const content = result.content;
      if (!Array.isArray(content)) return safeJson(result);
      const text = content
        .map((block) => {
          if (
            block &&
            typeof block === 'object' &&
            'type' in block &&
            (block as { type: string }).type === 'text' &&
            'text' in block
          ) {
            return String((block as { text: string }).text);
          }
          return safeJson(block);
        })
        .join('\n');
      return text || '(empty MCP result)';
    } catch (err) {
      throw new Error(plainStdioError(err, this.params.name));
    }
  }

  /**
   * Close the transport, then kill the process tree.
   *
   * `transport.close()` alone leaves grandchildren behind — `npx` spawning node
   * is the common shape — which is exactly the persistence T6 describes.
   */
  async close(): Promise<void> {
    const pid = this.pid;
    try {
      await this.transport?.close();
    } catch {
      // ignore
    }
    try {
      await this.client?.close();
    } catch {
      // ignore
    }
    killProcessTree(pid);
    this.client = null;
    this.transport = null;
    this.tools = [];
  }
}

export function plainStdioError(err: unknown, serverName: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOENT/i.test(msg)) {
    return `MCP server "${serverName}" could not start — the command was not found when it ran.`;
  }
  if (/EACCES|EPERM/i.test(msg)) {
    return `MCP server "${serverName}" could not start — permission denied executing its command.`;
  }
  if (/timeout/i.test(msg)) {
    return `MCP server "${serverName}" timed out. Retry the same tool call.`;
  }
  return `MCP server "${serverName}" error: ${msg}`;
}

function safeJson(value: unknown): string {
  try {
    return truncateText(JSON.stringify(value, null, 2) ?? String(value), 40_000)
      .text;
  } catch {
    return String(value);
  }
}

/**
 * Single owner of every stdio server's lifetime (§6.6).
 *
 * Nothing else may spawn or kill one. Tied to window/process lifetime by the
 * host calling `disposeAll` — see `VsCodeHostAdapter` and the CLI's shutdown
 * path.
 */
export class StdioMcpSupervisor {
  private clients = new Map<string, StdioMcpClient>();

  get size(): number {
    return this.clients.size;
  }

  has(name: string): boolean {
    return this.clients.has(name);
  }

  get(name: string): StdioMcpClient | undefined {
    return this.clients.get(name);
  }

  /** Spawn and connect. Throws if a server of this name is already running. */
  async start(params: StdioSpawnParams): Promise<StdioMcpClient> {
    if (this.clients.has(params.name)) {
      throw new Error(`MCP server "${params.name}" is already running.`);
    }
    const client = new StdioMcpClient(params);
    // Registered before connect so a failed start still has its process tree
    // reachable for the kill in the catch below.
    this.clients.set(params.name, client);
    try {
      await client.connect();
    } catch (err) {
      this.clients.delete(params.name);
      await client.close();
      throw err;
    }
    return client;
  }

  async stop(name: string): Promise<boolean> {
    const client = this.clients.get(name);
    if (!client) return false;
    this.clients.delete(name);
    await client.close();
    return true;
  }

  /** Names and PIDs of everything running, for the Setup view and `mcp status`. */
  status(): Array<{ name: string; pid: number | null; connected: boolean }> {
    return [...this.clients.entries()].map(([name, client]) => ({
      name,
      pid: client.pid,
      connected: client.connected,
    }));
  }

  /** Idempotent; safe to call from a disposal path that may run twice. */
  async disposeAll(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(all.map((c) => c.close()));
  }
}

// ---------------------------------------------------------------------------
// Reporting — one description shared by the IDE Setup view and `mcp list`
// ---------------------------------------------------------------------------

export type ConfiguredServerConfig =
  | { transport: 'http'; url: string; headers?: Record<string, string> }
  | { transport: 'stdio'; command: string; args: string[]; env: string[] };

/**
 * What is configured, whether it may run, and whether it is running.
 *
 * Shared by both surfaces on purpose: the IDE renders it in the Setup view and
 * the CLI prints it from `walkcroach mcp list`. Two copies of "is this approved"
 * would eventually disagree, and the one that drifts would be telling a user
 * their machine is safer than it is.
 */
export async function describeConfiguredMcpServers(params: {
  fileServers: Record<string, ConfiguredServerConfig>;
  secrets: ConsentStore;
  allowStdio: boolean;
  workspaceRoot?: string;
  supervisor?: StdioMcpSupervisor;
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}): Promise<McpServerView[]> {
  const consents = await readStdioConsents(params.secrets);
  const out: McpServerView[] = [];

  for (const [name, config] of Object.entries(params.fileServers)) {
    if (config.transport === 'http') {
      out.push({
        name,
        transport: 'http',
        detail: config.url,
        running: true,
      });
      continue;
    }

    const base = {
      name,
      transport: 'stdio' as const,
      running: params.supervisor?.get(name)?.connected ?? false,
      pid: params.supervisor?.get(name)?.pid ?? null,
    };

    if (!params.allowStdio) {
      out.push({
        ...base,
        detail: [config.command, ...config.args].join(' '),
        approved: false,
        blockedReason:
          'Local process servers are off. Enable walkcroach.ide.mcp.allowStdio in your user settings.',
      });
      continue;
    }

    try {
      const resolved = resolveStdioCommand(config.command, {
        workspaceRoot: params.workspaceRoot,
        env: params.baseEnv,
        platform: params.platform,
        exists: params.exists,
      });
      const fingerprint = stdioServerFingerprint({
        name,
        resolvedCommand: resolved,
        args: config.args,
        envAllow: config.env,
      });
      out.push({
        ...base,
        detail: [resolved, ...config.args].join(' '),
        approved: Boolean(consents[fingerprint]),
        ...(consents[fingerprint]
          ? {}
          : { blockedReason: 'Not approved yet — you will be asked on the next run.' }),
      });
    } catch (err) {
      out.push({
        ...base,
        detail: [config.command, ...config.args].join(' '),
        approved: false,
        blockedReason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Registration — where every gate is actually applied
// ---------------------------------------------------------------------------

/** The slice of HostAdapter this needs; narrowed so tests need not fake a whole host. */
export type StdioRegistrationHost = {
  getWorkspaceRoot(): string | undefined;
  secrets: { get(key: string): Promise<string | undefined>; store(key: string, value: string): Promise<void> };
  emit(event: { type: 'warning'; message: string }): void;
  confirmCommand(
    cmd: string,
    meta?: { toolName?: string; stepId?: string },
  ): Promise<'approve' | 'reject'>;
  isStdioMcpAllowed?(): boolean | Promise<boolean>;
};

export type RegistrationTarget = {
  register(name: string, config: { url: string; headers?: Record<string, string> }): void;
  adopt(name: string, client: McpClientLike): void;
};

/**
 * Register every server from `.walkcroach/mcp.json`, applying the §6 gates to
 * the stdio ones.
 *
 * **Timing matters as much as the checks.** The review's central objection to
 * stdio was that servers start when the *workspace opens*, leaving no turn to
 * attach an approval to. This runs during agent-loop setup — i.e. after the user
 * has sent a prompt — so there is always a turn, and the consent prompt has a
 * natural place to appear. Nothing is spawned by opening a folder.
 */
export async function registerConfiguredMcpServers(params: {
  host: StdioRegistrationHost;
  registry: RegistrationTarget;
  fileServers: Record<
    string,
    | { transport: 'http'; url: string; headers?: Record<string, string> }
    | { transport: 'stdio'; command: string; args: string[]; env: string[] }
  >;
  supervisor?: StdioMcpSupervisor;
  /** Injected for tests. */
  baseEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
}): Promise<void> {
  const { host, registry, fileServers } = params;
  const workspaceRoot = host.getWorkspaceRoot();

  const stdioNames = Object.entries(fileServers)
    .filter(([, c]) => c.transport === 'stdio')
    .map(([n]) => n);

  // Resolved once: asking the host per server would let a slow or interactive
  // implementation answer inconsistently within one registration pass.
  let allowStdio = false;
  if (stdioNames.length > 0) {
    allowStdio = (await host.isStdioMcpAllowed?.()) === true;
  }

  for (const [name, config] of Object.entries(fileServers)) {
    if (config.transport === 'http') {
      try {
        registry.register(name, { url: config.url, headers: config.headers });
      } catch (err) {
        host.emit({
          type: 'warning',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    if (!allowStdio) {
      host.emit({
        type: 'warning',
        message:
          `MCP server "${name}" is ignored: it spawns a local process, which is off by default. ` +
          `Enable walkcroach.ide.mcp.allowStdio in your USER settings (not this workspace) if you trust this repository.`,
      });
      continue;
    }

    if (!params.supervisor) {
      host.emit({
        type: 'warning',
        message: `MCP server "${name}" is ignored: this host cannot supervise local processes.`,
      });
      continue;
    }

    let resolvedCommand: string;
    try {
      resolvedCommand = resolveStdioCommand(config.command, {
        workspaceRoot,
        env: params.baseEnv,
        platform: params.platform,
        exists: params.exists,
      });
    } catch (err) {
      host.emit({
        type: 'warning',
        message: `MCP server "${name}" is ignored: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }

    const fingerprint = stdioServerFingerprint({
      name,
      resolvedCommand,
      args: config.args,
      envAllow: config.env,
    });
    const consents = await readStdioConsents(host.secrets);
    if (!consents[fingerprint]) {
      const decision = await host.confirmCommand(
        describeStdioServer({
          name,
          resolvedCommand,
          args: config.args,
          envAllow: config.env,
        }),
        { toolName: 'mcp_stdio' },
      );
      if (decision !== 'approve') {
        host.emit({
          type: 'warning',
          message: `MCP server "${name}" was not approved and will not run.`,
        });
        continue;
      }
      // Recorded against the fingerprint, so editing the command in mcp.json
      // produces a different fingerprint and therefore a fresh prompt rather
      // than inheriting this decision.
      await recordStdioConsent(host.secrets, fingerprint, {
        name,
        command: resolvedCommand,
        args: config.args,
        envAllow: config.env,
        approvedAt: new Date().toISOString(),
      });
    }

    if (params.supervisor.has(name)) {
      registry.adopt(name, params.supervisor.get(name)!);
      continue;
    }

    try {
      const client = await params.supervisor.start({
        name,
        resolvedCommand,
        args: config.args,
        env: buildStdioEnv({
          allow: config.env,
          baseEnv: params.baseEnv,
          platform: params.platform,
        }),
        cwd: workspaceRoot,
      });
      registry.adopt(name, client);
    } catch (err) {
      host.emit({
        type: 'warning',
        message: `MCP server "${name}" failed to start (continuing without it): ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }
}
