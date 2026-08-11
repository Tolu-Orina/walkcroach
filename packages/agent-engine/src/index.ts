export type {
  AgentEvent,
  ApprovalDecision,
  ApprovalRequest,
  BackgroundTerminalPoll,
  BackgroundTerminalStart,
  HostAdapter,
  HostSecrets,
  SearchHit,
  TerminalChunk,
  UserQuestionAnswer,
  RunTerminalOpts,
} from './host.js';

export {
  InteractiveSessionRegistry,
  loadPtyModule,
  resetPtyModuleCache,
  splitCommandLine,
  MAX_SESSIONS,
  MAX_SESSION_BUFFER_CHARS,
  DEFAULT_SETTLE_MS,
  DEFAULT_READ_TIMEOUT_MS,
  type SessionBackend,
  type SessionStatus,
  type SessionInfo,
  type SessionReadResult,
} from './pty-session.js';
export { killProcessTree } from './process-kill.js';
export { streamShellCommand, buildStdinPayload, MAX_STDIN_CHARS, MAX_STDIN_REPLIES } from './stream-shell.js';
export {
  detectConfirmPrompt,
  looksLikePasswordPrompt,
  CONFIRM_IDLE_MS,
  MAX_CONFIRM_PROMPTS,
  CONFIRM_PROMPT_PATTERNS,
  type ConfirmPromptAnswer,
  type ConfirmPromptRequest,
  type DetectedConfirmPrompt,
} from './terminal-prompts.js';
export {
  BackgroundTerminalRegistry,
  type BackgroundTaskInfo,
  type BackgroundTaskStatus,
} from './background-terminals.js';
export {
  persistTodos,
  loadPersistedTodos,
  clearPersistedTodos,
  TODOS_REL_PATH,
  WALK_CROACH_DIR,
} from './session-fs.js';
export {
  persistAgentSession,
  loadAgentSession,
  clearActiveAgentSession,
  readActiveSessionPointer,
  newSessionId,
  SESSIONS_REL_DIR,
  ACTIVE_SESSION_REL,
  type AgentSessionSnapshot,
  type ActiveSessionPointer,
} from './session-store.js';
export {
  enterGitWorktree,
  exitGitWorktree,
  type WorktreeEnterResult,
  type WorktreeExitResult,
} from './worktree.js';
export {
  parseHooksConfig,
  runPostToolUseHooks,
  runStopHooks,
  buildStopHookNudgePrompt,
  hookMatches,
  assertHookCommandSafe,
  defaultHooksConfig,
  type HooksConfig,
  type HookDef,
  type PostToolUseHook,
  type StopHook,
  type PostToolUsePayload,
  type StopHookPayload,
  type StopHookResult,
} from './hooks.js';
export {
  loadWorkspaceAgentConfig,
  loadRuleBody,
  parseRuleFrontmatter,
  formatRuleCatalog,
  loadMcpServersConfig,
  parseMcpServersJson,
  parseSettingsJson,
  parseVerifyJson,
  isVerifyCommand,
  isBackgroundAllowed,
  matchesDenyPattern,
  matchesGlob,
  defaultSettings,
  SETTINGS_REL_PATH,
  VERIFY_REL_PATH,
  RULES_REL_DIR,
  MCP_CONFIG_REL_PATH,
  type WalkcroachSettings,
  type VerifyConfig,
  type WorkspaceAgentConfig,
  type RuleFrontmatter,
  type RuleCatalogEntry,
  type McpServerFileConfig,
} from './workspace-config.js';
export { WorkspacePolicy } from './workspace-policy.js';
export {
  recordCheckpoint,
  revertTurn,
  CHECKPOINTS_REL_DIR,
  DEFAULT_MAX_CHECKPOINT_TURNS,
  type CheckpointEntry,
} from './checkpoints.js';

export type { Message as BedrockMessage } from '@aws-sdk/client-bedrock-runtime';

export type { AutonomyLevel } from './approvals.js';
export {
  isInfraCommand,
  isCriticalCommand,
  isLowFrictionEditEligible,
  isLowFrictionPatchEligible,
  isSensitivePath,
  shouldAutoApprove,
  canNonInteractiveApprove,
} from './approvals.js';

