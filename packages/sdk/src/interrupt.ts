/**
 * LangGraph-inspired interrupt vocabulary for durable runs (Pre–Phase 6).
 *
 * Not a LangGraph dependency — only the public shapes:
 *   threadId  ≈ run id (content) or harness session id (documented alias)
 *   interrupt ≈ pause with a typed payload
 *   resume    ≈ continue with a value for that interrupt id
 *
 * Harness session pauses (`awaiting_tool`, `awaiting_plan_approval`) map to
 * InterruptKind values below; they stay on their own state machine until a
 * later ADR unifies persistence.
 */

export type InterruptKind =
  | 'ask_user'
  | 'tool_result'
  | 'plan_decision'
  | 'approval';

/** Mapping from harness pause states → InterruptKind (docs + future bridge). */
export const HARNESS_PAUSE_TO_INTERRUPT: Record<string, InterruptKind> = {
  awaiting_tool: 'tool_result',
  awaiting_plan_approval: 'plan_decision',
};

export type RunInterrupt = {
  /** Stable id for this pause; required on resume. */
  id: string;
  kind: InterruptKind;
  /** Kind-specific payload (e.g. question + options for ask_user). */
  payload: Record<string, unknown>;
  createdAt: string;
};

export type ResumeRequest = {
  interruptId: string;
  /** Answer / approval / tool result — JSON-serializable. */
  value: unknown;
};

export function createAskUserInterrupt(params: {
  question: string;
  options?: string[];
  id?: string;
  createdAt?: string;
}): RunInterrupt {
  return {
    id: params.id ?? cryptoRandomId(),
    kind: 'ask_user',
    payload: {
      question: params.question,
      options: params.options ?? [],
    },
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

/** Prefer Web Crypto; fall back for older Node. */
function cryptoRandomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `int_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
