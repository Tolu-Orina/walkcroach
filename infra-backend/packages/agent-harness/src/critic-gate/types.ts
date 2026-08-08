/**
 * Phase 4 — CriticGate types (ADR-D).
 *
 * Evaluation measures quality. Enforcement decides what the run does next
 * (pass / revise / fail). A score without an action is monitoring, not a gate.
 */

export type CriticSeverity = 'error' | 'warning';

export type CriticFinding = {
  checkId: string;
  rule: string;
  severity: CriticSeverity;
  message: string;
  path?: string;
  excerpt?: string;
};

export type CriticArtifact = {
  path: string;
  content: string;
};

export type CriticCheckContext = {
  artifacts: CriticArtifact[];
  /** Optional structured payload (JSON tool output, schema subject, …). */
  data?: unknown;
  meta?: Record<string, unknown>;
};

/** Tier 1 only in Phase 4 — deterministic, near-zero cost, 100% of outputs. */
export type CriticCheck = {
  id: string;
  tier: 1;
  run: (ctx: CriticCheckContext) => CriticFinding[] | Promise<CriticFinding[]>;
};

/**
 * Enforcement outcomes — what the agentic flow must do.
 * `revise` carries a prompt fragment for the Revise node / retry loop.
 */
export type CriticEnforcement =
  | { action: 'pass'; findings: CriticFinding[] }
  | {
      action: 'revise';
      findings: CriticFinding[];
      revisePrompt: string;
      errorFindings: CriticFinding[];
    }
  | {
      action: 'fail';
      findings: CriticFinding[];
      reason: string;
      errorFindings: CriticFinding[];
    };

export type CriticGateEvent =
  | { type: 'critic.findings'; findings: CriticFinding[] }
  | { type: 'critic.enforcement'; action: CriticEnforcement['action']; errorCount: number }
  | { type: 'critic.model_skipped'; reason: string }
  | {
      type: 'critic.model_invoked';
      tier: 2 | 3;
      id: string;
      findingCount: number;
    };

/** Tier 2/3 stub — Phase 7 only; must not run on the default path. */
export type ModelCriticRequest = {
  artifacts: CriticArtifact[];
  floorFindings: CriticFinding[];
  meta?: Record<string, unknown>;
};

export type ModelCriticResult = {
  findings: CriticFinding[];
  /** 0–1 confidence; informational until Phase 7 enforces. */
  confidence?: number;
};

export interface ModelCritic {
  readonly tier: 2 | 3;
  readonly id: string;
  critique(req: ModelCriticRequest): Promise<ModelCriticResult>;
}