export {
  HOST_TO_WEBVIEW,
  WEBVIEW_TO_HOST,
  isWebviewToHostType,
  parseWebviewToHostMessage,
  type HostToWebviewMessage,
  type HostToWebviewType,
  type WebviewToHostMessage,
  type WebviewToHostType,
  type SubmitAttachment,
  type PersistedChatTurn,
  type McpServerView,
  parsePersistedChatTurns,
} from './protocol.js';
export {
  attachmentsToContentBlocks,
  redactAttachmentBlocks,
  sanitizeDocumentName,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from './attachments.js';

export { TokenDeltaCoalescer, type CoalesceFlush } from './coalesce.js';

export {
  createBedrockClient,
  getNovaModelId,
  getNovaReasoningEffort,
  resolveNovaReasoningEffort,
  getTitanEmbedModelId,
  getBedrockRegion,
  normalizeBedrockApiKey,
  formatBedrockAuthError,
  embedText,
  streamConverseTurn,
  streamPing,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_REASONING_OUTPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS,
  type ConverseTurnResult,
  type ParsedToolUse,
  type StreamDelta,
  type NovaReasoningEffort,
} from './bedrock.js';
export {
  isOpaqueReasoningText,
  stripOpaqueReasoningMarkers,
} from './reasoning-text.js';
export {
  updateIndex,
  semanticSearch,
  chunkLines,
  cosineSimilarity,
  INDEX_REL_DIR,
  MANIFEST_REL_PATH,
  VECTORS_REL_PATH,
  DEFAULT_CHUNK_WINDOW_LINES,
  DEFAULT_CHUNK_OVERLAP_LINES,
  DEFAULT_MAX_INDEX_FILES,
  MAX_INDEXABLE_FILE_BYTES,
  DEFAULT_SEMANTIC_SEARCH_TOP_K,
  type EmbedFn,
  type IndexChunkRecord,
  type SemanticSearchHit,
  type UpdateIndexResult,
} from './local-index.js';

export {
  runAgentLoop,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_SUBAGENTS,
  DEFAULT_IDENTICAL_FAILURE_LIMIT,
  MAX_TODO_WRITE_NUDGES,
  MAX_TODO_PROGRESS_NUDGES,
  MAX_VERIFY_REVIEWS,
  MAX_STOP_HOOK_NUDGES,
  REVIEW_OK_MARKER,
  PARALLEL_SAFE_TOOLS,
  CONTINUE_PROMPT,
  ACT_NUDGE_PROMPT,
  buildVerifyNudgePrompt,
  buildVerifyReviewPrompt,
  isReviewOk,
  type LoopPhase,
  type RunLoopParams,
} from './loop.js';

export {
  fingerprintToolCall,
  softNormalizeEditAnchor,
  beforeToolCall,
  afterToolResult,
  emptyToolLoopGuard,
  buildStuckLoopNudge,
  identicalFailureLimitFor,
  isLoopSensitiveTool,
  type ToolLoopGuardState,
} from './tool-loop-guard.js';

export {
  createEditAnchorFailCache,
  assertEditAnchorAllowed,
  recordEditAnchorFailure,
  clearEditAnchorsForPath,
  type EditAnchorFailCache,
} from './edit-anchor-guard.js';

export {
  DEFAULT_PATH_MISMATCH_LIMIT,
  SMALL_FILE_LINE_LIMIT,
  SMALL_FILE_PATH_MISMATCH_LIMIT,
  createEditPathMismatchState,
  recordPathEditMismatch,
  clearPathEditMismatches,
  assertPathEditAllowed,
  pathMismatchGateMessage,
  countFileLines,
  isSmallFileForRewrite,
  type EditPathMismatchState,
  type PathMismatchRecord,
} from './edit-path-mismatch-guard.js';

export {
  DEFAULT_NEAREST_TOP_K,
  DEFAULT_NEAREST_MIN_SCORE,
  findNearestAnchors,
  formatNearestAnchorHints,
  normalizeAnchorText,
  levenshteinRatio,
  type NearestAnchorCandidate,
} from './nearest-anchor.js';

export {
  DEFAULT_OBSERVE_WINDOW,
  PHASE0_HALT_PROBE_THRESHOLDS,
  emptyToolCallObserve,
  classifyToolError,
  recordToolCallObservation,
  summarizeToolCallObserve,
  shortFingerprint,
  type ToolErrorClass,
  type ToolCallObserveState,
  type ToolCallObservation,
  type ToolCallObserveTotals,
} from './tool-call-observe.js';

export {
  DEFAULT_THRASH_WINDOW,
  DEFAULT_THRASH_THRESHOLD,
  DEFAULT_NUDGE_BUDGET,
  PHASE1_DEFAULTS_RATIONALE,
  resolveBoundedExecutorConfig,
  emptyBoundedExecutorState,
  beforeBoundedToolCall,
  afterBoundedToolResult,
  armThrashOneShot,
  breakThrashLoop,
  recordThrashExecution,
  type BoundedExecutorConfig,
  type BoundedExecutorState,
} from './bounded-executor.js';

export {
  DEFAULT_MTIME_TOLERANCE_MS,
  FRESHNESS_EXCERPT_MAX_CHARS,
  createReadFreshnessTracker,
  recordReadFreshness,
  hashFileContent,
  assertFreshForWrite,
  evaluateMutationFreshness,
  formatFreshnessExcerpt,
  formatEditMismatchError,
  type ReadFreshnessTracker,
  type FreshnessSnapshot,
  type MutationKind,
} from './read-freshness.js';

export {
  PLANNER_TOOL_ALLOWLIST,
  PLANNER_FORBIDDEN_TOOLS,
  PLAN_SECTION_HEADINGS,
  PLANNER_SYSTEM_PROMPT,
  assertPlannerSchemaHasNoWriteTools,
  validatePlanArtifact,
  looksLikePlanningTask,
  isPlannerSpawnName,
  buildPlannerUserPrompt,
  formatApprovedPlanBlock,
} from './planner.js';

export {
  ApprovalController,
  FleetApprovalRouter,
  bindApprovals,
  type ApprovalControllerOptions,
} from './approval-controller.js';
export { createFakeHost } from './fake-host.js';
export { truncateText, DEFAULT_TOOL_RESULT_MAX_CHARS } from './truncate.js';
export {
  validateToolInput,
  dispatchTool,
  observeToolResult,
} from './tools/dispatch.js';
export {
  DEFAULT_WORKTREE_POLICY,
  FLEET_ISOLATION_POLICY,
  resolveWorktreePolicy,
  planFirstWriteIsolation,
  type IsolationMode,
  type CollisionMode,
  type WorktreeIsolationPolicy,
  type IsolationPlan,
} from './worktree-policy.js';
export {
  assembleSystemBlocks,
  buildUserTurn,
  buildFollowUpTurn,
  looksLikeActionTask,
  shouldTreatAsActionTask,
  AGENT_SYSTEM_PROMPT,
  type ActionBias,
} from './prompt.js';
export {
  compactSessionMessages,
  summarizeDroppedMessages,
  DEFAULT_COMPACT_THRESHOLD,
  DEFAULT_COMPACT_KEEP_RECENT,
} from './compact.js';
export {
  applyPatchEdits,
  applyDiffString,
  normalizePatchEdits,
  applyUniqueReplace,
  findUniqueOldStrSpan,
  oldStrMatchesUniquely,
  type PatchEdit,
  type MatchStrategy,
  type UniqueMatch,
} from './patch.js';
export {
  normalizeTodos,
  formatTodosForModel,
  formatTodosChecklistBlock,
  hasOpenTodos,
  needsTodoWriteNudge,
  needsTodoProgressNudge,
  buildTodoWriteNudgePrompt,
  buildTodoProgressNudgePrompt,
  TODO_WRITE_MIN,
  TODO_WRITE_MAX,
  type AgentTodo,
  type AgentTodoStatus,
} from './todos.js';
export { HARD_VERIFY_EXTRA } from './workspace-policy.js';
export {
  trimSessionMessages,
  cloneMessages,
  appendUserFollowUp,
  sanitizeConverseMessages,
  DEFAULT_MAX_SESSION_MESSAGES,
} from './session.js';
export {
  readWalkcroachMd,
  mergeWalkcroachAppend,
  WALKCROACH_MD,
} from './memory-local.js';
export {
  PHASE_A_TOOLS,
  PHASE_B_TOOLS,
  PHASE_C_TOOLS,
  ALL_TOOLS,
  toBedrockTools,
  getToolDef,
} from './tools/defs.js';
export { executeTool } from './tools/execute.js';

export {
  CockroachMcpClient,
  GenericMcpClient,
  McpServerRegistry,
  DEFAULT_MCP_URL,
  RESERVED_COCKROACHDB_SERVER_NAME,
  isMcpWriteTool,
  parseMcpConfigSnippet,
  plainMcpError,
  type McpConfig,
  type McpToolInfo,
  type McpServerConfig,
  type McpClientLike,
} from './mcp.js';
export {
  runCcloud,
  ccloudHelp,
  ensureJsonOutput,
  isCcloudInfraAction,
  plainCcloudError,
  type CcloudRunResult,
} from './ccloud.js';
export {
  StdioMcpClient,
  StdioMcpSupervisor,
  registerConfiguredMcpServers,
  describeConfiguredMcpServers,
  resolveStdioCommand,
  buildStdioEnv,
  isDeniedEnvName,
  stdioServerFingerprint,
  STDIO_CONSENT_KEY,
  readStdioConsents,
  recordStdioConsent,
  revokeStdioConsent,
  type StdioConsentRecord,
  describeStdioServer,
  qualifyToolName,
  isValidMcpServerName,
  StdioCommandError,
  TOOL_NAMESPACE_SEP,
  type McpStdioServerConfig,
  type StdioSpawnParams,
} from './mcp-stdio.js';
export {
  generatePkce,
  generateCodeVerifier,
  codeChallengeS256,
  verifyChallenge,
  PKCE_METHOD,
  type PkcePair,
} from './pkce.js';
export {
  SkillsRegistry,
  defaultSkillRoots,
  userGlobalSkillRoots,
  resolveSkillRoots,
  parseSkillMd,
  loadOfficialCockroachSkills,
  type SkillMeta,
  type SkillFull,
  type ResolveSkillRootsOpts,
  type ResolvedSkillRoots,
} from './skills.js';
export { BUNDLED_SKILLS } from './skills/bundled.js';
export {
  resolveInferenceCredentials,
  withInferenceCredentials,
  describeMissingCredentials,
  ENV_BEDROCK_BEARER,
  type InferenceCredentials,
  type InferenceCredentialSource,
} from './inference-credentials.js';
export {
  TelemetrySink,
  emptyTelemetry,
  AGENT_SLIS,
  type TelemetryCounters,
  type TelemetryName,
  type StructuredTelemetryEvent,
  type AgentSliName,
} from './telemetry.js';
export {
  attachEnvExporters,
  createTelemetryForwarder,
  toOtlpLogBody,
  type TelemetryForwarder,
  type ExporterEnv,
} from './telemetry-exporters.js';
export {
  resolvePermissionMode,
  permissionModeFromAutonomy,
  type PermissionMode,
  type PermissionResolved,
} from './permission-mode.js';
export {
  SECRET_KEYS,
  loadMcpConfigFromSecrets,
} from './secrets.js';
export type {
  ProjectMemoryBridge,
  ProjectMemoryHit,
} from './project-memory.js';
export type {
  SharedSkillsBridge,
  SharedSkillRecord,
  SharedSkillSearchHit,
} from './shared-skills.js';
export {
  rankSkills,
  formatSkillRankNudge,
  mergeRemoteSkillHits,
  candidatesFromRegistry,
  skillEmbedText,
  DEFAULT_SKILL_RANK_TOP_K,
  SKILLS_VECTORS_REL_PATH,
  type SkillRankHit,
  type SkillRankCandidate,
} from './skill-rank.js';
export {
  remaskToolsForPhase,
  resolvePhaseAllowlist,
  classifyStartPhase,
  shouldEnablePhaseGraph,
  shouldExitGather,
  isTrivialTask,
  assertPhaseAllowlistInvariants,
  GATHER_TOOL_ALLOWLIST,
  ACT_TOOL_CORE,
  VERIFY_TOOL_ALLOWLIST,
  type AgentPhase,
} from './phase-graph.js';
export {
  formatPhasePrompt,
  buildGatherToActPrompt,
  buildActToVerifyPrompt,
  buildVerifyToActPrompt,
} from './phase-prompts.js';
export {
  classifyPhaseFailure,
  recordPhaseFailure,
  recordGatherReadFile,
  beginVerifyToActRetry,
  buildDivergentNudge,
  buildClassifiedVerifyToActPrompt,
  buildGatherReadThrashPrompt,
  buildVerifyRetryCapPrompt,
  emptyPhaseTransitionState,
  DEFAULT_MAX_VERIFY_TO_ACT,
  DEFAULT_GATHER_SAME_PATH_READS,
  DEFAULT_DIVERGENT_STREAK,
  type PhaseFailureClass,
  type PhaseTransitionState,
} from './failure-taxonomy.js';
export {
  looksLikeRiskyOrLargeTask,
  shouldForcePlanThenExecute,
  type ForcePlanOpts,
} from './plan-gate.js';
export {
  CRITIC_ROLE,
  CRITIC_TOOL_ALLOWLIST,
  CRITIC_SYSTEM_PROMPT,
  MAX_ARCHITECTURE_CRITIQUES,
  buildArchitectureCriticPrompt,
  shouldRunArchitectureCritic,
  isCriticSpawnName,
  isCriticToolName,
} from './architecture-critic.js';
export {
  ACT_TOOL_KEEP_ALWAYS,
  ACT_TOOL_RANK_BUDGET,
  DEFAULT_TOOL_RANK_TOP_K,
  DEFAULT_TOOL_RANK_MIN_SCORE,
  TOOLS_VECTORS_REL_PATH,
  rankTools,
  mergeActAllowlistWithRank,
  splitActAllowlistForRank,
  candidatesFromToolNames,
  toolKeywordBoost,
  assertActToolBudget,
  type ToolRankCandidate,
  type ToolRankHit,
} from './tool-rank.js';
export {
  normalizeLocalRepoKey,
} from './repo-key.js';
