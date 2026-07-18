import { spawn } from 'node:child_process';
import type {
  HostAdapter,
  HostSecrets,
  SearchHit,
  TerminalChunk,
} from './host.js';
import { ApprovalController, bindApprovals } from './approval-controller.js';
import type { AutonomyLevel } from './approvals.js';

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

  const gate = new ApprovalController((req) => {
    events.push({ type: 'approval_request', request: req });
    if (opts.autoApprove) {
      queueMicrotask(() => gate.resolveApproval(req.stepId, 'approve'));
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
    runTerminal: async function* (
      cmd: string,
      termOpts: { cwd: string; signal?: AbortSignal },
    ): AsyncIterable<TerminalChunk> {
      // Safe stub: echo only; real shells belong in VsCodeHostAdapter.
      if (cmd.startsWith('echo ')) {
        yield { stream: 'stdout', text: `${cmd.slice(5)}\n` };
        return;
      }
      if (cmd.includes('git status')) {
        yield { stream: 'stdout', text: '## main\n' };
        return;
      }
      yield {
        stream: 'stderr',
        text: `fake-host: command not simulated: ${cmd}\n`,
      };
      void termOpts;
    },
    gatherMeta: async () => ({ gitStatus: '## main\nclean' }),
  };

  // Override showDiffPreview stepId to be stable when provided via meta — already in gate.
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
