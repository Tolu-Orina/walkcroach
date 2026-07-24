import { spawn } from 'node:child_process';
import type {
  HostAdapter,
  HostSecrets,
  SearchHit,
  TerminalChunk,
} from './host.js';
import { ApprovalController, bindApprovals } from './approval-controller.js';
import type { AutonomyLevel } from './approvals.js';
import { InteractiveSessionRegistry } from './pty-session.js';

export type FakeHostOptions = {
  files?: Record<string, string>;
  /** Auto-approve all diffs/commands (for non-interactive unit tests). */
  autoApprove?: boolean;
  autonomy?: AutonomyLevel;
  workspaceRoot?: string;
};

/**
 * In-memory HostAdapter for CI (impl plan §10).
 */
export function createFakeHost(opts: FakeHostOptions = {}): HostAdapter & {
  files: Map<string, string>;
  events: import('./host.js').AgentEvent[];
} {
  const files = new Map<string, string>(
    Object.entries(opts.files ?? {}).map(([k, v]) => [norm(k), v]),
  );
  const events: import('./host.js').AgentEvent[] = [];
  const workspaceRoot = opts.workspaceRoot ?? '/workspace';
  let currentSignal: AbortSignal | undefined;
  const sessions = new InteractiveSessionRegistry({ forcePipe: true });

  const gate = new ApprovalController((req) => {
    events.push({ type: 'approval_request', request: req });
    if (opts.autoApprove) {
      queueMicrotask(() => {
        if (req.kind === 'question') {
          gate.resolveQuestion(req.stepId, {
            selected: req.options?.[0] ?? 'ok',
          });
        } else {
          gate.resolveApproval(req.stepId, 'approve');
        }
      });
    }
  });
  if (opts.autonomy) gate.setAutonomy(opts.autonomy);

  const emit: HostAdapter['emit'] = (event) => {
    events.push(event);
  };

  const approvals = bindApprovals({ emit }, gate, () => currentSignal);

  const host: HostAdapter & {
    files: Map<string, string>;
    events: typeof events;
    setSignal: (s?: AbortSignal) => void;
  } = {
    files,
    events,
    setSignal: (s) => {
      currentSignal = s;
    },
    emit,
    ...approvals,
    getWorkspaceRoot: () => workspaceRoot,
    isTrustedWorkspace: () => true,
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
    } satisfies HostSecrets,
    readFile: async (path) => {
      const key = norm(path);
      const v = files.get(key);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    writeFile: async (path, content) => {
      files.set(norm(path), content);
    },
    applyDiff: async (path, diff) => {
      const { applyDiffString } = await import('./patch.js');
      const key = norm(path);
      const before = files.get(key);
      if (before === undefined) throw new Error(`ENOENT: ${path}`);
      files.set(key, applyDiffString(before, diff));
    },
    listDir: async (path) => {
      const prefix = norm(path) === '.' ? '' : `${norm(path)}/`;
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (prefix && !key.startsWith(prefix) && key !== norm(path)) continue;
        const rest = prefix ? key.slice(prefix.length) : key;
        if (!rest && key === norm(path)) continue;
        const part = rest.split('/')[0];
        if (part) names.add(part);
      }
      return [...names].sort();
    },
    search: async (pattern) => {
      const re = new RegExp(pattern, 'i');
      const hits: SearchHit[] = [];
      for (const [path, content] of files) {
        const lines = content.split(/\r?\n/);
        lines.forEach((text, i) => {
          if (re.test(text)) {
            hits.push({ path, line: i + 1, text });
          }
        });
      }
      return hits.slice(0, 100);
    },
    glob: async (pattern) => {
      const keys = [...files.keys()];
      // Minimal glob: support * and ** via regex
      const reSrc = pattern
        .replace(/\\/g, '/')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '::DS::')
        .replace(/\*/g, '[^/]*')
        .replace(/::DS::/g, '.*');
      const re = new RegExp(`^${reSrc}$`);
      return keys.filter((k) => re.test(k)).sort();
    },
    runTerminal: async function* (
      cmd: string,
      termOpts: {
        cwd: string;
        signal?: AbortSignal;
        timeoutMs?: number;
        stdin?: string;
        replies?: string[];
        onConfirmPrompt?: import('./host.js').RunTerminalOpts['onConfirmPrompt'];
      },
    ): AsyncIterable<TerminalChunk> {
      // Real interactive path for Tier B unit tests.
      if (cmd.includes('__WALKCROACH_CONFIRM_STREAM__')) {
        const { streamShellCommand } = await import('./stream-shell.js');
        yield* streamShellCommand(
          'node -e "const rl=require(\'readline\').createInterface({input:process.stdin,output:process.stdout});process.stdout.write(\'Continue? [y/N] \');rl.question(\'\',(a)=>{process.stdout.write(\'got:\'+a+\'\\n\');rl.close();process.exit(a.trim().toLowerCase()===\'y\'?0:2);})"',
          {
            // Fake host workspace is virtual (/workspace) — use real cwd for spawn.
            cwd: process.cwd(),
            signal: termOpts.signal,
            timeoutMs: termOpts.timeoutMs ?? 15_000,
            onConfirmPrompt: termOpts.onConfirmPrompt,
            confirmIdleMs: 200,
          },
        );
        return;
      }
      if (cmd.startsWith('echo ')) {
        yield { stream: 'stdout', text: `${cmd.slice(5)}\n`, exitCode: 0 };
        return;
      }
      if (cmd.includes('git status')) {
        yield { stream: 'stdout', text: '## main\n', exitCode: 0 };
        return;
      }
      // Test helper: echo back preloaded stdin/replies.
      if (cmd.includes('__WALKCROACH_ECHO_STDIN__')) {
        const { buildStdinPayload } = await import('./stream-shell.js');
        const payload =
          buildStdinPayload({
            stdin: termOpts.stdin,
            replies: termOpts.replies,
          }) ?? '';
        yield {
          stream: 'stdout',
          text: payload || '(empty stdin)\n',
          exitCode: 0,
        };
        return;
      }
      yield {
        stream: 'stderr',
        text: `fake-host: command not simulated: ${cmd}\n`,
        exitCode: 1,
      };
      void termOpts;
    },
    startBackgroundTerminal: async (cmd) => ({
      taskId: 'fake-bg',
      pid: 1,
      logPath: '.walkcroach/terminals/fake-bg.log',
      cmd,
    }),
    pollBackgroundTerminal: async (taskId) => ({
      taskId,
      status: 'exited' as const,
      exitCode: 0,
      logPath: `.walkcroach/terminals/${taskId}.log`,
      logTail: '(fake)',
    }),
    killBackgroundTerminal: async () => true,
    killAllTerminals: () => {
      sessions.killAll();
    },
    startTerminalSession: async (params) =>
      sessions.start({
        ...params,
        // Fake workspace is virtual — spawn from real cwd.
        cwd: process.cwd(),
      }),
    writeTerminalSession: async (sessionId, input, o) => {
      sessions.write(sessionId, input, o);
    },
    readTerminalSession: async (sessionId, o) => sessions.read(sessionId, o),
    closeTerminalSession: async (sessionId) => sessions.close(sessionId),
    listTerminalSessions: async () => sessions.list(),
    persistTodos: async (todos) => {
      files.set('.walkcroach/todos.json', JSON.stringify({ todos }));
    },
    loadTodos: async () => {
      const raw = files.get('.walkcroach/todos.json');
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { todos?: unknown };
        const { normalizeTodos } = await import('./todos.js');
        return normalizeTodos(parsed.todos);
      } catch {
        return null;
      }
    },
    clearTodos: async () => {
      files.delete('.walkcroach/todos.json');
    },
    gatherMeta: async () => ({ gitStatus: '## main\nclean' }),
  };

  return host;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

/** Optional: run a real command for integration (not used in unit tests). */
export function runRealTerminal(
  cmd: string,
  opts: { cwd: string; signal?: AbortSignal },
): AsyncIterable<TerminalChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      const child = spawn(cmd, {
        cwd: opts.cwd,
        shell: true,
        signal: opts.signal,
      });
      const chunks: TerminalChunk[] = [];
      child.stdout?.on('data', (b: Buffer) => {
        chunks.push({ stream: 'stdout', text: b.toString('utf8') });
      });
      child.stderr?.on('data', (b: Buffer) => {
        chunks.push({ stream: 'stderr', text: b.toString('utf8') });
      });
      await new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', () => resolve());
      });
      for (const c of chunks) yield c;
    },
  };
}
