import { spawn, type ChildProcess } from 'node:child_process';
import type { TerminalChunk } from './host.js';
import { killProcessTree } from './process-kill.js';
import {
  CONFIRM_IDLE_MS,
  MAX_CONFIRM_PROMPTS,
  detectConfirmPrompt,
  looksLikePasswordPrompt,
  type ConfirmPromptAnswer,
  type ConfirmPromptRequest,
} from './terminal-prompts.js';

/** Cap combined stdin payload (bytes as UTF-8 string length). */
export const MAX_STDIN_CHARS = 64_000;
/** Cap number of discrete reply lines. */
export const MAX_STDIN_REPLIES = 20;

export type StreamShellOpts = {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * Raw bytes written to stdin first (exact). Prefer including trailing `\n`
   * when the CLI expects Enter after a confirm.
   */
  stdin?: string;
  /**
   * Discrete replies written after `stdin`, each with a trailing newline if
   * missing. Use for planned yes/no / wizard answers.
   */
  replies?: string[];
  /**
   * Tier B — when set, stdin stays open after preload and idle confirm
   * prompts are surfaced via this callback (reply written back to stdin).
   * Return `abort` to kill the process.
   */
  onConfirmPrompt?: (
    req: ConfirmPromptRequest,
  ) => Promise<ConfirmPromptAnswer>;
  /** Override idle ms before prompt detection (default CONFIRM_IDLE_MS). */
  confirmIdleMs?: number;
  /** Cap Tier B prompts per command (default MAX_CONFIRM_PROMPTS). */
  maxConfirmPrompts?: number;
  /** Called when the shell process has a pid (for Stop / killAll tracking). */
  onSpawn?: (pid: number) => void;
  onExit?: (pid: number) => void;
};

/**
 * Build the exact stdin buffer for Tier A preload.
 * - `stdin` is written verbatim (no auto newline)
 * - each `replies[]` entry gets a trailing `\n` if missing
 */
export function buildStdinPayload(opts: {
  stdin?: string;
  replies?: string[];
}): string | undefined {
  const parts: string[] = [];
  if (typeof opts.stdin === 'string' && opts.stdin.length > 0) {
    parts.push(opts.stdin);
  }
  if (Array.isArray(opts.replies)) {
    if (opts.replies.length > MAX_STDIN_REPLIES) {
      throw new Error(
        `replies allows at most ${MAX_STDIN_REPLIES} entries`,
      );
    }
    for (const raw of opts.replies) {
      const s = String(raw ?? '');
      parts.push(s.endsWith('\n') ? s : `${s}\n`);
    }
  }
  if (!parts.length) return undefined;
  const payload = parts.join('');
  if (payload.length > MAX_STDIN_CHARS) {
    throw new Error(
      `stdin/replies exceed ${MAX_STDIN_CHARS} characters`,
    );
  }
  return payload;
}

function writeStdin(child: ChildProcess, text: string): void {
  try {
    child.stdin?.write(text);
  } catch {
    /* EPIPE */
  }
}

function endStdin(child: ChildProcess): void {
  try {
    child.stdin?.end();
  } catch {
    /* ignore */
  }
}

/**
 * Run a shell command and stream stdout/stderr. On abort or timeout, kills the
 * full process tree (npx → node → vite, etc.) instead of only the shell pid.
 *
 * Tier A: optional stdin/replies preload.
 * Tier B: when `onConfirmPrompt` is set, keep stdin open and ask on idle
 * confirm patterns (max N times). Password-like prompts abort.
 */
export async function* streamShellCommand(
  cmd: string,
  opts: StreamShellOpts,
): AsyncIterable<TerminalChunk> {
  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const interactive = typeof opts.onConfirmPrompt === 'function';
  const maxPrompts = opts.maxConfirmPrompts ?? MAX_CONFIRM_PROMPTS;
  const idleMs = opts.confirmIdleMs ?? CONFIRM_IDLE_MS;

  const preload = buildStdinPayload({
    stdin: opts.stdin,
    replies: opts.replies,
  });

  const child = spawn(cmd, {
    cwd: opts.cwd,
    shell: true,
    env: opts.env ?? process.env,
    // Detach on Unix so kill(-pid) can signal the whole group.
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const pid = child.pid;
  if (pid != null) opts.onSpawn?.(pid);

  if (preload) {
    writeStdin(child, preload);
  }
  // Tier A only: close stdin (EOF). Tier B keeps it open for mid-run answers.
  if (!interactive) {
    endStdin(child);
  }

  let timedOut = false;
  let aborted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let outputAll = '';
  let handledThrough = 0;
  let promptsUsed = 0;
  let promptInFlight = false;

  const tearDown = () => {
    if (idleTimer) clearTimeout(idleTimer);
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

  const scheduleIdleCheck = () => {
    if (!interactive || done || promptInFlight) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      void runIdlePromptCheck();
    }, idleMs);
  };

  const runIdlePromptCheck = async () => {
    if (!interactive || done || promptInFlight || !opts.onConfirmPrompt) return;
    if (promptsUsed >= maxPrompts) return;

    const fresh = outputAll.slice(handledThrough);
    if (!fresh.trim()) return;

    if (looksLikePasswordPrompt(fresh) || looksLikePasswordPrompt(outputAll.slice(-800))) {
      push({
        stream: 'stderr',
        text: '\n[walkcroach] Password/sudo prompt detected — aborting (do not send secrets via terminal stdin). Use non-interactive auth or ask_user outside the shell.\n',
      });
      aborted = true;
      tearDown();
      return;
    }

    const detected = detectConfirmPrompt(fresh);
    if (!detected) return;

    promptInFlight = true;
    promptsUsed += 1;
    const promptIndex = promptsUsed;
    push({
      stream: 'stderr',
      text: `\n[walkcroach] Confirm prompt (${promptIndex}/${maxPrompts}): ${detected.matched}\n`,
    });

    try {
      const answer = await opts.onConfirmPrompt({
        matched: detected.matched,
        options: detected.options,
        promptText: detected.promptText,
        promptIndex,
        maxPrompts,
      });

      if (done) return;

      if (answer === 'abort') {
        push({
          stream: 'stderr',
          text: '\n[walkcroach] User aborted at confirm prompt.\n',
        });
        aborted = true;
        tearDown();
        return;
      }

      const line =
        answer === '(Enter)' || answer === ''
          ? '\n'
          : answer.endsWith('\n')
            ? answer
            : `${answer}\n`;
      writeStdin(child, line);
      push({
        stream: 'stderr',
        text: `[walkcroach] Sent reply: ${JSON.stringify(line.replace(/\n$/, ''))}\n`,
      });
      handledThrough = outputAll.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      push({
        stream: 'stderr',
        text: `\n[walkcroach] Confirm prompt failed: ${message}\n`,
      });
      aborted = true;
      tearDown();
    } finally {
      promptInFlight = false;
      if (!done) scheduleIdleCheck();
    }
  };

  const onData = (stream: 'stdout' | 'stderr') => (b: Buffer) => {
    const text = b.toString('utf8');
    outputAll += text;
    push({ stream, text });
    scheduleIdleCheck();
  };

  child.stdout?.on('data', onData('stdout'));
  child.stderr?.on('data', onData('stderr'));

  const finished = new Promise<number | null>((resolve, reject) => {
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      endStdin(child);
      if (pid != null) opts.onExit?.(pid);
      done = true;
      wake?.();
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      endStdin(child);
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
