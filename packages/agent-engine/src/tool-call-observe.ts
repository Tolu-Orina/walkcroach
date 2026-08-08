/**
 * Phase 0 — log-only bounded-executor instrumentation.
 *
 * Records tool-call fingerprints in a sliding window and classifies failures.
 * Never refuses or nudges — Phase 1 enforcement consumes these measurements.
 *
 * See: docs/agentic-pattern-upgrade-implementation-plan.md (Phase 0).
 */

import { createHash } from 'node:crypto';
import { fingerprintToolCall } from './tool-loop-guard.js';
import type { TelemetrySink } from './telemetry.js';

/** OpenDev-aligned default window; Phase 0 may adjust before Phase 1 hardcodes. */
export const DEFAULT_OBSERVE_WINDOW = 20;

/** Probe thresholds for “would have halted” counters (OpenDev uses 3). */
export const PHASE0_HALT_PROBE_THRESHOLDS = [2, 3, 4] as const;

export type ToolErrorClass =
  | 'permission'
  | 'not_found'
  | 'edit_mismatch'
  | 'syntax'
  | 'rate_limit'
  | 'timeout'
  | 'other'
  | 'none';

export type ToolCallObserveEntry = {
  fingerprint: string;
  fingerprintShort: string;
  toolName: string;
  status: 'success' | 'error' | 'rejected';
  errorClass: ToolErrorClass;
  at: number;
};

export type ToolCallObserveTotals = {
  calls: number;
  byStatus: Record<'success' | 'error' | 'rejected', number>;
  byErrorClass: Record<ToolErrorClass, number>;
  /** How many times a fingerprint’s count-in-window reached each probe threshold. */
  wouldHaltHits: Record<'2' | '3' | '4', number>;
  /** Highest same-fingerprint count observed in any window snapshot. */
  maxRepeatSeen: number;
  /** Peak consecutive non-success streak (any fingerprint / class). */
  maxConsecutiveFailures: number;
  /** Peak consecutive failures sharing the same errorClass. */
  maxConsecutiveSameClass: number;
};

export type ToolCallObserveState = {
  windowSize: number;
  window: ToolCallObserveEntry[];
  consecutiveFailures: number;
  consecutiveSameClass: number;
  lastErrorClass: ToolErrorClass | null;
  totals: ToolCallObserveTotals;
};

export type ToolCallObservation = {
  toolName: string;
  fingerprintShort: string;
  status: 'success' | 'error' | 'rejected';
  errorClass: ToolErrorClass;
  /** Occurrences of this fingerprint in the window *after* this call. */
  countInWindow: number;
  consecutiveFailures: number;
  consecutiveSameClass: number;
  /** True when countInWindow >= threshold for each probe. */
  wouldHaltAt: Record<'2' | '3' | '4', boolean>;
};

function emptyTotals(): ToolCallObserveTotals {
  return {
    calls: 0,
    byStatus: { success: 0, error: 0, rejected: 0 },
    byErrorClass: {
      permission: 0,
      not_found: 0,
      edit_mismatch: 0,
      syntax: 0,
      rate_limit: 0,
      timeout: 0,
      other: 0,
      none: 0,
    },
    wouldHaltHits: { '2': 0, '3': 0, '4': 0 },
    maxRepeatSeen: 0,
    maxConsecutiveFailures: 0,
    maxConsecutiveSameClass: 0,
  };
}

export function emptyToolCallObserve(
  windowSize: number = DEFAULT_OBSERVE_WINDOW,
): ToolCallObserveState {
  return {
    windowSize: Math.max(1, windowSize),
    window: [],
    consecutiveFailures: 0,
    consecutiveSameClass: 0,
    lastErrorClass: null,
    totals: emptyTotals(),
  };
}

/** Short stable id for logs (full fingerprint stays in-window for counting). */
export function shortFingerprint(fingerprint: string): string {
  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
}

/**
 * Classify a tool failure from status + result text.
 * Order matters: more specific patterns before `other`.
 */
