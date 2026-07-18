import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import {
  ApprovalController,
  bindApprovals,
  canNonInteractiveApprove,
  type AgentEvent,
  type ApprovalDecision,
  type HostAdapter,
  type HostSecrets,
  type SearchHit,
  type TerminalChunk,
  type AutonomyLevel,
} from '@walkcroach/agent-engine';
import { deleteSecret, getSecret, setSecret } from '../lib/config.js';

export type CliHostOptions = {
  cwd: string;
  /** Emit every AgentEvent (TUI / JSON / text sinks). */
  onEvent?: (event: AgentEvent) => void;
  /**
   * FR-D25: auto-approve safe local tools only.
   * Infra / ccloud / MCP write always rejected in this mode.
   */
  nonInteractive?: boolean;
  autonomy?: AutonomyLevel;
  /** When interactive text mode (no TUI), prompt on stdin. */
  promptApprovals?: boolean;
  /**
   * TUI supplies approve/reject via resolveApproval — leave promptApprovals false.
   */
  externalApprovals?: boolean;
};

/**
 * Terminal HostAdapter — same engine surface as VsCodeHostAdapter (FR-D23).
 */
export class CliHostAdapter implements HostAdapter {
  private readonly gate: ApprovalController;
  private readonly approvals: ReturnType<typeof bindApprovals>;
  private runSignal: AbortSignal | undefined;
  private autonomy: AutonomyLevel;

  constructor(private readonly opts: CliHostOptions) {
    this.autonomy = opts.autonomy ?? 'strict';
    this.gate = new ApprovalController((req) => {
      this.emit({ type: 'approval_request', request: req });
      void this.handleApprovalPrompt(req);
    });
    this.gate.setAutonomy(this.autonomy);
    this.approvals = bindApprovals(
      { emit: (e) => this.emit(e) },
      this.gate,
      () => this.runSignal,
    );
  }

  emit: HostAdapter['emit'] = (event) => {
    this.opts.onEvent?.(event);
  };

  setRunSignal(signal?: AbortSignal): void {
    this.runSignal = signal;
    if (signal?.aborted) this.gate.cancelAll();
    signal?.addEventListener(
      'abort',
      () => {
        this.gate.cancelAll();
      },
      { once: true },
    );
  }

  showDiffPreview(
    filePath: string,
    before: string,
    after: string,
    meta?: {
      toolName?: string;
      stepId?: string;
      input?: Record<string, unknown>;
    },
  ) {
    return this.approvals.showDiffPreview(filePath, before, after, meta);
  }

  confirmCommand(
    cmd: string,
    meta?: { toolName?: string; stepId?: string },
  ) {
    return this.approvals.confirmCommand(cmd, meta);
  }

  resolveApproval(stepId: string, decision: ApprovalDecision): void {
    this.approvals.resolveApproval(stepId, decision);
  }

  getAutonomy(): AutonomyLevel {
    return this.approvals.getAutonomy();
  }

  setAutonomy(level: AutonomyLevel): void {
    this.autonomy = level;
    this.approvals.setAutonomy(level);
  }

  getWorkspaceRoot(): string | undefined {
    return this.opts.cwd;
  }

  /** CLI treats an opened cwd as trusted (operator chose it). */
  isTrustedWorkspace(): boolean {
    return true;
  }

  secrets: HostSecrets = {
    get: async (key) => getSecret(key),
    store: async (key, value) => setSecret(key, value),
  };

