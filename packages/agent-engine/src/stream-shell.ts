import { spawn } from 'node:child_process';
import type { TerminalChunk } from './host.js';
import { killProcessTree } from './process-kill.js';

export type StreamShellOpts = {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Called when the shell process has a pid (for Stop / killAll tracking). */
  onSpawn?: (pid: number) => void;
  onExit?: (pid: number) => void;
};

/**
 * Run a shell command and stream stdout/stderr. On abort or timeout, kills the
 * full process tree (npx → node → vite, etc.) instead of only the shell pid.
 */
export async function* streamShellCommand(
  cmd: string,
  opts: StreamShellOpts,
): AsyncIterable<TerminalChunk> {
  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const child = spawn(cmd, {
    cwd: opts.cwd,
    shell: true,
    env: opts.env ?? process.env,
    // Detach on Unix so kill(-pid) can signal the whole group.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const pid = child.pid;
  if (pid != null) opts.onSpawn?.(pid);

  let timedOut = false;
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tearDown = () => {
    killProcessTree(pid);
  };

  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      tearDown();
    }, opts.timeoutMs);
  }

  const onAbort = () => {
    aborted = true;
    tearDown();
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });

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
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (pid != null) opts.onExit?.(pid);
      done = true;
      wake?.();
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (pid != null) opts.onExit?.(pid);
      done = true;
      wake?.();
      resolve(code);
    });
  });

  try {
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
    if (aborted) {
      yield {
        stream: 'stderr',
        text: '\n[aborted — process tree killed]\n',
        exitCode: code ?? 130,
      };
      return;
    }
    if (timedOut) {
      yield {
        stream: 'stderr',
        text: `\n[timeout after ${opts.timeoutMs}ms — process tree killed]\n`,
        exitCode: code ?? 124,
      };
      return;
    }
    if (code && code !== 0) {
      yield {
        stream: 'stderr',
        text: `\n[exit ${code}]\n`,
        exitCode: code,
      };
    } else {
      yield { stream: 'stdout', text: '', exitCode: code ?? 0 };
    }
  } catch (err) {
    if (aborted || opts.signal?.aborted) {
      yield {
        stream: 'stderr',
        text: '\n[aborted — process tree killed]\n',
        exitCode: 130,
      };
      return;
    }
    throw err;
  }
}
