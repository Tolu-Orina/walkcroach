/**
 * Phase 1 — bounded executor enforcement (OpenDev-shaped).
 *
 * Educated Phase 0 defaults (no live traffic yet — from OpenDev + existing
 * tool-loop-guard tests + happy-path reasoning):
 * - Window 20 / threshold 3: OpenDev production; our tests already use 3 for
 *   consecutive failure. Happy-path fix-test loops change args → different
 *   fingerprints → low FP. Re-reading the same file 3× in 20 calls is the
 *   main FP risk (one-shot Allow mitigates).
 * - Nudge budget 3: distinct from thrash (changing failing cmds); matches
 *   OpenDev error-recovery cap.
 * - Any-status thrash: successful identical repeats are still loops
 *   (OpenDev correction vs failure-only).
 *
 * Two-tier thrash: warn_skip → escalate (interactive Allow/Break or
 * fail-closed). Never relies on the model obeying text alone for the halt.
 */

import { fingerprintToolCall } from './tool-loop-guard.js';
import {
  classifyToolError,
  type ToolErrorClass,
} from './tool-call-observe.js';

export const DEFAULT_THRASH_WINDOW = 20;
export const DEFAULT_THRASH_THRESHOLD = 3;
export const DEFAULT_NUDGE_BUDGET = 3;

/** Why these constants without a Phase 0 field report. */
export const PHASE1_DEFAULTS_RATIONALE = {
  window: DEFAULT_THRASH_WINDOW,
  threshold: DEFAULT_THRASH_THRESHOLD,
  nudgeBudget: DEFAULT_NUDGE_BUDGET,
  basis:
    'OpenDev arXiv:2603.05344 doom-loop (window=20, any-repeat≥3, two-tier) + existing WalkCroach DEFAULT_IDENTICAL_FAILURE_LIMIT=3 tests; nudge budget=3 for consecutive failure sequences. Revisit after Phase 0 observe_summary aggregation.',
} as const;

export type BoundedExecutorConfig = {
  enabled: boolean;
  windowSize: number;
  thrashThreshold: number;
  nudgeBudget: number;
  /** When true, thrash escalate uses askUser Allow/Break. When false, fail-closed. */
  interactive: boolean;
};

export function resolveBoundedExecutorConfig(
  raw?: Partial<BoundedExecutorConfig> | null,
): BoundedExecutorConfig {
  return {
    enabled: raw?.enabled ?? true,
    windowSize: raw?.windowSize ?? DEFAULT_THRASH_WINDOW,
    thrashThreshold: raw?.thrashThreshold ?? DEFAULT_THRASH_THRESHOLD,
    nudgeBudget: raw?.nudgeBudget ?? DEFAULT_NUDGE_BUDGET,
    interactive: raw?.interactive ?? true,
  };
}

export type BoundedExecutorState = {
  windowSize: number;
  threshold: number;
  nudgeBudget: number;
  /** Recent fingerprints (sliding). */
  window: string[];
  /** Fingerprints that already received warn_skip. */
  warned: Set<string>;
  /** Allow-once after interactive Allow. */
  oneShot: Set<string>;
  consecutiveFailures: number;
  consecutiveSameClass: number;
  lastErrorClass: ToolErrorClass | null;
};

export function emptyBoundedExecutorState(
  cfg: Pick<BoundedExecutorConfig, 'windowSize' | 'thrashThreshold' | 'nudgeBudget'>,
): BoundedExecutorState {
  return {
    windowSize: Math.max(1, cfg.windowSize),
    threshold: Math.max(1, cfg.thrashThreshold),
    nudgeBudget: Math.max(1, cfg.nudgeBudget),
    window: [],
    warned: new Set(),
    oneShot: new Set(),
    consecutiveFailures: 0,
    consecutiveSameClass: 0,
    lastErrorClass: null,
  };
}

function countInWindow(window: string[], fp: string): number {
  let n = 0;
  for (const x of window) if (x === fp) n += 1;
  return n;
}

function pushWindow(state: BoundedExecutorState, fp: string): BoundedExecutorState {
  const window = [...state.window, fp];
  while (window.length > state.windowSize) window.shift();
  return { ...state, window };
}

export type ThrashBeforeDecision =
  | { action: 'allow'; state: BoundedExecutorState; fingerprint: string }
  | {
      action: 'warn_skip';
      state: BoundedExecutorState;
      fingerprint: string;
      message: string;
    }
  | {
      action: 'escalate';
      state: BoundedExecutorState;
      fingerprint: string;
      message: string;
    };

/**
 * Call before executing a tool. May skip or escalate; never executes here.
 */