export function classifyToolError(
  status: 'success' | 'error' | 'rejected',
  content: string | undefined | null,
  toolName?: string,
): ToolErrorClass {
  if (status === 'success') return 'none';

  const text = (content ?? '').toLowerCase();
  const name = (toolName ?? '').toLowerCase();

  if (
    /eacces|eperm|permission denied|not allowed|read-only|unauthorized|forbidden|access denied|denied by policy/.test(
      text,
    )
  ) {
    return 'permission';
  }
  if (
    /etimedout|timed?\s*out|timeout|aborted|aborterror|deadline exceeded/.test(
      text,
    )
  ) {
    return 'timeout';
  }
  if (
    /rate.?limit|throttl|too many requests|\b429\b|quota.?exceed/.test(text)
  ) {
    return 'rate_limit';
  }
  if (
    /enoent|no such file|no such directory|does not exist|cannot find module|cannot find package|path does not exist/.test(
      text,
    )
  ) {
    return 'not_found';
  }
  if (
    /\[stale_read\]|\[edit_mismatch\]|stale-read|changed since the last read|old_str|old_string|exact match|not found in file|ambiguous|no occurrence|edit failed|failed to apply|multiple matches|uniquely match/.test(
      text,
    )
  ) {
    return 'edit_mismatch';
  }
  if (
    /syntaxerror|syntax error|parse error|unexpected token|unexpected end|\bts\d{4}\b|eslint|failed to compile|type error/.test(
      text,
    )
  ) {
    return 'syntax';
  }
  // Edit tools with unclassified errors are usually content-mismatch, not path miss
  if (name === 'edit_file' || name === 'apply_patch') {
    return 'edit_mismatch';
  }
  return 'other';
}

function countFingerprintInWindow(
  window: ToolCallObserveEntry[],
  fingerprint: string,
): number {
  let n = 0;
  for (const e of window) {
    if (e.fingerprint === fingerprint) n += 1;
  }
  return n;
}

/**
 * Record one tool outcome. Pure state transition — never blocks execution.
 */
export function recordToolCallObservation(
  state: ToolCallObserveState,
  params: {
    toolName: string;
    input: Record<string, unknown> | undefined | null;
    status: 'success' | 'error' | 'rejected';
    content?: string | null;
    at?: number;
  },
): { state: ToolCallObserveState; observation: ToolCallObservation } {
  const fingerprint = fingerprintToolCall(params.toolName, params.input);
  const fingerprintShort = shortFingerprint(fingerprint);
  const errorClass = classifyToolError(
    params.status,
    params.content,
    params.toolName,
  );
  const at = params.at ?? Date.now();

  const entry: ToolCallObserveEntry = {
    fingerprint,
    fingerprintShort,
    toolName: params.toolName,
    status: params.status,
    errorClass,
    at,
  };

  const window = [...state.window, entry];
  while (window.length > state.windowSize) window.shift();

  let consecutiveFailures = state.consecutiveFailures;
  let consecutiveSameClass = state.consecutiveSameClass;
  let lastErrorClass = state.lastErrorClass;

  if (params.status === 'success') {
    consecutiveFailures = 0;
    consecutiveSameClass = 0;
    lastErrorClass = null;
  } else {
    consecutiveFailures += 1;
    if (lastErrorClass === errorClass) {
      consecutiveSameClass += 1;
    } else {
      consecutiveSameClass = 1;
      lastErrorClass = errorClass;
    }
  }

  const countInWindow = countFingerprintInWindow(window, fingerprint);
  const wouldHaltAt = {
    '2': countInWindow >= 2,
    '3': countInWindow >= 3,
    '4': countInWindow >= 4,
  } as const;

  const totals: ToolCallObserveTotals = {
    ...state.totals,
    calls: state.totals.calls + 1,
    byStatus: {
      ...state.totals.byStatus,
      [params.status]: state.totals.byStatus[params.status] + 1,
    },
    byErrorClass: {
      ...state.totals.byErrorClass,
      [errorClass]: state.totals.byErrorClass[errorClass] + 1,
    },
    wouldHaltHits: { ...state.totals.wouldHaltHits },
    maxRepeatSeen: Math.max(state.totals.maxRepeatSeen, countInWindow),
    maxConsecutiveFailures: Math.max(
      state.totals.maxConsecutiveFailures,
      consecutiveFailures,
    ),
    maxConsecutiveSameClass: Math.max(
      state.totals.maxConsecutiveSameClass,
      consecutiveSameClass,
    ),
  };

  for (const t of PHASE0_HALT_PROBE_THRESHOLDS) {
    const key = String(t) as '2' | '3' | '4';
    // Count the crossing edge once (exactly at threshold) to avoid triple-counting every later repeat
    if (countInWindow === t) {
      totals.wouldHaltHits[key] += 1;
    }
  }

  const next: ToolCallObserveState = {
    windowSize: state.windowSize,
    window,
    consecutiveFailures,
    consecutiveSameClass,
    lastErrorClass,
    totals,
  };

  const observation: ToolCallObservation = {
    toolName: params.toolName,
    fingerprintShort,
    status: params.status,
    errorClass,
    countInWindow,
    consecutiveFailures,
    consecutiveSameClass,
    wouldHaltAt: { ...wouldHaltAt },
  };

  return { state: next, observation };
}

