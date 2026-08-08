/**
 * Phase 3 — internal Graph orchestration capability (ADR-G).
 */
export { defineGraph, GraphDefinitionError } from './define.js';
export {
  MemoryGraphCheckpointer,
  emptyCheckpoint,
  type GraphCheckpointer,
  type CheckpointWriteResult,
} from './checkpointer.js';
export { CrdbGraphCheckpointer } from './crdb-checkpointer.js';
export { runGraph, checkpointSummary, type RunGraphParams } from './executor.js';
export { runGraphOnAgentRun } from './run-on-agent-run.js';
export {
  registerGraph,
  getGraph,
  listRegisteredGraphs,
  clearGraphRegistry,
} from './registry.js';
export {
  buildDummyCycleGraph,
  buildDummyLinearGraph,
  ensureDummyGraphsRegistered,
  type DummyCycleState,
  type DummyLinearState,
} from './dummy-graphs.js';
export {
  pruneStaleGraphCheckpoints,
  GRAPH_CHECKPOINT_RETENTION_DAYS,
  type PruneGraphCheckpointsResult,
} from './checkpoint-gc.js';
export type {
  GraphNodeKind,
  GraphState,
  GraphNodeContext,
  GraphNodeResult,
  GraphNodeDef,
  GraphEdgeDef,
  GraphDefinition,
  GraphCheckpoint,
  GraphRunOutcome,
} from './types.js';
export { GRAPH_END } from './types.js';

/** Phase 6b — public Run Graph DSL (ADR-I). */
export {
  GRAPH_RUN_CONTRACT_VERSION,
  PUBLIC_MAX_NODE_EXECUTIONS_CAP,
  PUBLIC_MAX_NODES,
  PUBLIC_MAX_EDGES,
  PUBLIC_EDGE_PREDICATES,
  PLATFORM_NODE_TYPES,
  PLATFORM_NODE_CATALOG,
  PLATFORM_PRESETS,
  BYO_FORBIDDEN_KEYS,
  listCatalogNodes,
  listPresets,
  validatePublicGraph,
  type PublicEdgePredicate,
  type PlatformNodeType,
  type PlatformPresetId,
  type CatalogNodeInfo,
  type PublicGraphNode,
  type PublicGraphEdge,
  type PublicGraphDefinition,
  type PublicGraphValidation,
} from './public-catalog.js';
export {
  compilePublicGraph,
  graphNeedsAgentRunner,
  type PublicGraphCompileDeps,
  type PublicGraphState,
} from './public-compile.js';
export { runPublicGraph, type PublicGraphRunResult } from './public-run.js';
export {
  buildSampleQualityGraph,
  SAMPLE_QUALITY_GRAPH_ID,
} from './sample-quality-graph.js';
