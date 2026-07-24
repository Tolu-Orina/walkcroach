/**
 * Detect identical consecutive failed tool calls (esp. run_terminal) so the
 * web builder agent cannot retry the same dead-end forever across client resumes.
 * Mirrors packages/agent-engine/src/tool-loop-guard.ts
 */

export const DEFAULT_IDENTICAL_FAILURE_LIMIT = 3;

export type ToolLoopGuardState = {
  fingerprint: string | null;
  streak: number;
};

export function emptyToolLoopGuard(): ToolLoopGuardState {
  return { fingerprint: null, streak: 0 };
}

export function fingerprintToolCall(
  name: string,
  input: Record<string, unknown> | undefined | null,
): string {
  const args = input ?? {};
  if (name === 'run_terminal') {
    const cmd = String(args.cmd ?? args.command ?? '');
    const cwd = String(args.cwd ?? '');
    return `run_terminal|${stableJson({ cmd: normalizeCmd(cmd), cwd })}`;
  }
  const slim: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    const v = args[key];
    if (typeof v === 'string' && v.length > 500) {
      slim[key] = `${v.slice(0, 200)}…(${v.length})`;
    } else if (v !== undefined) {
      slim[key] = v;
    }
  }
  return `${name}|${stableJson(slim)}`;
}

function normalizeCmd(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return v;
  });
}

export type ToolLoopGuardDecision =
  | { action: 'allow'; state: ToolLoopGuardState }
  | { action: 'refuse'; state: ToolLoopGuardState; message: string };

export function beforeToolCall(
  state: ToolLoopGuardState,
  name: string,
  input: Record<string, unknown> | undefined | null,
  limit: number = DEFAULT_IDENTICAL_FAILURE_LIMIT,
): ToolLoopGuardDecision {
  const fp = fingerprintToolCall(name, input);
  if (state.fingerprint === fp && state.streak >= limit && name === 'run_terminal') {
    return {
      action: 'refuse',
      state,
      message: [
        `Refused: identical \`run_terminal\` failed ${state.streak} times in a row.`,
        'Do NOT retry the same command/args.',
        'Change the approach, diagnose stderr, or stop and ask the user.',
        `Fingerprint: ${fp}`,
      ].join(' '),
    };
  }
  return { action: 'allow', state };
}

export function afterToolResult(
  state: ToolLoopGuardState,
  name: string,
  input: Record<string, unknown> | undefined | null,
  status: 'success' | 'error',
): ToolLoopGuardState {
  const fp = fingerprintToolCall(name, input);
  if (status === 'success') {
    return emptyToolLoopGuard();
  }
  if (name !== 'run_terminal') {
    if (state.fingerprint && state.fingerprint !== fp) {
      return emptyToolLoopGuard();
    }
    return state;
  }
  if (state.fingerprint === fp) {
    return { fingerprint: fp, streak: state.streak + 1 };
  }
  return { fingerprint: fp, streak: 1 };
}

export function buildStuckLoopNudge(state: ToolLoopGuardState): string {
  return [
    `STOP: the same tool call failed ${state.streak} times identically (${state.fingerprint ?? 'unknown'}).`,
    'You are in a retry loop. Do not call that tool with the same arguments again.',
    'Either change strategy, write/edit files directly, or end the turn and explain the blocker to the user.',
  ].join(' ');
}

export function readPersistedToolLoopGuard(
  modelConfig: Record<string, unknown> | null | undefined,
): ToolLoopGuardState {
  const raw = modelConfig?.toolLoopGuard;
  if (!raw || typeof raw !== 'object') return emptyToolLoopGuard();
  const obj = raw as { fingerprint?: unknown; streak?: unknown };
  return {
    fingerprint: typeof obj.fingerprint === 'string' ? obj.fingerprint : null,
    streak: typeof obj.streak === 'number' ? obj.streak : 0,
  };
}

export function writePersistedToolLoopGuardPatch(
  state: ToolLoopGuardState,
): string {
  return JSON.stringify({
    fingerprint: state.fingerprint,
    streak: state.streak,
  });
}
