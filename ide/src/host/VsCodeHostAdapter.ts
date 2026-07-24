import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  AgentTodo,
  BackgroundTerminalPoll,
  BackgroundTerminalStart,
  HostAdapter,
  HostSecrets,
  SearchHit,
  TerminalChunk,
} from '@walkcroach/agent-engine';
import {
  ApprovalController,
  BackgroundTerminalRegistry,
  InteractiveSessionRegistry,
  bindApprovals,
  clearPersistedTodos,
  clearActiveAgentSession,
  killProcessTree,
  loadAgentSession,
  loadPersistedTodos,
  loadWorkspaceAgentConfig,
  persistAgentSession,
  persistTodos,
  streamShellCommand,
  applyDiffString,
} from '@walkcroach/agent-engine';
import type { BedrockMessage } from '@walkcroach/agent-engine';
import { WalkCroachShellView } from './shell-view.js';

/**
 * Phase A host: workspace fs, terminal, search, approvals, trust.
 */
export class VsCodeHostAdapter implements HostAdapter {
  private readonly gate: ApprovalController;
  private readonly approvals: ReturnType<typeof bindApprovals>;
  private runSignal: AbortSignal | undefined;
  private secretStore: vscode.SecretStorage | undefined;
  private readonly activePids = new Set<number>();
  private readonly bgTerminals = new BackgroundTerminalRegistry(() =>
    this.getWorkspaceRoot(),
  );
  private readonly shellView = new WalkCroachShellView();
  private readonly sessions = new InteractiveSessionRegistry({
    onOutput: (_sessionId, chunk) => {
      this.shellView.write(chunk);
    },
  });

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
    if (signal?.aborted) {
      this.gate.cancelAll();
      this.killAllTerminals();
    }
    signal?.addEventListener(
      'abort',
      () => {
        this.gate.cancelAll();
        this.killAllTerminals();
      },
      { once: true },
    );
  }

  killAllTerminals(): void {
    for (const pid of [...this.activePids]) {
      killProcessTree(pid);
    }
    this.activePids.clear();
    this.bgTerminals.killAll();
    this.sessions.killAll();
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

  askUser(params: {
    question: string;
    options: string[];
    allowFreeText?: boolean;
    stepId?: string;
  }) {
    return this.approvals.askUser(params);
  }

  resolveApproval(stepId: string, decision: 'approve' | 'reject') {
    this.approvals.resolveApproval(stepId, decision);
  }

  resolveQuestion(
    stepId: string,
    answer:
      | { selected: string; freeText?: string }
      | 'reject',
  ) {
    this.approvals.resolveQuestion(stepId, answer);
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

  async applyDiff(rel: string, diff: string): Promise<void> {
    this.assertTrustedTools();
    const before = await this.readFile(rel);
    const after = applyDiffString(before, diff);
    await this.writeFile(rel, after);
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

  async glob(
    pattern: string,
    opts?: { signal?: AbortSignal },
  ): Promise<string[]> {
    this.assertTrustedTools();
    const root = this.requireRoot();
    if (opts?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return [];
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, pattern),
      '**/{node_modules,.git,dist,coverage}/**',
      200,
    );
    return uris
      .map((u) => path.relative(root, u.fsPath).replace(/\\/g, '/'))
      .sort();
  }

  async *runTerminal(
    cmd: string,
    opts: {
      cwd: string;
      signal?: AbortSignal;
      timeoutMs?: number;
      stdin?: string;
      replies?: string[];
      onConfirmPrompt?: import('@walkcroach/agent-engine').RunTerminalOpts['onConfirmPrompt'];
    },
  ): AsyncIterable<TerminalChunk> {
    this.assertTrustedTools();
    // Reliable agent I/O via child_process; mirror into one reusable PTY tab.
    const preloadBits: string[] = [];
    if (opts.stdin) preloadBits.push('stdin');
    if (opts.replies?.length) preloadBits.push(`${opts.replies.length} replies`);
    if (opts.onConfirmPrompt) preloadBits.push('interactive');
    this.shellView.startCommand(
      preloadBits.length
        ? `${cmd}  (${preloadBits.join(', ')})`
        : cmd,
      opts.cwd,
    );
    let lastExit: number | null = null;
    try {
      for await (const chunk of streamShellCommand(cmd, {
        cwd: opts.cwd,
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        stdin: opts.stdin,
        replies: opts.replies,
        onConfirmPrompt: opts.onConfirmPrompt,
        onSpawn: (pid) => this.activePids.add(pid),
        onExit: (pid) => this.activePids.delete(pid),
      })) {
        if (chunk.text) {
          this.shellView.write(chunk.text);
        }
        if (chunk.exitCode !== undefined) {
          lastExit = chunk.exitCode;
        }
        yield chunk;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.shellView.write(`\n[error] ${message}\n`);
      throw err;
    } finally {
      this.shellView.endCommand(lastExit);
    }
  }

  async startBackgroundTerminal(
    cmd: string,
    opts: { cwd: string },
  ): Promise<BackgroundTerminalStart> {
    this.assertTrustedTools();
    // Hidden process tree (reliable poll/kill); announce in the shared shell view.
    const info = await this.bgTerminals.start({
      cmd,
      cwd: opts.cwd,
    });
    this.shellView.note(
      `Background task ${info.taskId} started (pid ${info.pid})\n$ ${cmd}\nlog: ${info.logPath}`,
    );
    return {
      taskId: info.taskId,
      pid: info.pid,
      logPath: info.logPath,
      cmd: info.cmd,
    };
  }

  async pollBackgroundTerminal(
    taskId: string,
  ): Promise<BackgroundTerminalPoll> {
    const poll = await this.bgTerminals.poll(taskId);
    return {
      taskId: poll.taskId,
      status: poll.status,
      exitCode: poll.exitCode,
      logPath: poll.logPath,
      logTail: poll.logTail,
    };
  }

  async killBackgroundTerminal(taskId: string): Promise<boolean> {
    const killed = this.bgTerminals.kill(taskId);
    if (killed) {
      this.shellView.note(`Background task ${taskId} killed`);
    }
    return killed;
  }

  async startTerminalSession(params: {
    cmd: string;
    cwd: string;
    cols?: number;
    rows?: number;
  }) {
    this.assertTrustedTools();
    const info = await this.sessions.start(params);
    this.shellView.startSession(
      info.sessionId,
      info.cmd,
      info.cwd,
      info.backend,
    );
    return info;
  }

  async writeTerminalSession(
    sessionId: string,
    input: string,
    opts?: { appendNewline?: boolean },
  ): Promise<void> {
    this.assertTrustedTools();
    this.sessions.write(sessionId, input, opts);
    const shown =
      opts?.appendNewline === false || input.endsWith('\n')
        ? input
        : `${input}\n`;
    this.shellView.write(`\x1b[36m‹ ${shown.replace(/\r?\n/g, '\\n')}\x1b[0m\r\n`);
  }

  async readTerminalSession(
    sessionId: string,
    opts?: {
      timeoutMs?: number;
      settleMs?: number;
      maxChars?: number;
    },
  ) {
    this.assertTrustedTools();
    return this.sessions.read(sessionId, opts);
  }

  async closeTerminalSession(sessionId: string): Promise<boolean> {
    this.assertTrustedTools();
    const closed = this.sessions.close(sessionId);
    if (closed) {
      this.shellView.endSession(sessionId, 'closed');
    }
    return closed;
  }

  async listTerminalSessions() {
    return this.sessions.list();
  }

  async persistTodos(todos: AgentTodo[]): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;
    await persistTodos(root, todos);
  }

  async loadTodos(): Promise<AgentTodo[] | null> {
    const root = this.getWorkspaceRoot();
    if (!root) return null;
    return loadPersistedTodos(root);
  }

  async clearTodos(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;
    await clearPersistedTodos(root);
  }

  async persistAgentSession(snapshot: {
    sessionId: string;
    messages: BedrockMessage[];
    transcript?: string;
    createdAt?: string;
  }): Promise<{ sessionId: string }> {
    const root = this.requireRoot();
    const cfg = await loadWorkspaceAgentConfig(root);
    if (!cfg.settings.session.persist) {
      return { sessionId: snapshot.sessionId };
    }
    const saved = await persistAgentSession(root, snapshot, {
      maxSessions: cfg.settings.session.maxSessions,
    });
    return { sessionId: saved.sessionId };
  }

  async loadAgentSession() {
    const root = this.getWorkspaceRoot();
    if (!root) return null;
    return loadAgentSession(root);
  }

  async clearAgentSession(): Promise<void> {
    const root = this.getWorkspaceRoot();
    if (!root) return;
    await clearActiveAgentSession(root);
  }

  async gatherMeta(
    signal?: AbortSignal,
  ): Promise<{ gitStatus?: string }> {
    const root = this.getWorkspaceRoot();
    if (!root) return {};
    try {
      // Quiet: do not open/spam the WalkCroach shell tab for meta gather.
      let out = '';
      for await (const chunk of streamShellCommand('git status -sb', {
        cwd: root,
        signal,
        timeoutMs: 15_000,
        onSpawn: (pid) => this.activePids.add(pid),
        onExit: (pid) => this.activePids.delete(pid),
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
    const raw = (rel || '.').trim();
    // Absolute paths under the workspace are accepted; prefer relative in tools.
    const abs = path.isAbsolute(raw)
      ? path.normalize(raw)
      : path.resolve(root, raw);
    if (!isPathInsideWorkspace(root, abs)) {
      throw new Error(
        `Path escapes workspace (use a path relative to ${root}): ${raw}`,
      );
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
