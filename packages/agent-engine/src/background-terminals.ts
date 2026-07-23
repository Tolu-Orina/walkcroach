import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { killProcessTree } from './process-kill.js';

export type BackgroundTaskInfo = {
  taskId: string;
  pid: number;
  /** Workspace-relative log path */
  logPath: string;
  cmd: string;
  cwd: string;
};

export type BackgroundTaskStatus = {
  taskId: string;
  status: 'running' | 'exited' | 'killed' | 'unknown';
  exitCode: number | null;
  pid?: number;
  logPath: string;
  /** Tail of the log (truncated). */
  logTail: string;
};

type InternalTask = {
  info: BackgroundTaskInfo;
  child: ChildProcess;
  logAbs: string;
  stream: WriteStream;
  exitCode: number | null;
  status: 'running' | 'exited' | 'killed';
};

/**
 * Tracks detached / long-running shell commands so the agent can keep working
 * and Stop can tear down the whole tree (npx → node → vite, etc.).
 */
export class BackgroundTerminalRegistry {
  private readonly tasks = new Map<string, InternalTask>();

  constructor(private readonly workspaceRoot: () => string | undefined) {}

  async start(params: {
    cmd: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
  }): Promise<BackgroundTaskInfo> {
    const root = this.workspaceRoot();
    if (!root) throw new Error('No workspace root');

    const taskId = randomUUID().slice(0, 8);
    const logRel = `.walkcroach/terminals/${taskId}.log`;
    const logAbs = join(root, logRel);
    await mkdir(dirname(logAbs), { recursive: true });
    const stream = createWriteStream(logAbs, { flags: 'a' });
    stream.write(`$ ${params.cmd}\ncwd: ${params.cwd}\n---\n`);

    const child = spawn(params.cmd, {
      cwd: params.cwd,
      shell: true,
      env: params.env ?? process.env,
      // Detach on Unix so we can kill the process group with -pid.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const pid = child.pid;
    if (pid == null) {
      stream.end();
      throw new Error('Failed to start background process');
    }

    const info: BackgroundTaskInfo = {
      taskId,
      pid,
      logPath: logRel.replace(/\\/g, '/'),
      cmd: params.cmd,
      cwd: params.cwd,
    };

    const entry: InternalTask = {
      info,
      child,
      logAbs,
      stream,
      exitCode: null,
      status: 'running',
    };
    this.tasks.set(taskId, entry);

    const onData = (buf: Buffer) => {
      try {
        stream.write(buf);
      } catch {
        /* ignore */
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('close', (code) => {
      if (entry.status === 'running') {
        entry.status = 'exited';
        entry.exitCode = code;
      }
      try {
        stream.write(`\n---\n[exit ${code}]\n`);
        stream.end();
      } catch {
        /* ignore */
      }
    });
    child.on('error', (err) => {
      try {
        stream.write(`\n[error] ${err.message}\n`);
      } catch {
        /* ignore */
      }
    });

    // Unref so the agent loop isn't kept alive solely by this handle on Unix.
    if (process.platform !== 'win32') {
      child.unref();
    }

    return info;
  }

  async poll(taskId: string, tailChars = 8000): Promise<BackgroundTaskStatus> {
    const entry = this.tasks.get(taskId);
    if (!entry) {
      const root = this.workspaceRoot();
      const logRel = `.walkcroach/terminals/${taskId}.log`;
      if (!root) {
        return {
          taskId,
          status: 'unknown',
          exitCode: null,
          logPath: logRel,
          logTail: '(unknown task)',
        };
      }
      const logAbs = join(root, logRel);
      let logTail = '';
      try {
        const raw = await readFile(logAbs, 'utf8');
        logTail = raw.slice(-tailChars);
      } catch {
        logTail = '(no log file)';
      }
      return {
        taskId,
        status: 'unknown',
        exitCode: null,
        logPath: logRel,
        logTail,
      };
    }

    let logTail = '';
    try {
      const raw = await readFile(entry.logAbs, 'utf8');
      logTail = raw.slice(-tailChars);
    } catch {
      logTail = '';
    }

    return {
      taskId,
      status: entry.status,
      exitCode: entry.exitCode,
      pid: entry.info.pid,
      logPath: entry.info.logPath,
      logTail,
    };
  }

  kill(taskId: string): boolean {
    const entry = this.tasks.get(taskId);
    if (!entry) return false;
    if (entry.status === 'running') {
      entry.status = 'killed';
      killProcessTree(entry.info.pid);
    }
    return true;
  }

  killAll(): void {
    for (const id of [...this.tasks.keys()]) {
      this.kill(id);
    }
  }

  listRunning(): BackgroundTaskInfo[] {
    return [...this.tasks.values()]
      .filter((t) => t.status === 'running')
      .map((t) => t.info);
  }
}
