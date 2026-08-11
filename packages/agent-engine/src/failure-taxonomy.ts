/**
 * P2 — Failure taxonomy + hard phase-transition helpers.
 *
 * Classifies tool/verify failures for Verify→Act edges, applies CoDD-style
 * divergent nudges when the same class repeats, and detects Gather read thrash
 * (same path re-read without mutation).
 */

import { classifyToolError, type ToolErrorClass } from './tool-call-observe.js';

/** Coarse classes used for phase transitions (subset + verify-oriented). */
export type PhaseFailureClass =
  | 'build'
  | 'test'
  | 'lint'
  | 'edit_mismatch'
  | 'stale_read'
  | 'not_found'
  | 'timeout'
  | 'permission'
  | 'other';

export const DEFAULT_MAX_VERIFY_TO_ACT = 3;
/** Same-path read_file hits in Gather before forced Act. */
export const DEFAULT_GATHER_SAME_PATH_READS = 3;
/** Same failure class streak that triggers "doubt your hypothesis". */
export const DEFAULT_DIVERGENT_STREAK = 2;

export type PhaseTransitionState = {
  lastFailureClass: PhaseFailureClass | null;
  consecutiveSameClass: number;
  /** How many times we have bounced Verify → Act this run. */
  verifyToActRetries: number;
  /** Gather: normalized path → consecutive successful read_file count. */
  gatherReadByPath: Record<string, number>;
  gatherForcedAct: boolean;
};

export function emptyPhaseTransitionState(): PhaseTransitionState {
  return {
    lastFailureClass: null,
    consecutiveSameClass: 0,
    verifyToActRetries: 0,
    gatherReadByPath: {},
    gatherForcedAct: false,
  };
}

function normPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();
}

/**
 * Map tool outcome → phase failure class.
 * Prefer verify/terminal stderr cues (build/test/lint) over generic ToolErrorClass.
 */
export function classifyPhaseFailure(params: {
  toolName: string;
  status: 'success' | 'error' | 'rejected';
  content?: string | null;
}): PhaseFailureClass | null {
  if (params.status === 'success') return null;
  const text = (params.content ?? '').toLowerCase();
  const name = params.toolName;

  if (/\[stale_read\]|stale-read|changed since the last read/.test(text)) {
    return 'stale_read';
  }
  if (
    /\[edit_mismatch\]|\[path_gate\]|old_str|not found in file|ambiguous|uniquely match|failed to apply/.test(
      text,
    )
  ) {
    return 'edit_mismatch';
  }

  // Verify / shell oriented
  if (name === 'verify' || name === 'run_terminal' || name === 'await_terminal') {
    if (
      /\beslint\b|\bruff\b|\bprettier\b|\bpylint\b|lint error|lint failed/.test(
        text,
      )
    ) {
      return 'lint';
    }
    if (
      /\btsc\b|typecheck|type error|failed to compile|compilation error|webpack compiled with|vite.*error/.test(
        text,
      )
    ) {
      return 'build';
    }
    if (
      /\bpytest\b|\bvitest\b|\bjest\b|\bmocha\b|\bgo test\b|\bcargo test\b|failing tests|tests? failed|\d+ failed|\bfailures?\b/.test(
        text,
      )
    ) {
      return 'test';
    }
    if (/npm err!|error ts\d+|build failed|exit code [?:=]? ?[1-9]/.test(text)) {
      // Ambiguous shell failure — prefer build for compile-ish, else test if verify recipe
      if (name === 'verify') return 'test';
      return 'build';
    }
  }

  const base: ToolErrorClass = classifyToolError(
    params.status,
    params.content,
    name,
  );
  switch (base) {
    case 'edit_mismatch':
      return 'edit_mismatch';
    case 'not_found':
      return 'not_found';
    case 'timeout':
      return 'timeout';
    case 'permission':
      return 'permission';
    case 'syntax':
      return 'build';
    case 'rate_limit':
    case 'other':
    case 'none':
      return 'other';
  }
}

export function recordPhaseFailure(
  state: PhaseTransitionState,
  failureClass: PhaseFailureClass,
): {
  state: PhaseTransitionState;
  divergent: boolean;
  streak: number;
} {
  let consecutiveSameClass = 1;
  if (state.lastFailureClass === failureClass) {
    consecutiveSameClass = state.consecutiveSameClass + 1;
  }
  const next: PhaseTransitionState = {
    ...state,
    lastFailureClass: failureClass,
    consecutiveSameClass,
  };
  return {
    state: next,
    divergent: consecutiveSameClass >= DEFAULT_DIVERGENT_STREAK,
    streak: consecutiveSameClass,
  };
}

