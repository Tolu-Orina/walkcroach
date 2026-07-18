import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  HostAdapter,
  HostSecrets,
  SearchHit,
  TerminalChunk,
} from '@walkcroach/agent-engine';
import {
  ApprovalController,
  bindApprovals,
} from '@walkcroach/agent-engine';

/**
 * Phase A host: workspace fs, terminal, search, approvals, trust.
 */
export class VsCodeHostAdapter implements HostAdapter {
  private readonly gate: ApprovalController;
  private readonly approvals: ReturnType<typeof bindApprovals>;
  private runSignal: AbortSignal | undefined;
  private secretStore: vscode.SecretStorage | undefined;

  constructor(
    private readonly emitFn: HostAdapter['emit'],
    private readonly output?: vscode.OutputChannel,
  ) {
    this.gate = new ApprovalController((req) => {
      this.emitFn({ type: 'approval_request', request: req });
    });
    this.approvals = bindApprovals(
      { emit: (e) => this.emitFn(e) },
      this.gate,
      () => this.runSignal,
    );
  }

  emit: HostAdapter['emit'] = (event) => {
    this.emitFn(event);
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
    path: string,
    before: string,
    after: string,
    meta?: {
      toolName?: string;
      stepId?: string;
      input?: Record<string, unknown>;
    },
  ) {
    return this.approvals.showDiffPreview(path, before, after, meta);
  }

  confirmCommand(
    cmd: string,
    meta?: { toolName?: string; stepId?: string },
  ) {
    return this.approvals.confirmCommand(cmd, meta);
  }

  resolveApproval(stepId: string, decision: 'approve' | 'reject') {
    this.approvals.resolveApproval(stepId, decision);
  }

  getAutonomy() {
    return this.approvals.getAutonomy();
  }

  setAutonomy(level: 'strict' | 'low_friction') {
    this.approvals.setAutonomy(level);
  }

  getWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  isTrustedWorkspace(): boolean {
    return vscode.workspace.isTrusted;
  }

  secrets: HostSecrets = {
    get: async (key) => this.secretStore?.get(key),
    store: async (key, value) => {
      await this.secretStore?.store(key, value);
    },
  };

  bindSecrets(storage: vscode.SecretStorage): void {
    this.secretStore = storage;
  }

  async readFile(rel: string): Promise<string> {
    this.assertTrustedTools();
    const abs = this.resolvePath(rel);
    return fs.readFile(abs, 'utf8');
  }

  async writeFile(rel: string, content: string): Promise<void> {
    this.assertTrustedTools();
    const abs = this.resolvePath(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  async listDir(rel: string): Promise<string[]> {
    this.assertTrustedTools();
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
    this.assertTrustedTools();
    const root = this.requireRoot();
    const rgHits = await tryRg(root, pattern, opts);
    if (rgHits) return rgHits;
    return fallbackSearch(root, pattern, opts?.glob, opts?.signal);
  }

  async *runTerminal(
    cmd: string,
    opts: { cwd: string; signal?: AbortSignal },
  ): AsyncIterable<TerminalChunk> {
    this.assertTrustedTools();
    const child = spawn(cmd, {
      cwd: opts.cwd,
      shell: true,
      signal: opts.signal,
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
    const root = this.getWorkspaceRoot();
    if (!root) return {};
    try {
      let out = '';
      for await (const chunk of this.runTerminal('git status -sb', {
        cwd: root,
        signal,
      })) {
        out += chunk.text;
      }
      return { gitStatus: out.trim() };
    } catch {
      return {};
    }
  }

  private requireRoot(): string {
    const root = this.getWorkspaceRoot();
    if (!root) throw new Error('No workspace folder open');
    return root;
  }

  private resolvePath(rel: string): string {
    const root = this.requireRoot();
    const abs = path.resolve(root, rel);
    if (!isPathInsideWorkspace(root, abs)) {
      throw new Error(`Path escapes workspace: ${rel}`);
    }
    return abs;
  }

  private assertTrustedTools(): void {
    if (!this.isTrustedWorkspace()) {
      const msg =
        'Workspace is not trusted. Agentic file/terminal tools are disabled (NFR-D07).';
      this.output?.appendLine(msg);
      throw new Error(msg);
    }
  }
}

/** Case-safe workspace containment (Windows drive-letter / casing). */
function isPathInsideWorkspace(root: string, abs: string): boolean {
  const rootRes = path.resolve(root);
  const absRes = path.resolve(abs);
  if (process.platform === 'win32') {
    const rel = path.relative(rootRes.toLowerCase(), absRes.toLowerCase());
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }
  const rel = path.relative(rootRes, absRes);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function tryRg(
  root: string,
  pattern: string,
  opts?: { glob?: string; signal?: AbortSignal },
): Promise<SearchHit[] | null> {
  return new Promise((resolve) => {
    const args = ['--json', '--line-number', '--no-heading', pattern];
    if (opts?.glob) args.push('--glob', opts.glob);
    const child = spawn('rg', args, {
      cwd: root,
      shell: false,
      signal: opts?.signal,
    });
    let buf = '';
    let failed = false;
    child.on('error', () => {
      failed = true;
      resolve(null);
    });
    child.stdout?.on('data', (b: Buffer) => {
      buf += b.toString('utf8');
    });
    child.on('close', (code) => {
      if (failed) return;
      if (code !== 0 && code !== 1) {
        resolve(null);
        return;
      }
      const hits: SearchHit[] = [];
      for (const line of buf.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as {
            type?: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
            };
          };
          if (row.type !== 'match' || !row.data) continue;
          hits.push({
            path: row.data.path?.text ?? '',
            line: row.data.line_number ?? 0,
            text: (row.data.lines?.text ?? '').replace(/\r?\n$/, ''),
          });
        } catch {
          // ignore
        }
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
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next']);

  async function walk(dir: string): Promise<void> {
    if (signal?.aborted) return;
    if (hits.length >= 100) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
        continue;
      }
      if (glob && !minimatchSimple(e.name, glob)) continue;
      try {
        const text = await fs.readFile(full, 'utf8');
        if (text.includes('\0')) continue;
        const rel = path.relative(root, full).replace(/\\/g, '/');
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (re.test(line)) {
            hits.push({ path: rel, line: i + 1, text: line });
            if (hits.length >= 100) return;
          }
        }
      } catch {
        // skip unreadable
      }
    }
  }

  await walk(root);
  return hits;
}

/** Minimal glob: supports *.ext only. */
function minimatchSimple(name: string, glob: string): boolean {
  if (glob.startsWith('*.')) {
    return name.endsWith(glob.slice(1));
  }
  return name === glob;
}
