/**
 * Tier C — interactive terminal sessions (REPL / TUI / mid-run stdin).
 *
 * Backend selection:
 * 1. `node-pty` or `node-pty-prebuilt-multiarch` when loadable (true PTY)
 * 2. Otherwise pipe-backed interactive child_process (always available)
 *
 * Agent flow: start → write → read (settle) → … → close
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { killProcessTree } from './process-kill.js';

export type SessionBackend = 'pty' | 'pipe';
export type SessionStatus = 'running' | 'exited' | 'killed';

export const MAX_SESSIONS = 4;
export const MAX_SESSION_BUFFER_CHARS = 200_000;
export const DEFAULT_SETTLE_MS = 300;
export const DEFAULT_READ_TIMEOUT_MS = 8_000;

export type SessionInfo = {
  sessionId: string;
  cmd: string;
  cwd: string;
  backend: SessionBackend;
  status: SessionStatus;
  exitCode: number | null;
  createdAt: string;
};

export type SessionReadResult = {
  sessionId: string;
  output: string;
  status: SessionStatus;
  exitCode: number | null;
  backend: SessionBackend;
  /** Byte/char offset cursor after this read (for incremental reads). */
  offset: number;
  settled: boolean;
};

type PtyHandle = {
  write: (data: string) => void;
  kill: () => void;
  pid: number;
  resize?: (cols: number, rows: number) => void;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (code: number) => void) => void;
};

type SessionEntry = {
  info: SessionInfo;
  buffer: string;
  /** Length of buffer already returned by the last read (exclusive). */
  readOffset: number;
  handle: PtyHandle;
};

type NodePtyModule = {
  spawn: (
    file: string,
    args: string[] | string,
    options: Record<string, unknown>,
  ) => {
    pid: number;
    write: (data: string) => void;
    kill: () => void;
    resize: (cols: number, rows: number) => void;
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (e: { exitCode: number }) => void) => void;
  };
};

let ptyModulePromise: Promise<NodePtyModule | null> | null = null;

/** Dynamic import that does not require the package at compile time. */
const importOptional = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<unknown>;

/** Try optional native PTY packages (may be absent if native build failed). */
export async function loadPtyModule(): Promise<NodePtyModule | null> {
  if (!ptyModulePromise) {
    ptyModulePromise = (async () => {
      for (const name of [
        'node-pty-prebuilt-multiarch',
        'node-pty',
      ] as const) {
        try {
          const mod = (await importOptional(name)) as NodePtyModule;
          if (typeof mod.spawn === 'function') return mod;
        } catch {
          /* try next */
        }
      }
      return null;
    })();
  }
  return ptyModulePromise;
}

/** Test helper — force pipe backend / reset cache. */
export function resetPtyModuleCache(forceNull = false): void {
  ptyModulePromise = forceNull ? Promise.resolve(null) : null;
}

/**
 * Split a command line into file + args (quote-aware, minimal).
 * Falls back to platform shell -c / /c when parsing is ambiguous.
 */
export function splitCommandLine(cmd: string): {
  file: string;
  args: string[];
  viaShell: boolean;
} {
  const trimmed = cmd.trim();
  if (!trimmed) {
    throw new Error('Command must be non-empty');
  }
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);

  if (tokens.length === 0) {
    throw new Error('Command must be non-empty');
  }

  // Operators / redirects → shell
  if (/[|&;<>]/.test(trimmed) || tokens.some((t) => t.includes('*'))) {
    return viaShell(trimmed);
  }

  return { file: tokens[0]!, args: tokens.slice(1), viaShell: false };
}

function viaShell(cmd: string): {
  file: string;
  args: string[];
  viaShell: boolean;
} {
  if (process.platform === 'win32') {
    return {
      file: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', cmd],
      viaShell: true,
    };
  }
  const sh = process.env.SHELL || '/bin/bash';
  return { file: sh, args: ['-lc', cmd], viaShell: true };
}

function createPipeHandle(
  file: string,
  args: string[],
  cwd: string,
  cols: number,
  rows: number,
  env?: NodeJS.ProcessEnv,
): PtyHandle {
  const child: ChildProcess = spawn(file, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
      TERM: env?.TERM ?? 'xterm-256color',
      COLUMNS: String(cols),
      LINES: String(rows),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });

  const pid = child.pid ?? 0;
  const dataCbs: Array<(d: string) => void> = [];
  const exitCbs: Array<(code: number) => void> = [];

  const onChunk = (b: Buffer) => {
    const text = b.toString('utf8');
    for (const cb of dataCbs) cb(text);
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);
  child.on('close', (code) => {
    for (const cb of exitCbs) cb(code ?? 0);
  });

  return {
    pid,
    write: (data: string) => {
      try {
        child.stdin?.write(data);
      } catch {
        /* EPIPE */
      }
    },
    kill: () => {
      killProcessTree(pid);
      try {
        child.stdin?.end();
      } catch {
        /* ignore */
      }
    },
    onData: (cb) => {
      dataCbs.push(cb);
    },
    onExit: (cb) => {
      exitCbs.push(cb);
    },
  };
}