/** Compact summary for Phase 0 data reports / session_complete. */
export function summarizeToolCallObserve(
  state: ToolCallObserveState,
): Record<string, string | number | boolean> {
  const t = state.totals;
  return {
    phase: 0,
    observe_window: state.windowSize,
    calls: t.calls,
    success: t.byStatus.success,
    error: t.byStatus.error,
    rejected: t.byStatus.rejected,
    err_permission: t.byErrorClass.permission,
    err_not_found: t.byErrorClass.not_found,
    err_edit_mismatch: t.byErrorClass.edit_mismatch,
    err_syntax: t.byErrorClass.syntax,
    err_rate_limit: t.byErrorClass.rate_limit,
    err_timeout: t.byErrorClass.timeout,
    err_other: t.byErrorClass.other,
    would_halt_2: t.wouldHaltHits['2'],
    would_halt_3: t.wouldHaltHits['3'],
    would_halt_4: t.wouldHaltHits['4'],
    max_repeat_seen: t.maxRepeatSeen,
    max_consecutive_failures: t.maxConsecutiveFailures,
    max_consecutive_same_class: t.maxConsecutiveSameClass,
    /** True if OpenDev’s default (3-in-20) would have fired at least once. */
    open_dev_default_would_fire: t.wouldHaltHits['3'] > 0,
  };
}

/** Emit per-call + keep sink events host-forwardable (OTLP / EMF). */
export function emitToolCallObservation(
  telemetry: TelemetrySink,
  observation: ToolCallObservation,
): void {
  telemetry.emit('walkcroach.tool_call.observe', {
    'walkcroach.tool.name': observation.toolName,
    'walkcroach.tool.fingerprint': observation.fingerprintShort,
    'walkcroach.tool.status': observation.status,
    'walkcroach.tool.error_class': observation.errorClass,
    'walkcroach.tool.count_in_window': observation.countInWindow,
    'walkcroach.tool.consecutive_failures': observation.consecutiveFailures,
    'walkcroach.tool.consecutive_same_class': observation.consecutiveSameClass,
    'walkcroach.tool.would_halt_2': observation.wouldHaltAt['2'],
    'walkcroach.tool.would_halt_3': observation.wouldHaltAt['3'],
    'walkcroach.tool.would_halt_4': observation.wouldHaltAt['4'],
    'walkcroach.phase': 0,
    'walkcroach.observe_only': true,
  });
}

export function emitToolCallObserveSummary(
  telemetry: TelemetrySink,
  state: ToolCallObserveState,
): Record<string, string | number | boolean> {
  const summary = summarizeToolCallObserve(state);
  telemetry.emit('walkcroach.tool_call.observe_summary', summary);
  return summary;
}
