import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import {
  ApprovalController,
  BackgroundTerminalRegistry,
  InteractiveSessionRegistry,
  bindApprovals,
  canNonInteractiveApprove,
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
  type AgentEvent,
  type AgentTodo,
  type ApprovalDecision,
  type BackgroundTerminalPoll,
  type BackgroundTerminalStart,
  type HostAdapter,
  type HostSecrets,
  type SearchHit,
  type TerminalChunk,
  type AutonomyLevel,
  type BedrockMessage,
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
  private readonly activePids = new Set<number>();
  private readonly bgTerminals = new BackgroundTerminalRegistry(() =>
    this.getWorkspaceRoot(),
  );
  private readonly sessions = new InteractiveSessionRegistry();

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

  askUser(params: {
    question: string;
    options: string[];
    allowFreeText?: boolean;
    stepId?: string;
  }) {
    return this.approvals.askUser(params);
  }

  resolveApproval(stepId: string, decision: ApprovalDecision): void {
    this.approvals.resolveApproval(stepId, decision);
  }

  resolveQuestion(
    stepId: string,
    answer: { selected: string; freeText?: string } | 'reject',
  ): void {
    this.approvals.resolveQuestion(stepId, answer);
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

  async applyDiff(rel: string, diff: string): Promise<void> {
    const before = await this.readFile(rel);
    await this.writeFile(rel, applyDiffString(before, diff));
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

  async glob(
    pattern: string,
    opts?: { signal?: AbortSignal },
  ): Promise<string[]> {
    const root = this.opts.cwd;
    const reSrc = pattern
      .replace(/\\/g, '/')
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '::DS::')
      .replace(/\*/g, '[^/]*')
      .replace(/::DS::/g, '.*');
    const re = new RegExp(`^${reSrc}$`);
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      if (opts?.signal?.aborted) return;
      if (out.length >= 200) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (
          e.name === 'node_modules' ||
          e.name === '.git' ||
          e.name === 'dist'
        ) {
          continue;
        }
        const nextRel = rel ? `${rel}/${e.name}` : e.name;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(abs, nextRel);
        } else if (re.test(nextRel.replace(/\\/g, '/'))) {
          out.push(nextRel.replace(/\\/g, '/'));
        }
      }
    };
    await walk(root, '');
    return out.sort();
  }

  async *runTerminal(
    cmd: string,
    termOpts: {
      cwd: string;
      signal?: AbortSignal;
      timeoutMs?: number;
      stdin?: string;
      replies?: string[];
      onConfirmPrompt?: import('@walkcroach/agent-engine').RunTerminalOpts['onConfirmPrompt'];
    },
  ): AsyncIterable<TerminalChunk> {
    yield* streamShellCommand(cmd, {
      cwd: termOpts.cwd,
      signal: termOpts.signal,
      timeoutMs: termOpts.timeoutMs,
      stdin: termOpts.stdin,
      replies: termOpts.replies,
      onConfirmPrompt: termOpts.onConfirmPrompt,
      onSpawn: (pid) => this.activePids.add(pid),
      onExit: (pid) => this.activePids.delete(pid),
    });
  }

  async startBackgroundTerminal(
    cmd: string,
    opts: { cwd: string },
  ): Promise<BackgroundTerminalStart> {
    const info = await this.bgTerminals.start({
      cmd,
      cwd: opts.cwd,
    });
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
    return this.bgTerminals.kill(taskId);
  }

  async startTerminalSession(params: {
    cmd: string;
    cwd: string;
    cols?: number;
    rows?: number;
  }) {
    return this.sessions.start(params);
  }

  async writeTerminalSession(
    sessionId: string,
    input: string,
    opts?: { appendNewline?: boolean },
  ): Promise<void> {
    this.sessions.write(sessionId, input, opts);
  }

  async readTerminalSession(
    sessionId: string,
    opts?: {
      timeoutMs?: number;
      settleMs?: number;
      maxChars?: number;
    },
  ) {
    return this.sessions.read(sessionId, opts);
  }

  async closeTerminalSession(sessionId: string): Promise<boolean> {
    return this.sessions.close(sessionId);
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
    const root = this.opts.cwd;
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
    return loadAgentSession(this.opts.cwd);
  }

  async clearAgentSession(): Promise<void> {
    await clearActiveAgentSession(this.opts.cwd);
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

    if (req.kind === 'question') {
      if (this.opts.nonInteractive) {
        const selected = req.options?.[0] ?? 'ok';
        queueMicrotask(() =>
          this.resolveQuestion(stepId, { selected }),
        );
        return;
      }
      if (this.opts.externalApprovals) return;
      if (this.opts.promptApprovals === false) {
        queueMicrotask(() => this.resolveQuestion(stepId, 'reject'));
        return;
      }
      const options = req.options ?? [];
      process.stderr.write(`\n${req.question ?? 'Choose:'}\n`);
      options.forEach((o, i) => process.stderr.write(`  ${i + 1}) ${o}\n`));
      const answer = await askLine('Select number: ');
      const idx = Number(answer) - 1;
      if (idx >= 0 && idx < options.length) {
        this.resolveQuestion(stepId, { selected: options[idx]! });
      } else {
        this.resolveQuestion(stepId, 'reject');
      }
      return;
    }

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

function askLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
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
