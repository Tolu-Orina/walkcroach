/**
 * Phase 4 — Deterministic CriticGate (ADR-D).
 */
export {
  runCriticGate,
  isCriticBlocked,
  type RunCriticGateParams,
} from './gate.js';
export {
  createOutputRedFlagCheck,
  createForbiddenImportCheck,
  createJsonObjectSchemaCheck,
  createMinArtifactsCheck,
  defaultPublishCriticChecks,
} from './checks.js';
export {
  createTier2ModelCriticStub,
  createTier3ModelCriticStub,
  ModelCriticNotEnabledError,
} from './model-stub.js';
export {
  createTier2HeuristicModelCritic,
  createTier3LlmModelCritic,
  isModelCriticEnabledFromEnv,
  resolveModelCriticFromEnv,
  TIER3_MAX_ARTIFACT_CHARS,
  TIER3_MAX_FINDINGS,
  type Tier3Invoke,
} from './model-critic.js';
export {
  createCriticGateGraphNode,
  type CriticGateGraphState,
} from './graph-node.js';
export type {
  CriticSeverity,
  CriticFinding,
  CriticArtifact,
  CriticCheckContext,
  CriticCheck,
  CriticEnforcement,
  CriticGateEvent,
  ModelCriticRequest,
  ModelCriticResult,
  ModelCritic,
} from './types.js';
