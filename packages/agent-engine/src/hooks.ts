/**
 * Optional PostToolUse hooks from `.walkcroach/settings.json` (Claude hooks pattern).
 * Non-blocking: hook failure emits a warning, never fails the agent tool.
 */

import { spawn } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import { killProcessTree } from './process-kill.js';

export type PostToolUseHook = {
  /** Regex matched against tool name; default ".*" */
  matcher: string;
  /** Shell command or relative script path under the workspace. */
  command: string;
  timeoutMs: number;
};

export type HooksConfig = {
  PostToolUse: PostToolUseHook[];
};

export type PostToolUsePayload = {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: {
    status: string;
    content: string;
  };
  cwd: string;
};

export function defaultHooksConfig(): HooksConfig {
  return { PostToolUse: [] };
}

export function parseHooksConfig(raw: unknown): HooksConfig {
  const out = defaultHooksConfig();
  if (!raw || typeof raw !== 'object') return out;
  const hooks = (raw as Record<string, unknown>).hooks;
  if (!hooks || typeof hooks !== 'object') {
    // Also accept top-level PostToolUse for convenience in tests.
    const top = raw as Record<string, unknown>;
    if (Array.isArray(top.PostToolUse)) {
      out.PostToolUse = normalizeHookList(top.PostToolUse);
    }
    return out;
  }
  const h = hooks as Record<string, unknown>;
  if (Array.isArray(h.PostToolUse)) {
    out.PostToolUse = normalizeHookList(h.PostToolUse);
  }
  return out;
}

function normalizeHookList(list: unknown[]): PostToolUseHook[] {
  const out: PostToolUseHook[] = [];
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const command = String(row.command ?? '').trim();
    if (!command) continue;
    const matcher =
      typeof row.matcher === 'string' && row.matcher.trim()
        ? row.matcher.trim()
        : '.*';
    const timeoutRaw = row.timeoutMs;
    const timeoutMs =
      typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw)
        ? Math.max(500, Math.min(30_000, Math.floor(timeoutRaw)))
        : 5_000;
    out.push({ matcher, command, timeoutMs });
  }
  return out;
}

export function hookMatches(matcher: string, toolName: string): boolean {
  try {
    return new RegExp(matcher, 'i').test(toolName);
  } catch {
    return matcher.toLowerCase() === toolName.toLowerCase();
  }
}

/**
 * Ensure a hook command that looks like a relative path stays inside workspace.
 * Shell builtins / flags (no path sep) are allowed as-is.
 */
export function assertHookCommandSafe(
  workspaceRoot: string,
  command: string,
): string {
  const token = command.trim().split(/\s+/)[0] ?? '';
  if (!token || token.startsWith('-')) return command;
  // Absolute paths must be under workspace.
  if (isAbsolute(token) || token.includes('/') || token.includes('\\') || token.includes('.')) {
    const abs = isAbsolute(token) ? resolve(token) : resolve(workspaceRoot, token);
    const rel = relative(resolve(workspaceRoot), abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Hook command escapes workspace: ${token}`);
    }
  }
  return command;
}

export async function runPostToolUseHooks(params: {
  workspaceRoot: string;
  hooks: PostToolUseHook[];
  toolName: string;
  toolInput: Record<string, unknown>;
  toolStatus: string;
  toolContent: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const warnings: string[] = [];
  const matching = params.hooks.filter((h) =>
    hookMatches(h.matcher, params.toolName),
  );
  if (!matching.length) return warnings;

  const payload: PostToolUsePayload = {
    hook_event_name: 'PostToolUse',
    tool_name: params.toolName,
    tool_input: params.toolInput,
    tool_response: {
      status: params.toolStatus,
      content: params.toolContent.slice(0, 8_000),
    },
    cwd: params.workspaceRoot,
  };
  const stdin = `${JSON.stringify(payload)}\n`;

  for (const hook of matching) {
    if (params.signal?.aborted) break;
    try {
      const command = assertHookCommandSafe(
        params.workspaceRoot,
        hook.command,
      );
      await runHookCommand({
        command,
        cwd: params.workspaceRoot,
        stdin,
        timeoutMs: hook.timeoutMs,
        signal: params.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`PostToolUse hook failed (${hook.command}): ${message}`);
    }
  }
  return warnings;
}

function runHookCommand(params: {
  command: string;
  cwd: string;
  stdin: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    if (params.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const child = spawn(params.command, {
      cwd: params.cwd,
      shell: true,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const pid = child.pid;
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      killProcessTree(pid);
      finish(new Error(`timed out after ${params.timeoutMs}ms`));
    }, params.timeoutMs);

    const onAbort = () => {
      killProcessTree(pid);
      finish(new DOMException('Aborted', 'AbortError'));
    };
    params.signal?.addEventListener('abort', onAbort, { once: true });

    child.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.stdin?.write(params.stdin);
    child.stdin?.end();

    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `exit ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ''}`,
          ),
        );
      }
    });

    function finish(err?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      params.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolvePromise();
    }
  });
}
