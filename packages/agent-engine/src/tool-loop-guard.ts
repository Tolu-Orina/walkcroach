/**
 * Detect identical consecutive failed tool calls (esp. run_terminal) so the
 * agent cannot retry the same dead-end forever.
 */

import { normalizeEditPath } from './edit-anchor-guard.js';
import { normalizeAnchorText } from './nearest-anchor.js';

export const DEFAULT_IDENTICAL_FAILURE_LIMIT = 3;

export type ToolLoopGuardState = {
  fingerprint: string | null;
  streak: number;
};

export function emptyToolLoopGuard(): ToolLoopGuardState {
  return { fingerprint: null, streak: 0 };
}

/** Soft-normalize edit anchors so near-miss whitespace still shares a thrash fp. */
export function softNormalizeEditAnchor(text: string): string {
  return normalizeAnchorText(text);
}

/** Stable fingerprint for a tool invocation (name + relevant inputs). */
export function fingerprintToolCall(
  name: string,
  input: Record<string, unknown> | undefined | null,
): string {
  const args = input ?? {};
  if (name === 'run_terminal' || name === 'verify') {
    const cmd = String(args.cmd ?? args.command ?? '');
    const cwd = String(args.cwd ?? '');
    const mode = String(args.mode ?? '');
    return `${name}|${stableJson({ cmd: normalizeCmd(cmd), cwd, mode })}`;
  }
  // Cross-tool: edit_file and apply_patch share an anchor fingerprint so
  // switching tools does not reset thrash / identical-failure guards.
  // Soft whitespace normalization collapses near-miss thrash; path is normalized.
  if (name === 'edit_file' || name === 'apply_patch') {
    const path = normalizeEditPath(String(args.path ?? ''));
    const oldStrs: string[] = [];
    if (name === 'edit_file') {
      const o = String(args.old_str ?? '');
      if (o) oldStrs.push(o);
    } else if (Array.isArray(args.edits)) {
      for (const row of args.edits) {
        if (!row || typeof row !== 'object') continue;
        const o = String((row as { old_str?: unknown }).old_str ?? '');
        if (o) oldStrs.push(o);
      }
    }
    const joined = oldStrs
      .map((s) => softNormalizeEditAnchor(s))
      .filter(Boolean)
      .join('\n---\n');
    const slim =
      joined.length > 500
        ? `${joined.slice(0, 200)}…(${joined.length})`
        : joined;
    return `edit_anchor|${stableJson({ path, old: slim })}`;
  }
  // Generic: name + sorted shallow keys (avoid huge blobs)
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
  | {
      action: 'refuse';
      state: ToolLoopGuardState;
      message: string;
    };

/**
 * Call before executing a tool. If the same fingerprint already failed
 * `limit` times in a row, refuse without running it again.
 */
export function beforeToolCall(
  state: ToolLoopGuardState,
  name: string,
  input: Record<string, unknown> | undefined | null,
  limit: number = DEFAULT_IDENTICAL_FAILURE_LIMIT,
): ToolLoopGuardDecision {
  const fp = fingerprintToolCall(name, input);
  if (
    state.fingerprint === fp &&
    state.streak >= limit &&
    isLoopSensitiveTool(name)
  ) {
    return {
      action: 'refuse',
      state,
      message: [
        `Refused: identical \`${name}\` failed ${state.streak} times in a row.`,
        'Do NOT retry the same command/args.',
        'Change the approach (different command, cwd, flags, or create files manually),',
        'diagnose the root cause from prior stderr, or stop and ask the user.',
        `Fingerprint: ${fp}`,
      ].join(' '),
    };
  }
  return { action: 'allow', state };
}

/**
 * Call after a tool finishes. Success or a different tool resets the streak.
 */
export function afterToolResult(
  state: ToolLoopGuardState,
  name: string,
  input: Record<string, unknown> | undefined | null,
  status: 'success' | 'error' | 'rejected',
): ToolLoopGuardState {
  const fp = fingerprintToolCall(name, input);
  if (status === 'success') {
    return emptyToolLoopGuard();
  }
  if (!isLoopSensitiveTool(name)) {
    // Non-sensitive failures still break an identical shell streak
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

export function isLoopSensitiveTool(name: string): boolean {
  return (
    name === 'run_terminal' ||
    name === 'verify' ||
    name === 'edit_file' ||
    name === 'apply_patch'
  );
}

/** Stricter identical-failure limit for edit anchors (1 = refuse 2nd identical). */
export function identicalFailureLimitFor(
  name: string,
  defaultLimit: number,
): number {
  if (name === 'edit_file' || name === 'apply_patch') return 1;
  return defaultLimit;
}

export function buildStuckLoopNudge(state: ToolLoopGuardState): string {
  return [
    `STOP: the same tool call failed ${state.streak} times identically (${state.fingerprint ?? 'unknown'}).`,
    'You are in a retry loop. Do not call that tool with the same arguments again.',
    'Either change strategy, write/edit files directly, or end the turn and explain the blocker to the user.',
  ].join(' ');
}

/** Persistable shape for web session model_config. */
export type PersistedToolLoopGuard = {
  fingerprint: string | null;
  streak: number;
};

export function readPersistedToolLoopGuard(
  modelConfig: Record<string, unknown> | null | undefined,
): ToolLoopGuardState {
  const raw = modelConfig?.toolLoopGuard;
  if (!raw || typeof raw !== 'object') return emptyToolLoopGuard();
  const obj = raw as PersistedToolLoopGuard;
  return {
    fingerprint: typeof obj.fingerprint === 'string' ? obj.fingerprint : null,
    streak: typeof obj.streak === 'number' ? obj.streak : 0,
  };
}

export function writePersistedToolLoopGuard(
  modelConfig: Record<string, unknown>,
  state: ToolLoopGuardState,
): Record<string, unknown> {
  return {
    ...modelConfig,
    toolLoopGuard: {
      fingerprint: state.fingerprint,
      streak: state.streak,
    } satisfies PersistedToolLoopGuard,
  };
}