function createPtyHandle(
  pty: NodePtyModule,
  file: string,
  args: string[],
  cwd: string,
  cols: number,
  rows: number,
  env?: NodeJS.ProcessEnv,
): PtyHandle {
  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...process.env, ...env },
  });
  return {
    pid: proc.pid,
    write: (data) => proc.write(data),
    kill: () => {
      try {
        proc.kill();
      } catch {
        killProcessTree(proc.pid);
      }
    },
    resize: (c, r) => proc.resize(c, r),
    onData: (cb) => proc.onData(cb),
    onExit: (cb) =>
      proc.onExit((e) => cb(typeof e.exitCode === 'number' ? e.exitCode : 0)),
  };
}

export class InteractiveSessionRegistry {
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly opts?: {
      /** Prefer pipe even when PTY is available (tests). */
      forcePipe?: boolean;
      onOutput?: (sessionId: string, chunk: string) => void;
    },
  ) {}

  async start(params: {
    cmd: string;
    cwd: string;
    cols?: number;
    rows?: number;
    env?: NodeJS.ProcessEnv;
  }): Promise<SessionInfo> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(
        `Too many interactive sessions (max ${MAX_SESSIONS}). Close one first.`,
      );
    }
    const cols = params.cols ?? 120;
    const rows = params.rows ?? 40;
    const { file, args } = splitCommandLine(params.cmd);

    let backend: SessionBackend = 'pipe';
    let handle: PtyHandle;
    const pty = this.opts?.forcePipe ? null : await loadPtyModule();
    if (pty) {
      try {
        handle = createPtyHandle(
          pty,
          file,
          args,
          params.cwd,
          cols,
          rows,
          params.env,
        );
        backend = 'pty';
      } catch {
        handle = createPipeHandle(
          file,
          args,
          params.cwd,
          cols,
          rows,
          params.env,
        );
        backend = 'pipe';
      }
    } else {
      handle = createPipeHandle(
        file,
        args,
        params.cwd,
        cols,
        rows,
        params.env,
      );
    }

    const sessionId = randomUUID().slice(0, 8);
    const info: SessionInfo = {
      sessionId,
      cmd: params.cmd,
      cwd: params.cwd,
      backend,
      status: 'running',
      exitCode: null,
      createdAt: new Date().toISOString(),
    };
    const entry: SessionEntry = {
      info,
      buffer: '',
      readOffset: 0,
      handle,
    };
    this.sessions.set(sessionId, entry);

    handle.onData((data) => {
      entry.buffer += data;
      if (entry.buffer.length > MAX_SESSION_BUFFER_CHARS) {
        const drop = entry.buffer.length - MAX_SESSION_BUFFER_CHARS;
        entry.buffer = entry.buffer.slice(drop);
        entry.readOffset = Math.max(0, entry.readOffset - drop);
      }
      this.opts?.onOutput?.(sessionId, data);
    });
    handle.onExit((code) => {
      if (entry.info.status === 'running') {
        entry.info.status = 'exited';
        entry.info.exitCode = code;
      }
    });

    return { ...info };
  }

  write(
    sessionId: string,
    input: string,
    opts?: { appendNewline?: boolean },
  ): void {
    const entry = this.require(sessionId);
    if (entry.info.status !== 'running') {
      throw new Error(`Session ${sessionId} is not running`);
    }
    const append = opts?.appendNewline !== false;
    const data =
      append && input.length > 0 && !input.endsWith('\n')
        ? `${input}\n`
        : input;
    entry.handle.write(data);
  }

  async read(
    sessionId: string,
    opts?: {
      timeoutMs?: number;
      settleMs?: number;
      maxChars?: number;
    },
  ): Promise<SessionReadResult> {
    const entry = this.require(sessionId);
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    const settleMs = opts?.settleMs ?? DEFAULT_SETTLE_MS;
    const maxChars = opts?.maxChars ?? 40_000;

    const started = Date.now();
    const startOffset = entry.readOffset;
    let lastLen = entry.buffer.length;
    let lastChange = Date.now();
    let settled = false;

    while (Date.now() - started < timeoutMs) {
      if (entry.info.status !== 'running') {
        settled = true;
        break;
      }
      await sleep(40);
      if (entry.buffer.length !== lastLen) {
        lastLen = entry.buffer.length;
        lastChange = Date.now();
        continue;
      }
      // Only settle after we have received new bytes since this read started,
      // then stayed quiet for settleMs. Never settle on empty while still running.
      const hasNew = entry.buffer.length > startOffset;
      if (hasNew && Date.now() - lastChange >= settleMs) {
        settled = true;
        break;
      }
    }

    if (!settled && entry.info.status !== 'running') {
      settled = true;
    }

    const slice = entry.buffer.slice(entry.readOffset);
    entry.readOffset = entry.buffer.length;
    const output =
      slice.length > maxChars
        ? `…(${slice.length - maxChars} chars truncated)\n${slice.slice(-maxChars)}`
        : slice;

    return {
      sessionId,
      output,
      status: entry.info.status,
      exitCode: entry.info.exitCode,
      backend: entry.info.backend,
      offset: entry.readOffset,
      settled,
    };
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const entry = this.require(sessionId);
    entry.handle.resize?.(cols, rows);
  }

  close(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    if (entry.info.status === 'running') {
      entry.info.status = 'killed';
      entry.handle.kill();
    }
    this.sessions.delete(sessionId);
    return true;
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.close(id);
    }
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((e) => ({ ...e.info }));
  }

  get(sessionId: string): SessionInfo | null {
    const e = this.sessions.get(sessionId);
    return e ? { ...e.info } : null;
  }

  private require(sessionId: string): SessionEntry {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw new Error(`Unknown session_id: ${sessionId}`);
    }
    return entry;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