  async clearSecret(key: string): Promise<void> {
    await deleteSecret(key);
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.resolvePath(rel), 'utf8');
  }

  async writeFile(rel: string, content: string): Promise<void> {
    const abs = this.resolvePath(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  async listDir(rel: string): Promise<string[]> {
    const abs = this.resolvePath(rel || '.');
    const entries = await fs.readdir(abs, { withFileTypes: true });
    return entries
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  }

  async search(
    pattern: string,
    opts?: { glob?: string; signal?: AbortSignal },
  ): Promise<SearchHit[]> {
    const root = this.opts.cwd;
    const rg = await tryRg(root, pattern, opts);
    if (rg) return rg;
    return fallbackSearch(root, pattern, opts?.glob, opts?.signal);
  }

  async *runTerminal(
    cmd: string,
    termOpts: { cwd: string; signal?: AbortSignal },
  ): AsyncIterable<TerminalChunk> {
    const child = spawn(cmd, {
      cwd: termOpts.cwd,
      shell: true,
      signal: termOpts.signal,
      env: process.env,
    });

    const queue: TerminalChunk[] = [];
    let done = false;
    let wake: (() => void) | undefined;
    const push = (c: TerminalChunk) => {
      queue.push(c);
      wake?.();
    };

    child.stdout?.on('data', (b: Buffer) => {
      push({ stream: 'stdout', text: b.toString('utf8') });
    });
    child.stderr?.on('data', (b: Buffer) => {
      push({ stream: 'stderr', text: b.toString('utf8') });
    });
    const finished = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => {
        done = true;
        wake?.();
        resolve(code);
      });
    });

    while (!done || queue.length) {
      if (!queue.length) {
        await new Promise<void>((r) => {
          wake = r;
        });
        wake = undefined;
        continue;
      }
      yield queue.shift()!;
    }

    const code = await finished;
    if (code && code !== 0) {
      yield {
        stream: 'stderr',
        text: `\n[exit ${code}]\n`,
        exitCode: code,
      };
    } else {
      yield { stream: 'stdout', text: '', exitCode: code ?? 0 };
    }
  }

  async gatherMeta(
    signal?: AbortSignal,
  ): Promise<{ gitStatus?: string }> {
    try {
      let out = '';
      for await (const chunk of this.runTerminal('git status -sb', {
        cwd: this.opts.cwd,
        signal,
      })) {
        out += chunk.text;
      }
      return { gitStatus: out.trim() };
    } catch {
      return {};
    }
  }

  private async handleApprovalPrompt(
    req: import('@walkcroach/agent-engine').ApprovalRequest,
  ): Promise<void> {
    const { stepId, toolName } = req;
    if (this.opts.nonInteractive) {
      const ok = canNonInteractiveApprove({
        toolName,
        input: {
          path: req.path,
          cmd: req.cmd,
          ...(req.input ?? {}),
        },
        cmdPreview: req.cmd ?? undefined,
      });
      const decision: ApprovalDecision = ok ? 'approve' : 'reject';
      queueMicrotask(() => this.resolveApproval(stepId, decision));
      if (!ok) {
        this.emit({
          type: 'error',
          message: `Non-interactive mode refused ${toolName} (infra/sensitive tools require a human — FR-D25).`,
          fatal: false,
        });
      }
      return;
    }

    if (this.opts.externalApprovals) {
      // TUI will call resolveApproval
      return;
    }

    if (this.opts.promptApprovals === false) {
      this.emit({
        type: 'error',
        message:
          'Approval required but no interactive prompt is available. Re-run with --yes/--non-interactive, or without --json for the TUI/text prompt.',
        fatal: false,
      });
      queueMicrotask(() => this.resolveApproval(stepId, 'reject'));
      return;
    }

    const answer = await askYesNo('Approve? [y/N] ');
    this.resolveApproval(stepId, answer ? 'approve' : 'reject');
  }

  private resolvePath(rel: string): string {
    const root = path.resolve(this.opts.cwd);
    const abs = path.resolve(root, rel);
    if (!isPathInsideWorkspace(root, abs)) {
      throw new Error(`Path escapes workspace: ${rel}`);
    }
    return abs;
  }
}

/** Case-safe workspace containment (Windows drive-letter / casing). */
export function isPathInsideWorkspace(root: string, abs: string): boolean {
  const rootRes = path.resolve(root);
  const absRes = path.resolve(abs);
  if (process.platform === 'win32') {
    const rel = path.relative(rootRes.toLowerCase(), absRes.toLowerCase());
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }
  const rel = path.relative(rootRes, absRes);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function askYesNo(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^(y|yes)$/i.test(answer.trim()));
    });
  });
}

async function tryRg(
  root: string,
  pattern: string,
  opts?: { glob?: string; signal?: AbortSignal },
): Promise<SearchHit[] | null> {
  return new Promise((resolve) => {
    const args = ['-n', '--no-heading', '--color', 'never', pattern];
    if (opts?.glob) args.push('--glob', opts.glob);
    args.push('.');
    const child = spawn('rg', args, {
      cwd: root,
      shell: false,
      signal: opts?.signal,
    });
    let out = '';
    child.stdout?.on('data', (b: Buffer) => {
      out += b.toString('utf8');
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        resolve(null);
        return;
      }
      const hits: SearchHit[] = [];
      for (const line of out.split(/\r?\n/)) {
        if (!line) continue;
        const m = line.match(/^([^:]+):(\d+):(.*)$/);
        if (!m) continue;
        hits.push({
          path: m[1]!.replace(/\\/g, '/'),
          line: Number(m[2]),
          text: m[3] ?? '',
        });
      }
      resolve(hits.slice(0, 100));
    });
  });
}

async function fallbackSearch(
  root: string,
  pattern: string,
  glob?: string,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const re = new RegExp(pattern, 'i');
  const hits: SearchHit[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (signal?.aborted) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') {
        continue;
      }
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (glob && glob.startsWith('*.') && !e.name.endsWith(glob.slice(1))) {
        continue;
      }
      try {
        const text = await fs.readFile(abs, 'utf8');
        const lines = text.split(/\r?\n/);
        lines.forEach((line, i) => {
          if (re.test(line) && hits.length < 100) {
            hits.push({
              path: path.relative(root, abs).replace(/\\/g, '/'),
              line: i + 1,
              text: line,
            });
          }
        });
      } catch {
        // binary / unreadable
      }
    }
  };
  await walk(root);
  return hits;
}
