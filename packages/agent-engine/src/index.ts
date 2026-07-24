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
  parseSettingsJson,
  parseVerifyJson,
  isVerifyCommand,
  isBackgroundAllowed,
  matchesDenyPattern,
  defaultSettings,
  SETTINGS_REL_PATH,
  VERIFY_REL_PATH,
  RULES_REL_DIR,
  type WalkcroachSettings,
  type VerifyConfig,
  type WorkspaceAgentConfig,
} from './workspace-config.js';
export { WorkspacePolicy } from './workspace-policy.js';

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
} from './protocol.js';

export { TokenDeltaCoalescer, type CoalesceFlush } from './coalesce.js';

export {
  createBedrockClient,
  getNovaModelId,
  streamConverseTurn,
  streamPing,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS,
  type ConverseTurnResult,
  type ParsedToolUse,
  type StreamDelta,
} from './bedrock.js';

export {
  runAgentLoop,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_SUBAGENTS,
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

export { ApprovalController, bindApprovals } from './approval-controller.js';
export { createFakeHost } from './fake-host.js';
export { truncateText, DEFAULT_TOOL_RESULT_MAX_CHARS } from './truncate.js';
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
  type PatchEdit,
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
  DEFAULT_MCP_URL,
  isMcpWriteTool,
  parseMcpConfigSnippet,
  plainMcpError,
  type McpConfig,
  type McpToolInfo,
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
  SkillsRegistry,
  defaultSkillRoots,
  parseSkillMd,
  type SkillMeta,
  type SkillFull,
} from './skills.js';
export { BUNDLED_SKILLS } from './skills/bundled.js';
export {
  TelemetrySink,
  emptyTelemetry,
  type TelemetryCounters,
  type TelemetryName,
} from './telemetry.js';
export {
  SECRET_KEYS,
  loadMcpConfigFromSecrets,
} from './secrets.js';
export type {
  ProjectMemoryBridge,
  ProjectMemoryHit,
} from './project-memory.js';
export {
  normalizeLocalRepoKey,
} from './repo-key.js';
