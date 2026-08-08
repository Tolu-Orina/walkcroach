/**
 * Phase 6 — durable-run progress / result contracts.
 *
 * Shared shapes for `content.publish` today and Phase 6b `graphs.run` tomorrow.
 * No GraphBuilder here — only typed progress + versioned results over the
 * existing poll / wait / onProgress path.
 */

/** Semver-ish product contract id for content.publish results. */
export const CONTENT_PUBLISH_CONTRACT_VERSION = 'content.publish/v1' as const;

export type ContentPublishContractVersion =
  typeof CONTENT_PUBLISH_CONTRACT_VERSION;

/** Phase 6b — public Run Graph DSL contract. */
export const GRAPH_RUN_CONTRACT_VERSION = 'graph.run/v1' as const;

export type GraphRunContractVersion = typeof GRAPH_RUN_CONTRACT_VERSION;

/**
 * Public CriticGate finding (stable subset — no harness package types).
 * Phase 6b graph runs reuse the same shape on critique nodes.
 */
export type CriticFinding = {
  checkId: string;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
  excerpt?: string;
};

/**
 * Progress event types the platform guarantees on durable runs.
 * Engine-internal noise (`token_delta`, `tool_card`, …) may still appear as
 * opaque `RunEvent.type` strings — use the helpers below to filter.
 */
export const RUN_PROGRESS_EVENT_TYPES = [
  // Lifecycle
  'started',
  'finished',
  'error',
  'interrupt',
  'resume',
  // Graph stages (Phase 3+)
  'stage.graph_started',
  'stage.started',
  'stage.checkpoint',
  'stage.completed',
  'stage.failed',
  'stage.paused',
  'stage.bound_hit',
  'stage.graph_completed',
  // Plan (Phase 5 / A1)
  'plan.auto_approved',
  'plan.approved',
  // CriticGate (Phase 4+)
  'critic.findings',
  'critic.enforcement',
  'critic.model_skipped',
  'critic.model_invoked',
] as const;

export type RunProgressEventType = (typeof RUN_PROGRESS_EVENT_TYPES)[number];

export type RunProgressEvent = {
  seq: number;
  at: string;
  type: RunProgressEventType;
  payload: Record<string, unknown>;
};

const PROGRESS_SET = new Set<string>(RUN_PROGRESS_EVENT_TYPES);

export function isRunProgressEventType(type: string): type is RunProgressEventType {
  return PROGRESS_SET.has(type);
}

export function isStageProgressEvent(type: string): boolean {
  return type === 'stage' || type.startsWith('stage.');
}

export function isCriticProgressEvent(type: string): boolean {
  return type.startsWith('critic.');
}

export function isPlanProgressEvent(type: string): boolean {
  return type === 'plan.auto_approved' || type === 'plan.approved';
}

/**
 * Plan approval policy for productized async runs.
 *
 * - `auto` (default): Plan stage auto-approves (A1). SDK / Lambda have no live
 *   HITL channel for plan review.
 * - `required`: **Not supported on content.publish/v1** — rejected at submit.
 *   Interactive plan gates live in the IDE. Reserved so Phase 6b / a future
 *   contract can grow an async HITL channel without renaming the field.
 */
export type PlanApprovalPolicy = 'auto' | 'required';
