/**
 * An in-memory filesystem that satisfies `SandboxLike`.
 *
 * Most agent work needs no execution at all. A content-publishing run reads repo
 * conventions over the GitHub API, generates files, and opens a pull request —
 * the customer's own CI does the verifying. Nothing is executed, so provisioning
 * a virtual machine to hold the files would be pure cost and latency.
 *
 * This is why `SandboxLike` is declared structurally rather than imported: the
 * same `SandboxHostAdapter`, the same write-scope enforcement, and the same
 * orchestrator run unchanged over a `Map`.
 *
 * `runTerminal` deliberately refuses rather than pretending. An agent told a
 * command "succeeded" with empty output will believe its tests passed, which is
 * a far worse failure than being told execution is unavailable. The refusal
 * names the reason so the model adapts — the same contract as a policy refusal.
 */
import type { SandboxExec, SandboxLike } from './sandbox-contract.js';

export type MemoryFsOptions = {
  /** Seed files, keyed by absolute path. Typically a repo read over the API. */
  files?: Record<string, string>;
  /**
   * Commands to answer instead of refusing, keyed by exact command string.
   * For tests, and for hosts that can satisfy a narrow set of commands out of
   * band (a typecheck run elsewhere, say) without a general shell.
   */
  commands?: Record<string, SandboxExec>;
  /**
   * Hard cap on total UTF-8 bytes across all files (P3.8). Writes that would
   * exceed this fail closed — content runs must not fill memory unbounded.
   */
  maxBytes?: number;
};

export class MemoryFileSystem implements SandboxLike {
  readonly kind = 'memory';
  private readonly files: Map<string, string>;
  private readonly commands: Record<string, SandboxExec>;
  private readonly maxBytes: number | undefined;
  private totalBytes = 0;
  /** Commands the agent attempted, so a caller can see what it wanted to run. */
  readonly attemptedCommands: string[] = [];

  constructor(opts: MemoryFsOptions = {}) {
    this.files = new Map(Object.entries(opts.files ?? {}));
    this.commands = opts.commands ?? {};
    this.maxBytes = opts.maxBytes;
    for (const content of this.files.values()) {
      this.totalBytes += utf8Bytes(content);
    }
    if (this.maxBytes !== undefined && this.totalBytes > this.maxBytes) {
      throw new Error(
        `MemoryFileSystem seed exceeds maxBytes (${this.totalBytes} > ${this.maxBytes})`,
      );
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const key = normalise(path);
    const next = utf8Bytes(content);
    const prev = this.files.has(key) ? utf8Bytes(this.files.get(key)!) : 0;
    const projected = this.totalBytes - prev + next;
    if (this.maxBytes !== undefined && projected > this.maxBytes) {
      throw new Error(
        `disk quota exceeded: write of ${next} bytes to '${path}' would use ` +
          `${projected} / ${this.maxBytes} bytes`,
      );
    }
    this.files.set(key, content);
    this.totalBytes = projected;
  }

  async readFile(path: string): Promise<string> {
    const value = this.files.get(normalise(path));
    if (value === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
    return value;
  }

  async listFiles(root = '/'): Promise<string[]> {
    const prefix = normalise(root).replace(/\/+$/, '');
    return [...this.files.keys()]
      .filter((p) => prefix === '' || p === prefix || p.startsWith(`${prefix}/`))
      .sort();
  }

  async runTerminal(cmd: string): Promise<SandboxExec> {
    this.attemptedCommands.push(cmd);
    const canned = this.commands[cmd.trim()];
    if (canned) return canned;
    return {
      ok: false,
      exitCode: 127,
      stdout: '',
      stderr:
        'command execution is not available in this run. This workspace is an ' +
        'in-memory filesystem: you can read and write files, but nothing can be ' +
        'executed. Do not assume a build or test passed. Produce the files and ' +
        'let the repository CI verify them.',
    };
  }

  /** Everything written, for the caller to turn into a commit. */
  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.files.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  has(path: string): boolean {
    return this.files.has(normalise(path));
  }

  async dispose(): Promise<void> {
    // Nothing to release. Present so callers can treat every runtime alike.
  }
}

/** Collapse `.`/`..` and duplicate slashes without touching a real filesystem. */
function normalise(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return (absolute ? '/' : '') + out.join('/');
}

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}