export function beforeBoundedToolCall(
  state: BoundedExecutorState,
  toolName: string,
  input: Record<string, unknown> | undefined | null,
): ThrashBeforeDecision {
  const fingerprint = fingerprintToolCall(toolName, input);

  if (state.oneShot.has(fingerprint)) {
    const oneShot = new Set(state.oneShot);
    oneShot.delete(fingerprint);
    return {
      action: 'allow',
      fingerprint,
      state: { ...state, oneShot },
    };
  }

  const prior = countInWindow(state.window, fingerprint);
  // About to be the (prior+1)-th occurrence if we record after; halt when
  // this call would make count >= threshold (i.e. prior >= threshold-1... 
  // OpenDev: if any fingerprint recurs 3+ times in window. So when prior >= 3
  // before this call, we're at 4th attempt? Or when prior >= 2 we're about to do 3rd?
  // "If any fingerprint recurs 3 or more times" = count in window including
  // current attempt >= 3. So when prior is 2, this is the 3rd → trigger.
  const countIfTaken = prior + 1;

  if (countIfTaken >= state.threshold) {
    if (!state.warned.has(fingerprint)) {
      const warned = new Set(state.warned);
      warned.add(fingerprint);
      const next = pushWindow({ ...state, warned }, fingerprint);
      return {
        action: 'warn_skip',
        fingerprint,
        state: next,
        message: [
          `[SYSTEM WARNING] Identical tool call repeated ${countIfTaken}× in the last ${state.windowSize} calls (${toolName}).`,
          'Execution skipped this turn. Do not retry the same tool with the same arguments.',
          'Change approach, or the next identical call will require approval / halt.',
          `Fingerprint streak threshold=${state.threshold}.`,
        ].join(' '),
      };
    }

    // Already warned — escalate (do not push yet; Allow may execute)
    return {
      action: 'escalate',
      fingerprint,
      state,
      message: [
        `Agent is repeating the same action (${toolName}) after a thrash warning.`,
        'Allow once to proceed with this exact call, or Break to stop the loop.',
      ].join(' '),
    };
  }

  return { action: 'allow', fingerprint, state };
}

/** After a successful Allow: arm one-shot then caller re-enters beforeBounded or executes. */
export function armThrashOneShot(
  state: BoundedExecutorState,
  fingerprint: string,
): BoundedExecutorState {
  const oneShot = new Set(state.oneShot);
  oneShot.add(fingerprint);
  const warned = new Set(state.warned);
  warned.delete(fingerprint);
  return { ...state, oneShot, warned };
}

/** After Break: clear thrash marks for this fingerprint and record the attempt. */
export function breakThrashLoop(
  state: BoundedExecutorState,
  fingerprint: string,
): BoundedExecutorState {
  const warned = new Set(state.warned);
  warned.delete(fingerprint);
  const oneShot = new Set(state.oneShot);
  oneShot.delete(fingerprint);
  return pushWindow({ ...state, warned, oneShot }, fingerprint);
}

/** Record fingerprint after an allowed execution (or non-interactive refuse). */
export function recordThrashExecution(
  state: BoundedExecutorState,
  fingerprint: string,
): BoundedExecutorState {
  return pushWindow(state, fingerprint);
}

export type NudgeAfterResult = {
  state: BoundedExecutorState;
  /** Appended into tool result so the model sees a classified recovery hint. */
  recoveryHint?: string;
  /** True when consecutive failure budget is exhausted. */
  budgetExhausted: boolean;
};

/**
 * Update consecutive-failure nudge budget after a tool result.
 * Distinct from thrash (changing fingerprints that keep failing).
 */
export function afterBoundedToolResult(
  state: BoundedExecutorState,
  params: {
    toolName: string;
    status: 'success' | 'error' | 'rejected';
    content?: string | null;
  },
): NudgeAfterResult {
  if (params.status === 'success') {
    return {
      state: {
        ...state,
        consecutiveFailures: 0,
        consecutiveSameClass: 0,
        lastErrorClass: null,
      },
      budgetExhausted: false,
    };
  }

  const errorClass = classifyToolError(
    params.status,
    params.content,
    params.toolName,
  );
  let consecutiveSameClass = 1;
  if (state.lastErrorClass === errorClass) {
    consecutiveSameClass = state.consecutiveSameClass + 1;
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  const next: BoundedExecutorState = {
    ...state,
    consecutiveFailures,
    consecutiveSameClass,
    lastErrorClass: errorClass,
  };

  const budgetExhausted = consecutiveFailures >= state.nudgeBudget;
  const recoveryHint = budgetExhausted
    ? undefined
    : recoveryHintForClass(errorClass, params.toolName, consecutiveFailures, state.nudgeBudget);

  return { state: next, recoveryHint, budgetExhausted };
}

export function recoveryHintForClass(
  errorClass: ToolErrorClass,
  toolName: string,
  attempt: number,
  budget: number,
): string {
  const prefix = `[recovery ${attempt}/${budget} · ${errorClass}]`;
  switch (errorClass) {
    case 'permission':
      return `${prefix} Permission/policy blocked \`${toolName}\`. Do not retry identically — use a permitted path, request approval, or ask_user.`;
    case 'not_found':
      return `${prefix} Missing path/resource. List/search to locate the real path, then retry with corrected arguments.`;
    case 'edit_mismatch':
      return `${prefix} Edit/stale mismatch. Re-read the file first; widen old_str with 3–5 unique surrounding lines (do not guess indentation); prefer apply_patch for multi-site. Do not retry the identical old_str.`;
    case 'syntax':
      return `${prefix} Syntax/parse failure. Re-read the file, fix the specific error, then verify.`;
    case 'rate_limit':
      return `${prefix} Rate limited. Back off — do not tight-loop the same call; wait or switch approach.`;
    case 'timeout':
      return `${prefix} Timed out. Narrow the command, raise timeout only if justified, or split the work.`;
    case 'other':
      return `${prefix} Tool failed. Diagnose from stderr/output; change arguments or strategy before retrying.`;
    case 'none':
      return '';
  }
}

export function nudgeBudgetExhaustedMessage(
  state: BoundedExecutorState,
  toolName: string,
): string {
  return [
    `[SYSTEM] Error-recovery budget exhausted (${state.consecutiveFailures}/${state.nudgeBudget}`,
    state.lastErrorClass ? ` · class=${state.lastErrorClass}` : '',
    `) after consecutive failures ending at \`${toolName}\`.`,
    'Stopping automatic retries. Change strategy substantially or ask the user.',
  ].join('');
}