export function clearPhaseFailures(
  state: PhaseTransitionState,
): PhaseTransitionState {
  return {
    ...state,
    lastFailureClass: null,
    consecutiveSameClass: 0,
  };
}

/**
 * Track Gather read_file thrash on a single path.
 * Returns forceAct when the same path is read N times without clearing.
 */
export function recordGatherReadFile(
  state: PhaseTransitionState,
  path: string,
  opts?: { limit?: number },
): { state: PhaseTransitionState; forceAct: boolean; path: string; count: number } {
  const key = normPath(path);
  if (!key) {
    return { state, forceAct: false, path: key, count: 0 };
  }
  const limit = opts?.limit ?? DEFAULT_GATHER_SAME_PATH_READS;
  const count = (state.gatherReadByPath[key] ?? 0) + 1;
  const gatherReadByPath = { ...state.gatherReadByPath, [key]: count };
  const forceAct = count >= limit;
  return {
    state: {
      ...state,
      gatherReadByPath,
      gatherForcedAct: state.gatherForcedAct || forceAct,
    },
    forceAct,
    path: key,
    count,
  };
}

/** Successful mutation clears gather read streaks (exploration paid off). */
export function clearGatherReadStreaks(
  state: PhaseTransitionState,
): PhaseTransitionState {
  return {
    ...state,
    gatherReadByPath: {},
    gatherForcedAct: false,
  };
}

export function beginVerifyToActRetry(
  state: PhaseTransitionState,
  opts?: { max?: number },
): {
  state: PhaseTransitionState;
  allowed: boolean;
  retries: number;
  max: number;
} {
  const max = opts?.max ?? DEFAULT_MAX_VERIFY_TO_ACT;
  const retries = state.verifyToActRetries + 1;
  return {
    state: { ...state, verifyToActRetries: retries },
    allowed: retries <= max,
    retries,
    max,
  };
}

/** CoDD divergent: doubt the hypothesis after repeated same-class failure. */
export function buildDivergentNudge(
  failureClass: PhaseFailureClass,
  streak: number,
): string {
  return [
    `[divergent · ${failureClass} ×${streak}]`,
    'Your hypothesis itself is likely wrong — do not retry the same edit, command, or assumption.',
    'Re-read the failing evidence, form a NEW theory, and change strategy (different file, different test, or write_file rewrite for small files).',
  ].join('\n');
}

export function buildClassifiedVerifyToActPrompt(params: {
  failureClass: PhaseFailureClass;
  divergent: boolean;
  streak: number;
  retries: number;
  maxRetries: number;
  excerpt?: string;
}): string {
  const lines = [
    '[Phase transition: Verify → Act]',
    `Failure class: ${params.failureClass} (retry ${params.retries}/${params.maxRetries}).`,
    'Edit/fix tools are available again. Fix the failing checks, then stop so Verify can re-run.',
  ];
  switch (params.failureClass) {
    case 'test':
      lines.push('Focus on the failing assertion/test — do not broaden scope.');
      break;
    case 'lint':
      lines.push('Fix lint/format issues only; avoid unrelated refactors.');
      break;
    case 'build':
      lines.push('Fix compile/typecheck errors first; re-run the same check.');
      break;
    case 'edit_mismatch':
      lines.push(
        'Copy a NEW old_str from the file; do not reuse failed anchors.',
      );
      break;
    default:
      break;
  }
  if (params.divergent) {
    lines.push('', buildDivergentNudge(params.failureClass, params.streak));
  }
  const excerpt = params.excerpt?.trim();
  if (excerpt) {
    lines.push('', '## Failure excerpt', excerpt.slice(0, 1500));
  }
  return lines.join('\n');
}

export function buildGatherReadThrashPrompt(path: string, count: number): string {
  return [
    '[Phase transition: Gather → Act]',
    `Read thrash: \`${path}\` was read ${count} times without a mutation.`,
    'Exploration is looping. Write/edit tools are now available — act on what you know or ask_user if blocked.',
    'Do not re-read the same file unless the contents change.',
  ].join('\n');
}

export function buildVerifyRetryCapPrompt(max: number): string {
  return [
    `[Phase graph] Verify→Act retry budget exhausted (${max}/${max}).`,
    'Stop inventing fixes. Summarize what failed and call ask_user with a concrete choice, or end the turn with the failing evidence.',
  ].join('\n');
}

/** Extract a short path from read_file tool input. */
export function readFilePathFromInput(
  input: Record<string, unknown> | undefined | null,
): string | null {
  const p = input?.path ?? input?.file_path ?? input?.filePath;
  return typeof p === 'string' && p.trim() ? p.trim() : null;
}
