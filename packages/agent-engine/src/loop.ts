import { randomUUID } from 'node:crypto';
import type { Message } from '@aws-sdk/client-bedrock-runtime';
import type { HostAdapter } from './host.js';
import {
  streamConverseTurn,
  createBedrockClient,
  embedText,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS,
  type ConverseTurnResult,
  type ParsedToolUse,
  type NovaReasoningEffort,
} from './bedrock.js';
import {
  assembleSystemBlocks,
  buildUserTurn,
  buildFollowUpTurn,
  shouldTreatAsActionTask,
  type ActionBias,
} from './prompt.js';
import { toBedrockTools } from './tools/defs.js';
import { executeTool, type ToolExecResult } from './tools/execute.js';
import { readWalkcroachMd } from './memory-local.js';
import {
  CockroachMcpClient,
  McpServerRegistry,
  RESERVED_COCKROACHDB_SERVER_NAME,
  type McpConfig,
} from './mcp.js';
import { registerConfiguredMcpServers } from './mcp-stdio.js';
import { SkillsRegistry, resolveSkillRoots } from './skills.js';
import {
  candidatesFromRegistry,
  formatSkillRankNudge,
  mergeRemoteSkillHits,
  rankSkills,
} from './skill-rank.js';
import { TelemetrySink } from './telemetry.js';
import { attachEnvExporters } from './telemetry-exporters.js';
import { resolvePermissionMode } from './permission-mode.js';
import type { ProjectMemoryBridge } from './project-memory.js';
import type { SharedSkillsBridge } from './shared-skills.js';
import { cloneMessages, trimSessionMessages, appendUserFollowUp, sanitizeConverseMessages } from './session.js';
import { compactSessionMessages } from './compact.js';
import { attachmentsToContentBlocks, redactAttachmentBlocks } from './attachments.js';
import type { SubmitAttachment } from './protocol.js';
import {
  loadWorkspaceAgentConfig,
  loadMcpServersConfig,
  formatRuleCatalog,
} from './workspace-config.js';
import { WorkspacePolicy } from './workspace-policy.js';
import { runPostToolUseHooks, runStopHooks, buildStopHookNudgePrompt } from './hooks.js';
import type { AgentTodo } from './todos.js';
import {
  buildTodoProgressNudgePrompt,
  buildTodoWriteNudgePrompt,
  needsTodoProgressNudge,
  needsTodoWriteNudge,
  normalizeTodos,
} from './todos.js';
import {
  DEFAULT_IDENTICAL_FAILURE_LIMIT,
  afterToolResult,
  beforeToolCall,
  buildStuckLoopNudge,
  emptyToolLoopGuard,
  identicalFailureLimitFor,
  type ToolLoopGuardState,
} from './tool-loop-guard.js';
import {
  emptyToolCallObserve,
  emitToolCallObservation,
  emitToolCallObserveSummary,
  recordToolCallObservation,
  type ToolCallObserveState,
} from './tool-call-observe.js';
import {
  afterBoundedToolResult,
  armThrashOneShot,
  beforeBoundedToolCall,
  breakThrashLoop,
  emptyBoundedExecutorState,
  nudgeBudgetExhaustedMessage,
  recordThrashExecution,
  resolveBoundedExecutorConfig,
  type BoundedExecutorConfig,
  type BoundedExecutorState,
} from './bounded-executor.js';
import { createReadFreshnessTracker } from './read-freshness.js';
import { createEditAnchorFailCache } from './edit-anchor-guard.js';
import { createEditPathMismatchState } from './edit-path-mismatch-guard.js';
import {
  PLANNER_SYSTEM_PROMPT,
  PLANNER_TOOL_ALLOWLIST,
  assertPlannerSchemaHasNoWriteTools,
  buildPlannerUserPrompt,
  looksLikePlanningTask,
} from './planner.js';

export const DEFAULT_MAX_ITERATIONS = 24;
export const DEFAULT_MAX_SUBAGENTS = 3;
/** Stop after this many identical failed run_terminal/verify calls. */
export { DEFAULT_IDENTICAL_FAILURE_LIMIT };

/** Soft todo re-prompts (write once + progress once). */
export const MAX_TODO_WRITE_NUDGES = 1;
export const MAX_TODO_PROGRESS_NUDGES = 1;

/** At most one adversarial verify-review subagent per top-level run. */
export const MAX_VERIFY_REVIEWS = 1;

/** Stop-hook re-prompts when a blocking Stop script exits non-zero. */
export const MAX_STOP_HOOK_NUDGES = 2;

export const REVIEW_OK_MARKER = 'REVIEW_OK';

/** Tools safe to run concurrently within one assistant tool turn. */
export const PARALLEL_SAFE_TOOLS = new Set([
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'await_terminal',
  'load_skill',
  'recall_project_memory',
]);

/** User-visible continuation prompt after max_tokens / max_iterations / stalled act. */
export const CONTINUE_PROMPT =
  'Continue the user\'s task now. Do not re-summarize the repo. Do not only list directories. Update todo_write, then call write_file / edit_file / apply_patch / run_terminal to finish remaining work, then briefly confirm what you did.';

/** One-shot nudge when an action task ends after exploration only. */
export const ACT_NUDGE_PROMPT =
  'You stopped before finishing. The user asked for concrete work (create/scaffold/start/fix). Call todo_write if helpful, then write_file / edit_file / apply_patch / run_terminal now. Use ask_user only if a real decision blocks you. Do not re-list the whole workspace.';

/** Soft verify gate: mutating action work without a successful verify recipe. */
export function buildVerifyNudgePrompt(commands: string[]): string {
  const list = commands.map((c) => `- \`${c}\``).join('\n');
  return [
    'You made changes but have not verified them yet.',
    'Call the `verify` tool now with one of these recipes from `.walkcroach/verify.json`:',
    list,
    'Do not claim the task is complete until verify exits 0. Run a fresh verify — do not reuse an earlier failing result.',
  ].join('\n');
}

export function buildVerifyReviewPrompt(task: string): string {
  return [
    'You are a read-only reviewer. Inspect the workspace for issues from the just-completed task.',
    `Original task:\n${task.trim()}`,
    'Check that intended files exist, edits look coherent, and nothing obvious is broken.',
    `If the work looks acceptable, reply with exactly ${REVIEW_OK_MARKER} on the first line, then a one-sentence note.`,
    'If there are problems, reply with REVIEW_ISSUES: then a short bullet list of what to fix. Do not write files.',
  ].join('\n');
}

export function isReviewOk(summary: string): boolean {
  const first = summary.trim().split(/\r?\n/)[0]?.trim() ?? '';
  return (
    first === REVIEW_OK_MARKER ||
    first.startsWith(`${REVIEW_OK_MARKER} `) ||
    first.startsWith(`${REVIEW_OK_MARKER}:`)
  );
}

export type RunLoopParams = {
  host: HostAdapter;
  prompt: string;
  signal?: AbortSignal;
  mode?: 'ping' | 'full' | 'plan';
  /**
   * Prefer IDE Agent/Ask over regex for act/verify gates.
   * Agent → always; Ask/plan → never; default auto (looksLikeActionTask).
   */
  actionBias?: ActionBias;
  /** Feature flag PA.13 — default true. */
  subagentsEnabled?: boolean;
  maxIterations?: number;
  maxSubagents?: number;
  /** Nested depth; sub-agents cannot spawn further sub-agents. */
  depth?: number;
  readOnly?: boolean;
  /** Phase B — Managed MCP config (from SecretStorage). */
  mcpConfig?: McpConfig | null;
  /** Phase B — ccloud service-account API key. */
  ccloudApiKey?: string;
  /** Include Phase B tools (default true). */
  includePhaseB?: boolean;
  /** Phase C — linked project memory bridge (null = unlinked). */
  projectMemory?: ProjectMemoryBridge | null;
  /** Cross-surface shared skill library — available whenever signed in, independent of project link. */
  sharedSkills?: SharedSkillsBridge | null;
  /**
   * Path to cockroachdb-official.generated.json (IDE ships it beside extension.cjs).
   * When unset, SkillsRegistry searches next to the engine module / cwd.
   */
  officialSkillsJsonPath?: string;
  /**
   * Extra skill scan roots (absolute or workspace-relative). Merged with
   * defaultSkillRoots + user-global (~/.cursor/skills, ~/.walkcroach/skills).
   */
  skillRoots?: string[];
  /** Include ~/.cursor/skills and ~/.walkcroach/skills (default true). */
  includeUserGlobalSkills?: boolean;
  /**
   * Per-turn Bedrock output budget. Unset picks the reasoning-tier default
   * in streamConverseTurn (higher when extended thinking is on).
   */
  maxTokens?: number;
  /** Auto-continue rounds on max_tokens (default DEFAULT_MAX_OUTPUT_CONTINUATIONS). */
  maxOutputContinuations?: number;
  /** Extended-thinking tier (default: getNovaReasoningEffort(), i.e. medium). */
  reasoningEffort?: NovaReasoningEffort;
  /** Optional Bedrock model id override (default: getNovaModelId()). */
  modelId?: string;
  /** Bedrock Runtime region (default: getBedrockRegion()). Critical for API keys. */
  region?: string;
  /** Optional preconfigured client (e.g. bearer token without mutating process.env). */
  client?: import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient;
  /**
   * Identical failed run_terminal/verify calls before refuse + stop
   * (default DEFAULT_IDENTICAL_FAILURE_LIMIT).
   * Ignored when boundedExecutor.enabled (Phase 1 thrash supersedes).
   */
  identicalFailureLimit?: number;
  /**
   * Phase 1 bounded executor (thrash two-tier + nudge budget).
   * Default enabled with OpenDev-educated defaults (see PHASE1_DEFAULTS_RATIONALE).
   * Pass `{ enabled: false }` to keep legacy failure-only tool-loop-guard.
   * sdk-host should set `{ interactive: false }`.
   */
  boundedExecutor?: Partial<BoundedExecutorConfig> | null;
  /**
   * Phase 2 — approved plan markdown block injected into system prompt.
   */
  approvedPlan?: string;
  /**
   * Phase 2 — when true, present_plan auto-approves (sdk-host / non-interactive).
   * Defaults from !boundedExecutor.interactive when unset.
   */
  autoApprovePlan?: boolean;
  /** Phase 2 — Planner subagent only. */
  plannerMode?: boolean;
  /** Phase 2 — schema-level tool allowlist (Planner). */
  toolAllowlist?: readonly string[];
  onPlanSubmitted?: (planPath: string) => void;
  /**
   * When true (default), prompts that lookLikePlanningTask run Planner→present
   * before the normal loop. Set false to only plan on mode:plan / explicit spawn.
   */
  plannerFirstOnIntent?: boolean;
  /**
   * Phase 5 — after Planner + present_plan approve, stop without executing.
   * Emits telemetry `plan.auto_approved` (or `plan.approved`) and done `plan_ready`.
   * Draft stage then runs with `approvedPlan` injected.
   */
  planOnly?: boolean;
  /**
   * Prior Bedrock messages for multi-turn continuity (Continue / follow-ups).
   * When set with followUp, prompt is appended as a lightweight user turn.
   */
  priorMessages?: Message[];
  /** Treat prompt as a follow-up (Continue or next user message in-session). */
  followUp?: boolean;
  /** Pasted/attached images, PDFs, docs, or text files for this turn's user message. */
  attachments?: SubmitAttachment[];
  /** Persist full conversation after the run (including tool turns). */
  onSessionMessages?: (messages: Message[]) => void;
  /** P2 checkpoints — id for this turn's mutating edits. Unset → runFullLoop generates one. */
  turnId?: string;
  /**
   * Claude-style permission mode (Pre-P6). Aliases autonomy + plan/readOnly.
   * Hard infra/critical gates still apply under bypassPermissions.
   */
  permissionMode?: import('./permission-mode.js').PermissionMode;
  /** Compaction threshold (message count). Default DEFAULT_COMPACT_THRESHOLD. */
  compactThreshold?: number;
  /** Messages kept after compaction. Default DEFAULT_COMPACT_KEEP_RECENT. */
  compactKeepRecent?: number;
};

function assertTrusted(host: HostAdapter): void {
  if (!host.isTrustedWorkspace()) {
    throw new Error(
      'Workspace is not trusted. Agentic actions are disabled until you trust this folder (NFR-D07).',
    );
  }
}

function persistSession(
  params: RunLoopParams,
  messages: Message[],
): void {
  params.onSessionMessages?.(
    redactAttachmentBlocks(trimSessionMessages(cloneMessages(messages))),
  );
}

/** Mid-loop compact (when large) else pair-safe trim. */
function prepareMessagesInPlace(
  messages: Message[],
  opts?: {
    threshold?: number;
    keepRecent?: number;
    onCompacted?: () => void;
  },
): void {
  const cleaned = sanitizeConverseMessages(messages);
  const { messages: compacted, compacted: didCompact } = compactSessionMessages(
    cleaned,
    { threshold: opts?.threshold, keepRecent: opts?.keepRecent },
  );
  if (didCompact) opts?.onCompacted?.();
  const next = didCompact ? compacted : trimSessionMessages(cleaned);
  messages.length = 0;
  messages.push(...next);
}

async function runPing(params: RunLoopParams): Promise<void> {
  const { streamPing, createBedrockClient, formatBedrockAuthError, getBedrockRegion } =
    await import('./bedrock.js');
  const { host, prompt, signal } = params;
  const region = getBedrockRegion(params.region);
  host.emit({ type: 'phase', phase: 'gather' });
  host.emit({ type: 'phase', phase: 'act' });
  try {
    const gen = streamPing({
      userText: prompt.trim().toLowerCase() === 'ping' ? undefined : prompt,
      signal,
      client: params.client ?? createBedrockClient({ region }),
      modelId: params.modelId,
    });
    let result = await gen.next();
    while (!result.done) {
      const ev = result.value;
      if (ev.type === 'token') host.emit({ type: 'token_delta', text: ev.text });
      if (ev.type === 'thinking') {
        host.emit({
          type: 'thinking_delta',
          text: ev.text,
          opaque: ev.opaque,
        });
      }
      if (ev.type === 'usage') {
        host.emit({
          type: 'cache_usage',
          cacheReadInputTokens: ev.cacheReadInputTokens,
          cacheWriteInputTokens: ev.cacheWriteInputTokens,
        });
      }
      result = await gen.next();
    }
    host.emit({ type: 'phase', phase: 'verify' });
    host.emit({ type: 'done', reason: result.value.stopReason || 'complete' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(formatBedrockAuthError(err, region));
  }
}

/**
 * Abortable gather → act → verify agent loop (Phase A + B).
 */
export async function runAgentLoop(params: RunLoopParams): Promise<void> {
  const resolved = resolvePermissionMode(
    params.permissionMode,
    params.host.getAutonomy?.() ?? 'strict',
  );
  if (params.permissionMode) {
    params.host.setAutonomy(resolved.autonomy);
  }

  const { host, prompt, signal } = params;
  const mode =
    params.mode ??
    (resolved.readOnly
      ? 'plan'
      : prompt.trim().toLowerCase() === 'ping'
        ? 'ping'
        : 'full');

  assertTrusted(host);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  try {
    if (mode === 'ping') {
      await runPing(params);
      return;
    }

    // Phase 2 ADR-A: sticky mode:plan / permissionMode plan → Planner subagent,
    // then present_plan, then execute. Bare params.readOnly stays sticky explore
    // (runFullLoop) and must NOT enter this path.
    if (mode === 'plan' || resolved.readOnly) {
      await runPlanThenExecute({
        ...params,
        mode: 'full',
        readOnly: false,
      });
      return;
    }

    // Planning-intent heuristic: plan-then-execute once when no plan yet.
    if (
      !params.approvedPlan &&
      looksLikePlanningTask(prompt) &&
      (params.plannerFirstOnIntent ?? true)
    ) {
      await runPlanThenExecute(params);
      return;
    }

    await runFullLoop(params);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      host.emit({ type: 'done', reason: 'cancelled' });
      return;
    }
    const { formatBedrockAuthError, getBedrockRegion } = await import(
      './bedrock.js'
    );
    const message = formatBedrockAuthError(
      err,
      getBedrockRegion(params.region),
    );
    host.emit({ type: 'error', message, fatal: true });
    host.emit({ type: 'done', reason: 'error' });
  }
}

type ToolResultBlock = {
  toolResult: {
    toolUseId: string;
    content: Array<{ text: string }>;
    status: 'success' | 'error';
  };
};

async function runFullLoop(params: RunLoopParams): Promise<void> {
  const { host, prompt, signal } = params;
  const depth = params.depth ?? 0;
  const actionBias: ActionBias = params.actionBias ?? 'auto';
  const subagentsEnabled =
    (params.subagentsEnabled ?? true) && depth === 0 && !params.readOnly;
  const includePhaseB =
    (params.includePhaseB ?? true) && depth === 0 && !params.readOnly;
  const includePhaseC = Boolean(params.projectMemory) && depth === 0;
  const includeSharedSkills = Boolean(params.sharedSkills) && depth === 0;
  const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxSubagents = params.maxSubagents ?? DEFAULT_MAX_SUBAGENTS;
  const maxTokens = params.maxTokens;
  const reasoningEffort = params.reasoningEffort;
  const maxOutputContinuations =
    params.maxOutputContinuations ?? DEFAULT_MAX_OUTPUT_CONTINUATIONS;
  const identicalFailureLimit =
    params.identicalFailureLimit ?? DEFAULT_IDENTICAL_FAILURE_LIMIT;
  const boundedCfg = resolveBoundedExecutorConfig(params.boundedExecutor);
  const turnId = params.turnId ?? randomUUID();
  let subagentCount = 0;
  let toolLoopGuard: ToolLoopGuardState = emptyToolLoopGuard();
  let stuckLoopStop = false;
  /** Phase 0: log-only thrash/error instrumentation (never refuses). */
  let toolCallObserve: ToolCallObserveState = emptyToolCallObserve();
  /** Phase 1: enforcing thrash + nudge budget. */
  let boundedState: BoundedExecutorState = emptyBoundedExecutorState(boundedCfg);
  const readFreshness = createReadFreshnessTracker();
  const editAnchorFails = createEditAnchorFailCache();
  const editPathMismatches = createEditPathMismatchState();
  const planSession = {
    autoApprove:
      params.autoApprovePlan ??
      boundedCfg.interactive === false,
    approvedPlan: null as string | null,
    approvedPlanPath: null as string | null,
    reviseFeedback: null as string | null,
  };

  const emitObserveSummary = (): void => {
    const summary = emitToolCallObserveSummary(telemetry, toolCallObserve);
    host.emit({
      type: 'telemetry',
      name: 'tool_call_observe_summary',
      counters: {
        observe_calls: Number(summary.calls),
        observe_would_halt_3: Number(summary.would_halt_3),
        observe_max_repeat: Number(summary.max_repeat_seen),
      },
      detail: JSON.stringify(summary),
    });
  };

  host.emit({ type: 'phase', phase: 'gather' });

  const telemetry = new TelemetrySink();
  attachEnvExporters(telemetry);
  const skills = new SkillsRegistry();
  const skillPlan = resolveSkillRoots(host.getWorkspaceRoot(), {
    extraRoots: params.skillRoots,
    includeUserGlobal: params.includeUserGlobalSkills,
  });
  await skills.init(skillPlan.roots, {
    sharedSkills: params.sharedSkills ?? undefined,
    officialSkillsJsonPath: params.officialSkillsJsonPath,
    userGlobalRoots: skillPlan.userGlobalRoots,
  });
  if (params.officialSkillsJsonPath) {
    const { existsSync } = await import('node:fs');
    if (!existsSync(params.officialSkillsJsonPath)) {
      host.emit({
        type: 'warning',
        message: `CockroachDB official skills file missing at ${params.officialSkillsJsonPath}. Rebuild/reinstall the extension so load_skill can use cockroachdb-* skills.`,
      });
    } else if (
      !skills
        .listMeta()
        .some((m) => m.origin?.includes('cockroachlabs/cockroachdb-skills'))
    ) {
      host.emit({
        type: 'warning',
        message:
          'CockroachDB official skills JSON was present but failed to load. Check the file is valid JSON.',
      });
    }
  }

  let mcp: CockroachMcpClient | null = null;
  if (includePhaseB && params.mcpConfig?.clusterId && params.mcpConfig.apiKey) {
    mcp = new CockroachMcpClient(params.mcpConfig);
    try {
      await mcp.connect();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      host.emit({
        type: 'warning',
        message: `MCP connect failed (continuing without MCP): ${message}`,
      });
      mcp = null;
    }
  }

  let mcpServerRegistry: McpServerRegistry | null = null;
  if (includePhaseB) {
    const fileServers = await loadMcpServersConfig(host.getWorkspaceRoot());
    // The reserved name is dropped before registration so a workspace cannot
    // shadow the built-in CockroachDB client by naming a server after it.
    const configured = Object.fromEntries(
      Object.entries(fileServers).filter(
        ([n]) => n !== RESERVED_COCKROACHDB_SERVER_NAME,
      ),
    );
    if (Object.keys(configured).length) {
      mcpServerRegistry = new McpServerRegistry();
      // Gating for stdio servers (consent, resolved command, minimal env) lives
      // in registerConfiguredMcpServers — see mcp-stdio.ts and
      // docs/walkcroach-stdio-mcp-security-review.md §6.
      await registerConfiguredMcpServers({
        host,
        registry: mcpServerRegistry,
        fileServers: configured,
        supervisor: host.stdioMcp,
      });
      const errors = await mcpServerRegistry.connectAll();
      for (const [serverName, message] of errors) {
        host.emit({
          type: 'warning',
          message: `MCP server "${serverName}" connect failed (continuing without it): ${message}`,
        });
      }
    }
  }

  const walkcroachMd = await readWalkcroachMd(host);
  const meta = (await host.gatherMeta?.(signal)) ?? {};
  const workspaceConfig = await loadWorkspaceAgentConfig(
    host.getWorkspaceRoot(),
    { activeFile: meta.activeFile },
  );
  const policy = new WorkspacePolicy(
    workspaceConfig.settings,
    workspaceConfig.verify,
  );

  /** Live checklist — same source of truth as UI / disk. */
  let liveTodos: AgentTodo[] = [];
  if (host.loadTodos) {
    try {
      liveTodos = (await host.loadTodos()) ?? [];
    } catch {
      liveTodos = [];
    }
  }
  let didTodoWrite = liveTodos.length > 0;

  const offerLoadSkill =
    includePhaseB ||
    Boolean(params.toolAllowlist?.includes('load_skill')) ||
    Boolean(params.readOnly);

  let skillsRankNudge: string | undefined;
  if (
    offerLoadSkill &&
    params.prompt.trim() &&
    params.prompt !== CONTINUE_PROMPT &&
    skills.listMeta().length > 0
  ) {
    try {
      const keywordNames = skills.match(params.prompt).map((m) => m.name);
      let hits = await rankSkills({
        query: params.prompt,
        skills: candidatesFromRegistry(skills.listMeta(), (n) => skills.load(n)),
        embed: (t) => embedText(t, params.client),
        keywordNames,
        workspaceRoot: host.getWorkspaceRoot(),
      });

      if (params.sharedSkills?.search) {
        try {
          const remote = await params.sharedSkills.search({
            query: params.prompt,
            limit: 5,
          });
          for (const r of remote) {
            skills.ingestShared(r);
          }
          hits = mergeRemoteSkillHits({
            local: hits,
            remote: remote.map((r) => ({
              name: r.name,
              description: r.description,
              source: 'shared' as const,
              distance: r.distance ?? 1,
            })),
          });
        } catch {
          /* remote rank is best-effort */
        }
      }

      const nudge = formatSkillRankNudge(hits);
      if (nudge) skillsRankNudge = nudge;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      host.emit({
        type: 'warning',
        message: `Skill ranking skipped: ${message}`,
      });
    }
  }

  const system = assembleSystemBlocks({
    walkcroachMd,
    skillsCatalog: offerLoadSkill ? skills.catalogText() : undefined,
    skillsRankNudge,
    rulesMd: workspaceConfig.rulesMd || undefined,
    ruleCatalog: formatRuleCatalog(workspaceConfig.ruleCatalog) || undefined,
    approvedPlan: params.approvedPlan,
    systemPromptOverride: params.plannerMode
      ? PLANNER_SYSTEM_PROMPT
      : undefined,
  });
  const tools = (
    params.toolAllowlist
      ? toBedrockTools({
          allowlist: params.toolAllowlist,
        })
      : params.readOnly
        ? toBedrockTools({
            includeSubagents: false,
            // Phase B required so load_skill exists before the RO name filter.
            includePhaseB: true,
            includePhaseC: Boolean(params.projectMemory),
          }).filter((t) =>
            [
              'read_file',
              'list_dir',
              'search',
              'glob',
              'semantic_search',
              'ask_user',
              'recall_project_memory',
              'load_rule',
              'load_skill',
            ].includes(t.toolSpec?.name ?? ''),
          )
        : toBedrockTools({
            includeSubagents: subagentsEnabled,
            includePhaseB,
            includePhaseC,
            includeSharedSkills,
          })
  ) as import('@aws-sdk/client-bedrock-runtime').ToolConfiguration['tools'];

  if (params.plannerMode && params.toolAllowlist) {
    assertPlannerSchemaHasNoWriteTools(params.toolAllowlist);
  }

  const prior = params.priorMessages?.length
    ? cloneMessages(params.priorMessages)
    : [];
  const userText =
    params.followUp || prior.length > 0
      ? buildFollowUpTurn(prompt, liveTodos)
      : buildUserTurn({
          prompt,
          gitStatus: meta.gitStatus,
          workspaceRoot: host.getWorkspaceRoot(),
          mcpConnected: Boolean(mcp?.connected),
          mcpTools: mcp?.listTools().map((t) => t.name),
          linkedProjectId: params.projectMemory?.projectId,
          linkedProjectName: params.projectMemory?.projectName,
          verifyCommands: policy.verify.commands,
          todos: liveTodos,
          actionBias,
        });

  const attachmentBlocks = attachmentsToContentBlocks(params.attachments);
  const messages: Message[] =
    prior.length > 0
      ? appendUserFollowUp(prior, userText, attachmentBlocks)
      : [
          {
            role: 'user',
            content: [{ text: userText }, ...attachmentBlocks],
          },
        ];

  // Action-task heuristic uses the latest user prompt (not only the first turn).
  const actionPrompt = prompt;
  const isAction = () => shouldTreatAsActionTask(actionPrompt, actionBias);

  host.emit({ type: 'phase', phase: 'act' });

  const MUTATING_TOOLS = new Set([
    'write_file',
    'edit_file',
    'apply_patch',
    'run_terminal',
    'terminal_session',
    'update_walkcroach_md',
    'enter_worktree',
    'exit_worktree',
  ]);
  let didMutatingWork = false;
  let actNudgeUsed = false;
  let verifyNudgesUsed = 0;
  let todoWriteNudgesUsed = 0;
  let todoProgressNudgesUsed = 0;
  let verifyReviewsUsed = 0;
  let stopHookNudgesUsed = 0;

  async function streamOneTurn(): Promise<ConverseTurnResult> {
    prepareMessagesInPlace(messages, {
      threshold: params.compactThreshold,
      keepRecent: params.compactKeepRecent,
      onCompacted: () => {
        telemetry.emit('walkcroach.context.compacted', {
          threshold: params.compactThreshold ?? 36,
          keep_recent: params.compactKeepRecent ?? 16,
          message_count: messages.length,
        });
      },
    });
    const gen = streamConverseTurn({
      system,
      messages,
      tools,
      signal,
      maxTokens,
      reasoningEffort,
      client: params.client ?? createBedrockClient({ region: params.region }),
      modelId: params.modelId,
    });
    let turn = await gen.next();
    while (!turn.done) {
      const ev = turn.value;
      if (ev.type === 'token') {
        host.emit({ type: 'token_delta', text: ev.text });
      }
      if (ev.type === 'thinking') {
        host.emit({
          type: 'thinking_delta',
          text: ev.text,
          opaque: ev.opaque,
        });
      }
      if (ev.type === 'usage') {
        host.emit({
          type: 'cache_usage',
          cacheReadInputTokens: ev.cacheReadInputTokens,
          cacheWriteInputTokens: ev.cacheWriteInputTokens,
        });
      }
      turn = await gen.next();
    }
    return turn.value;
  }

  async function runOneTool(tool: ParsedToolUse): Promise<ToolResultBlock> {
    let thrashFingerprint: string | null = null;

    if (boundedCfg.enabled) {
      let thrash = beforeBoundedToolCall(boundedState, tool.name, tool.input);
      if (thrash.action === 'warn_skip') {
        boundedState = thrash.state;
        host.emit({ type: 'warning', message: thrash.message });
        telemetry.emit('walkcroach.thrash.warn_skip', {
          'walkcroach.tool.name': tool.name,
          'walkcroach.phase': 1,
        });
        const recorded = recordToolCallObservation(toolCallObserve, {
          toolName: tool.name,
          input: tool.input,
          status: 'rejected',
          content: thrash.message,
        });
        toolCallObserve = recorded.state;
        emitToolCallObservation(telemetry, recorded.observation);
        return {
          toolResult: {
            toolUseId: tool.toolUseId,
            content: [{ text: thrash.message }],
            status: 'error',
          },
        };
      }
      if (thrash.action === 'escalate') {
        host.emit({ type: 'warning', message: thrash.message });
        telemetry.emit('walkcroach.thrash.escalate', {
          'walkcroach.tool.name': tool.name,
          'walkcroach.phase': 1,
          interactive: boundedCfg.interactive,
        });
        if (boundedCfg.interactive) {
          const answer = await host.askUser({
            question: thrash.message,
            options: ['Allow once', 'Break'],
            allowFreeText: false,
          });
          const allow = answer.selected.toLowerCase().startsWith('allow');
          if (allow) {
            boundedState = armThrashOneShot(thrash.state, thrash.fingerprint);
            thrash = beforeBoundedToolCall(boundedState, tool.name, tool.input);
            if (thrash.action !== 'allow') {
              // Should not happen after one-shot arm; fail closed.
              stuckLoopStop = true;
              return {
                toolResult: {
                  toolUseId: tool.toolUseId,
                  content: [
                    {
                      text: 'Thrash one-shot allow failed to arm; stopping loop.',
                    },
                  ],
                  status: 'error',
                },
              };
            }
            boundedState = thrash.state;
            thrashFingerprint = thrash.fingerprint;
          } else {
            boundedState = breakThrashLoop(thrash.state, thrash.fingerprint);
            stuckLoopStop = true;
            const msg =
              'Thrash loop broken by user. Do not repeat the same tool call; change strategy.';
            return {
              toolResult: {
                toolUseId: tool.toolUseId,
                content: [{ text: msg }],
                status: 'error',
              },
            };
          }
        } else {
          boundedState = breakThrashLoop(thrash.state, thrash.fingerprint);
          stuckLoopStop = true;
          const msg = [
            thrash.message,
            'Non-interactive host: failing closed (no Allow UI).',
          ].join(' ');
          return {
            toolResult: {
              toolUseId: tool.toolUseId,
              content: [{ text: msg }],
              status: 'error',
            },
          };
        }
      } else {
        boundedState = thrash.state;
        thrashFingerprint = thrash.fingerprint;
      }
    } else {
      const gate = beforeToolCall(
        toolLoopGuard,
        tool.name,
        tool.input,
        identicalFailureLimitFor(tool.name, identicalFailureLimit),
      );
      if (gate.action === 'refuse') {
        host.emit({
          type: 'warning',
          message: `Blocked identical failing tool retry (${tool.name})`,
        });
        stuckLoopStop = true;
        return {
          toolResult: {
            toolUseId: tool.toolUseId,
            content: [{ text: gate.message }],
            status: 'error',
          },
        };
      }
    }

    if (tool.name === 'spawn_subagent') {
      if (!subagentsEnabled) {
        return {
          toolResult: {
            toolUseId: tool.toolUseId,
            content: [{ text: 'Sub-agents are disabled.' }],
            status: 'error',
          },
        };
      }
      if (subagentCount >= maxSubagents) {
        return {
          toolResult: {
            toolUseId: tool.toolUseId,
            content: [
              {
                text: `Sub-agent limit reached (max ${maxSubagents}).`,
              },
            ],
            status: 'error',
          },
        };
      }
      subagentCount += 1;
    }

    let exec: ToolExecResult = await executeTool({
      host,
      tool,
      signal,
      readOnly: params.readOnly,
      mcp,
      mcpServers: mcpServerRegistry,
      skills,
      telemetry,
      ccloudApiKey: params.ccloudApiKey,
      projectMemory: params.projectMemory,
      sharedSkills: params.sharedSkills,
      policy,
      turnId,
      indexSettings: workspaceConfig.settings.index,
      readFreshness: host.supportsMtimeFreshness ? readFreshness : null,
      editAnchorFails,
      editPathMismatches,
      plannerMode: params.plannerMode,
      onPlanSubmitted: params.onPlanSubmitted,
      planSession,
      spawnSubagent: subagentsEnabled
        ? async ({ name, prompt: subPrompt, signal: subSignal, role }) => {
            return runSubagent({
              host,
              name,
              prompt: subPrompt,
              signal: subSignal ?? signal,
              depth: depth + 1,
              role: role ?? 'default',
              region: params.region,
              client: params.client,
              modelId: params.modelId,
              projectMemory: params.projectMemory,
              sharedSkills: params.sharedSkills,
              officialSkillsJsonPath: params.officialSkillsJsonPath,
              skillRoots: params.skillRoots,
              includeUserGlobalSkills: params.includeUserGlobalSkills,
              attachments: params.attachments,
            });
          }
        : undefined,
    });

    if (boundedCfg.enabled && thrashFingerprint) {
      boundedState = recordThrashExecution(boundedState, thrashFingerprint);
    }

    if (
      exec.status === 'error' &&
      /Path-level gate:/i.test(exec.content) &&
      boundedCfg.interactive
    ) {
      const smallFile = /≤\d+ lines|small file/i.test(exec.content);
      host.emit({ type: 'warning', message: exec.content.split('\n')[0]! });
      const answer = await host.askUser({
        question: smallFile
          ? 'This file is small (≤400 lines) and surgical edits are blocked. Rewrite it with write_file, or stop?'
          : 'Surgical edits on this path are blocked after repeated mismatches. Use write_file for a full rewrite, or stop?',
        options: ['Use write_file', 'Stop'],
        allowFreeText: false,
      });
      if (answer.selected.toLowerCase().startsWith('stop')) {
        stuckLoopStop = true;
      } else {
        exec = {
          ...exec,
          content: smallFile
            ? `${exec.content}\n\n[SYSTEM] User chose write_file. Emit the complete updated file via write_file (≤400-line rewrite). Do not call edit_file or apply_patch on this path again.`
            : `${exec.content}\n\n[SYSTEM] User chose write_file. Rewrite this file with write_file; do not call edit_file or apply_patch on this path again.`,
        };
      }
    }

    if (MUTATING_TOOLS.has(tool.name) && exec.status === 'success') {
      didMutatingWork = true;
    }

    if (tool.name === 'todo_write' && exec.status === 'success') {
      try {
        liveTodos = normalizeTodos(tool.input?.todos);
        didTodoWrite = true;
      } catch {
        /* normalize already failed inside executeTool */
      }
    }

    if (!boundedCfg.enabled) {
      toolLoopGuard = afterToolResult(
        toolLoopGuard,
        tool.name,
        tool.input,
        exec.status === 'success' ? 'success' : 'error',
      );
    } else {
      const nudged = afterBoundedToolResult(boundedState, {
        toolName: tool.name,
        status: exec.status,
        content: exec.content,
      });
      boundedState = nudged.state;
      if (nudged.recoveryHint && exec.status !== 'success') {
        exec = {
          ...exec,
          content: `${exec.content}\n\n${nudged.recoveryHint}`,
        };
      }
      if (nudged.budgetExhausted && exec.status !== 'success') {
        const msg = nudgeBudgetExhaustedMessage(boundedState, tool.name);
        host.emit({ type: 'warning', message: msg });
        telemetry.emit('walkcroach.nudge.budget_exhausted', {
          'walkcroach.tool.name': tool.name,
          'walkcroach.phase': 1,
        });
        if (boundedCfg.interactive) {
          const answer = await host.askUser({
            question: msg,
            options: ['Continue trying', 'Stop'],
            allowFreeText: false,
          });
          if (answer.selected.toLowerCase().startsWith('stop')) {
            stuckLoopStop = true;
          } else {
            boundedState = {
              ...boundedState,
              consecutiveFailures: 0,
              consecutiveSameClass: 0,
              lastErrorClass: null,
            };
          }
        } else {
          stuckLoopStop = true;
          exec = {
            ...exec,
            content: `${exec.content}\n\n${msg} Non-interactive host: failing closed.`,
          };
        }
      }
    }

    // Phase 0 — observe always (alongside Phase 1 enforcement).
    {
      const recorded = recordToolCallObservation(toolCallObserve, {
        toolName: tool.name,
        input: tool.input,
        status: exec.status,
        content: exec.content,
      });
      toolCallObserve = recorded.state;
      emitToolCallObservation(telemetry, recorded.observation);
      host.emit({
        type: 'telemetry',
        name: 'tool_call_observe',
        counters: {
          count_in_window: recorded.observation.countInWindow,
          consecutive_failures: recorded.observation.consecutiveFailures,
        },
        detail: JSON.stringify({
          tool: recorded.observation.toolName,
          fingerprint: recorded.observation.fingerprintShort,
          status: recorded.observation.status,
          errorClass: recorded.observation.errorClass,
          wouldHaltAt: recorded.observation.wouldHaltAt,
          observeOnly: false,
          phase: boundedCfg.enabled ? 1 : 0,
        }),
      });
    }

    if (
      !boundedCfg.enabled &&
      toolLoopGuard.streak >= identicalFailureLimit &&
      exec.status !== 'success'
    ) {
      host.emit({
        type: 'warning',
        message: buildStuckLoopNudge(toolLoopGuard),
      });
      stuckLoopStop = true;
    }

    if (
      depth === 0 &&
      workspaceConfig.settings.hooks.PostToolUse.length > 0
    ) {
      const root = host.getWorkspaceRoot();
      if (root) {
        const warnings = await runPostToolUseHooks({
          workspaceRoot: root,
          hooks: workspaceConfig.settings.hooks.PostToolUse,
          toolName: tool.name,
          toolInput: tool.input ?? {},
          toolStatus: exec.status,
          toolContent: exec.content,
          signal,
        });
        for (const message of warnings) {
          host.emit({ type: 'warning', message });
        }
      }
    }

    return {
      toolResult: {
        toolUseId: exec.toolUseId,
        content: [{ text: exec.content }],
        status: exec.status === 'success' ? 'success' : 'error',
      },
    };
  }

  /** Parallelize consecutive parallel-safe tools; keep writes/shell serial. */
  async function executeToolBatch(
    toolUses: ParsedToolUse[],
  ): Promise<ToolResultBlock[]> {
    const out: ToolResultBlock[] = [];
    let i = 0;
    while (i < toolUses.length) {
      const tool = toolUses[i]!;
      if (PARALLEL_SAFE_TOOLS.has(tool.name)) {
        const batch: ParsedToolUse[] = [];
        while (
          i < toolUses.length &&
          PARALLEL_SAFE_TOOLS.has(toolUses[i]!.name)
        ) {
          batch.push(toolUses[i]!);
          i += 1;
        }
        if (batch.length === 1) {
          out.push(await runOneTool(batch[0]!));
        } else {
          out.push(...(await Promise.all(batch.map((t) => runOneTool(t)))));
        }
      } else {
        out.push(await runOneTool(tool));
        i += 1;
      }
    }
    return out;
  }

  try {
    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      let result = await streamOneTurn();
      messages.push({
        role: 'assistant',
        content: result.assistantContent,
      });

      // Industry pattern: auto-continue truncated text turns (no tools).
      let outputContinuations = 0;
      while (
        !result.toolUses.length &&
        result.stopReason === 'max_tokens' &&
        outputContinuations < maxOutputContinuations &&
        !signal?.aborted
      ) {
        outputContinuations += 1;
        host.emit({
          type: 'warning',
          message: `Output limit reached; continuing (${outputContinuations}/${maxOutputContinuations})…`,
        });
        messages.push({
          role: 'user',
          content: [{ text: CONTINUE_PROMPT }],
        });
        result = await streamOneTurn();
        messages.push({
          role: 'assistant',
          content: result.assistantContent,
        });
      }

      if (!result.toolUses.length) {
        const stalledAction =
          !params.readOnly &&
          isAction() &&
          !didMutatingWork &&
          actionPrompt !== CONTINUE_PROMPT;
        if (stalledAction && !actNudgeUsed && i < maxIterations - 1) {
          actNudgeUsed = true;
          host.emit({
            type: 'warning',
            message:
              'No file/terminal changes yet — nudging the agent to act…',
          });
          messages.push({
            role: 'user',
            content: [{ text: ACT_NUDGE_PROMPT }],
          });
          continue;
        }

        const actionMutating =
          !params.readOnly &&
          !stalledAction &&
          didMutatingWork &&
          isAction();

        // Soft todo gates (mirror verify nudge pattern).
        if (
          actionMutating &&
          needsTodoWriteNudge({ didTodoWrite, didMutatingWork }) &&
          todoWriteNudgesUsed < MAX_TODO_WRITE_NUDGES &&
          i < maxIterations - 1
        ) {
          todoWriteNudgesUsed += 1;
          host.emit({
            type: 'warning',
            message:
              'Changes made without a checklist — nudging the agent to call todo_write…',
          });
          messages.push({
            role: 'user',
            content: [{ text: buildTodoWriteNudgePrompt() }],
          });
          continue;
        }

        if (
          actionMutating &&
          needsTodoProgressNudge({
            todos: liveTodos,
            didTodoWrite,
            didMutatingWork,
          }) &&
          todoProgressNudgesUsed < MAX_TODO_PROGRESS_NUDGES &&
          i < maxIterations - 1
        ) {
          todoProgressNudgesUsed += 1;
          host.emit({
            type: 'warning',
            message:
              'Checklist stalled (open items, none in_progress) — nudging update…',
          });
          messages.push({
            role: 'user',
            content: [{ text: buildTodoProgressNudgePrompt(liveTodos) }],
          });
          continue;
        }

        const needsVerify =
          actionMutating && policy.verifyRequired && !policy.didVerify;
        if (
          needsVerify &&
          verifyNudgesUsed < policy.verifyPromptCap &&
          i < maxIterations - 1
        ) {
          verifyNudgesUsed += 1;
          const hard = verifyNudgesUsed > policy.maxVerifyNudges;
          host.emit({
            type: 'warning',
            message: hard
              ? `Verify still required — hard gate (${verifyNudgesUsed}/${policy.verifyPromptCap})…`
              : 'Changes made but not verified — nudging the agent to run verify…',
          });
          host.emit({ type: 'phase', phase: 'verify' });
          messages.push({
            role: 'user',
            content: [
              { text: buildVerifyNudgePrompt(policy.verify.commands) },
            ],
          });
          continue;
        }

        // Adversarial read-only review before declaring success after mutations.
        if (
          actionMutating &&
          !needsVerify &&
          depth === 0 &&
          verifyReviewsUsed < MAX_VERIFY_REVIEWS &&
          i < maxIterations - 1
        ) {
          verifyReviewsUsed += 1;
          host.emit({
            type: 'warning',
            message: 'Running read-only verify review…',
          });
          host.emit({ type: 'phase', phase: 'verify' });
          const review = await runSubagent({
            host,
            name: 'verify-review',
            prompt: buildVerifyReviewPrompt(actionPrompt),
            signal,
            depth: depth + 1,
            region: params.region,
            client: params.client,
            modelId: params.modelId,
            sharedSkills: params.sharedSkills,
            officialSkillsJsonPath: params.officialSkillsJsonPath,
            skillRoots: params.skillRoots,
            includeUserGlobalSkills: params.includeUserGlobalSkills,
            attachments: params.attachments,
          });
          if (!isReviewOk(review)) {
            messages.push({
              role: 'user',
              content: [
                {
                  text: [
                    'Verify review found issues before marking the task done:',
                    review,
                    '',
                    'Fix the issues (write_file / edit_file / apply_patch / run_terminal), update todos, then continue.',
                  ].join('\n'),
                },
              ],
            });
            continue;
          }
        }

        // Blocking Stop hooks (settings.hooks.Stop) — must exit 0 before clean done.
        const wantsCleanDone = !stalledAction && !needsVerify;
        const stopHooks = workspaceConfig.settings.hooks.Stop;
        if (
          wantsCleanDone &&
          depth === 0 &&
          stopHooks.length > 0 &&
          stopHookNudgesUsed < MAX_STOP_HOOK_NUDGES &&
          i < maxIterations - 1
        ) {
          const root = host.getWorkspaceRoot();
          if (root) {
            host.emit({
              type: 'warning',
              message: 'Running Stop hooks…',
            });
            const stopResult = await runStopHooks({
              workspaceRoot: root,
              hooks: stopHooks,
              reason: result.stopReason || 'end_turn',
              didMutatingWork,
              signal,
            });
            if (!stopResult.ok) {
              stopHookNudgesUsed += 1;
              host.emit({
                type: 'warning',
                message: `Stop hook blocked completion (${stopHookNudgesUsed}/${MAX_STOP_HOOK_NUDGES})…`,
              });
              messages.push({
                role: 'user',
                content: [
                  { text: buildStopHookNudgePrompt(stopResult.failures) },
                ],
              });
              continue;
            }
          }
        }

        host.emit({ type: 'phase', phase: 'verify' });
        emitObserveSummary();
        host.emit({
          type: 'telemetry',
          name: 'session_complete',
          counters: telemetry.counters,
        });
        // Never report a clean end_turn while verify.required is unmet.
        const reason = stalledAction
          ? 'incomplete'
          : needsVerify
            ? 'unverified'
            : stopHookNudgesUsed >= MAX_STOP_HOOK_NUDGES &&
                workspaceConfig.settings.hooks.Stop.length > 0 &&
                wantsCleanDone
              ? 'stop_hook_failed'
              : result.stopReason || 'end_turn';
        persistSession(params, messages);
        host.emit({
          type: 'done',
          reason,
          canContinue:
            reason === 'max_tokens' ||
            stalledAction ||
            reason === 'incomplete' ||
            reason === 'unverified' ||
            reason === 'stop_hook_failed',
          turnId,
        });
        return;
      }

      const toolResults = await executeToolBatch(result.toolUses);
      messages.push({
        role: 'user',
        content: toolResults,
      });

      if (stuckLoopStop) {
        host.emit({ type: 'phase', phase: 'verify' });
        emitObserveSummary();
        host.emit({
          type: 'telemetry',
          name: 'session_complete',
          counters: telemetry.counters,
        });
        persistSession(params, messages);
        host.emit({
          type: 'done',
          reason: 'stuck_tool_loop',
          canContinue: false,
          turnId,
        });
        return;
      }
    }

    host.emit({ type: 'phase', phase: 'verify' });
    emitObserveSummary();
    host.emit({
      type: 'telemetry',
      name: 'session_complete',
      counters: telemetry.counters,
    });
    const unverifiedAtCap =
      !params.readOnly &&
      didMutatingWork &&
      isAction() &&
      policy.verifyRequired &&
      !policy.didVerify;
    persistSession(params, messages);
    host.emit({
      type: 'done',
      reason: unverifiedAtCap ? 'unverified' : 'max_iterations',
      canContinue: true,
      turnId,
    });
  } finally {
    await mcp?.close();
    await mcpServerRegistry?.closeAll();
  }
}

async function runPlanThenExecute(params: RunLoopParams): Promise<void> {
  const { host, signal } = params;
  const boundedCfg = resolveBoundedExecutorConfig(params.boundedExecutor);
  const autoApprove =
    params.autoApprovePlan ?? boundedCfg.interactive === false;

  let task = params.prompt;
  let approvedPlan: string | null = params.approvedPlan ?? null;

  for (let round = 0; round < 3 && !approvedPlan; round++) {
    host.emit({
      type: 'warning',
      message:
        round === 0
          ? 'Phase 2: running Planner subagent (schema-restricted)…'
          : `Phase 2: Planner revise round ${round + 1}…`,
    });

    let lastPlanPath: string | null = null;
    const summary = await runSubagent({
      host,
      name: 'Planner',
      prompt: buildPlannerUserPrompt(task),
      signal,
      depth: 1,
      role: 'planner',
      region: params.region,
      client: params.client,
      modelId: params.modelId,
      projectMemory: params.projectMemory,
      sharedSkills: params.sharedSkills,
      officialSkillsJsonPath: params.officialSkillsJsonPath,
      skillRoots: params.skillRoots,
      includeUserGlobalSkills: params.includeUserGlobalSkills,
      attachments: params.attachments,
      onPlanSubmitted: (p) => {
        lastPlanPath = p;
      },
    });

    if (!lastPlanPath) {
      host.emit({
        type: 'warning',
        message:
          'Planner finished without submit_plan. Stopping plan-then-execute.',
      });
      host.emit({
        type: 'done',
        reason: 'incomplete',
        canContinue: true,
        turnId: params.turnId,
      });
      host.emit({
        type: 'telemetry',
        name: 'planner_missing_submit',
        detail: summary.slice(0, 500),
      });
      return;
    }

    const planSession = {
      autoApprove,
      approvedPlan: null as string | null,
      approvedPlanPath: null as string | null,
      reviseFeedback: null as string | null,
    };

    const present = await executeTool({
      host,
      tool: {
        toolUseId: randomUUID(),
        name: 'present_plan',
        input: { plan_path: lastPlanPath },
      },
      planSession,
      signal,
    });

    if (planSession.approvedPlan) {
      approvedPlan = planSession.approvedPlan;
      host.emit({
        type: 'telemetry',
        name: autoApprove ? 'plan.auto_approved' : 'plan.approved',
        detail: approvedPlan.slice(0, 8_000),
        counters: { plan_chars: approvedPlan.length },
      });
      host.emit({
        type: 'warning',
        message: params.planOnly
          ? `Plan approved (${planSession.approvedPlanPath ?? lastPlanPath}). planOnly — skipping execute.`
          : `Plan approved (${planSession.approvedPlanPath ?? lastPlanPath}). Executing…`,
      });
      break;
    }

    if (planSession.reviseFeedback) {
      task = [
        params.prompt,
        '',
        '# Revision feedback from user',
        planSession.reviseFeedback,
        '',
        `# Prior plan (${lastPlanPath})`,
        'Revise and call submit_plan again.',
      ].join('\n');
      continue;
    }

    host.emit({
      type: 'warning',
      message: `present_plan did not approve or revise: ${present.content}`,
    });
    host.emit({
      type: 'done',
      reason: 'incomplete',
      canContinue: true,
      turnId: params.turnId,
    });
    return;
  }

  if (!approvedPlan) {
    host.emit({
      type: 'done',
      reason: 'incomplete',
      canContinue: true,
      turnId: params.turnId,
    });
    return;
  }

  if (params.planOnly) {
    host.emit({
      type: 'done',
      reason: 'plan_ready',
      canContinue: true,
      turnId: params.turnId,
    });
    return;
  }

  await runFullLoop({
    ...params,
    mode: 'full',
    readOnly: false,
    approvedPlan,
    actionBias: params.actionBias ?? 'always',
    // Avoid re-entering plan-then-execute via intent heuristic.
    plannerFirstOnIntent: false,
  });
}

async function runSubagent(params: {
  host: HostAdapter;
  name: string;
  prompt: string;
  signal?: AbortSignal;
  depth: number;
  role?: 'planner' | 'default';
  region?: string;
  client?: import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient;
  modelId?: string;
  projectMemory?: import('./project-memory.js').ProjectMemoryBridge | null;
  sharedSkills?: SharedSkillsBridge | null;
  officialSkillsJsonPath?: string;
  skillRoots?: string[];
  includeUserGlobalSkills?: boolean;
  /** Forwarded for planner / review / explore so image/PDF context is visible. */
  attachments?: SubmitAttachment[];
  onPlanSubmitted?: (planPath: string) => void;
}): Promise<string> {
  const chunks: string[] = [];
  const wrapping = wrapHost(params.host, (event) => {
    if (event.type === 'token_delta') chunks.push(event.text);
    if (
      event.type === 'tool_card' ||
      event.type === 'approval_request' ||
      event.type === 'error' ||
      event.type === 'todos' ||
      event.type === 'warning'
    ) {
      params.host.emit(event);
    }
  });

  const isPlanner = params.role === 'planner';

  await runFullLoop({
    host: wrapping,
    prompt: isPlanner
      ? params.prompt
      : `[Sub-agent: ${params.name}]\n${params.prompt}\n\nReturn a concise summary of findings. Do not write files.`,
    signal: params.signal,
    mode: 'full',
    readOnly: true,
    actionBias: 'never',
    subagentsEnabled: false,
    includePhaseB: false,
    depth: params.depth,
    maxIterations: isPlanner ? 12 : 8,
    projectMemory: isPlanner ? params.projectMemory : undefined,
    sharedSkills: params.sharedSkills,
    officialSkillsJsonPath: params.officialSkillsJsonPath,
    skillRoots: params.skillRoots,
    includeUserGlobalSkills: params.includeUserGlobalSkills,
    attachments: params.attachments,
    region: params.region,
    client: params.client,
    modelId: params.modelId,
    plannerMode: isPlanner,
    toolAllowlist: isPlanner ? PLANNER_TOOL_ALLOWLIST : undefined,
    onPlanSubmitted: params.onPlanSubmitted,
    plannerFirstOnIntent: false,
    boundedExecutor: { interactive: false },
  });

  const summary = chunks.join('').trim();
  return summary || '(sub-agent finished with no text)';
}

/** Preserve HostAdapter method binding (class instances do not spread). */
function wrapHost(
  host: HostAdapter,
  emit: HostAdapter['emit'],
): HostAdapter {
  return {
    readFile: (p) => host.readFile(p),
    writeFile: (p, c) => host.writeFile(p, c),
    deleteFile: host.deleteFile ? (p) => host.deleteFile!(p) : undefined,
    listDir: (p) => host.listDir(p),
    search: (p, o) => host.search(p, o),
    glob: host.glob ? (p, o) => host.glob!(p, o) : undefined,
    applyDiff: host.applyDiff
      ? (p, d) => host.applyDiff!(p, d)
      : undefined,
    runTerminal: (c, o) => host.runTerminal(c, o),
    startBackgroundTerminal: host.startBackgroundTerminal
      ? (c, o) => host.startBackgroundTerminal!(c, o)
      : undefined,
    pollBackgroundTerminal: host.pollBackgroundTerminal
      ? (id) => host.pollBackgroundTerminal!(id)
      : undefined,
    killBackgroundTerminal: host.killBackgroundTerminal
      ? (id) => host.killBackgroundTerminal!(id)
      : undefined,
    killAllTerminals: host.killAllTerminals
      ? () => host.killAllTerminals!()
      : undefined,
    killInteractiveTerminalSessions: host.killInteractiveTerminalSessions
      ? () => host.killInteractiveTerminalSessions!()
      : undefined,
    startTerminalSession: host.startTerminalSession
      ? (p) => host.startTerminalSession!(p)
      : undefined,
    writeTerminalSession: host.writeTerminalSession
      ? (id, input, o) => host.writeTerminalSession!(id, input, o)
      : undefined,
    readTerminalSession: host.readTerminalSession
      ? (id, o) => host.readTerminalSession!(id, o)
      : undefined,
    closeTerminalSession: host.closeTerminalSession
      ? (id) => host.closeTerminalSession!(id)
      : undefined,
    listTerminalSessions: host.listTerminalSessions
      ? () => host.listTerminalSessions!()
      : undefined,
    showDiffPreview: (p, b, a, m) => host.showDiffPreview(p, b, a, m),
    confirmCommand: (c, m) => host.confirmCommand(c, m),
    askUser: (p) => host.askUser(p),
    resolveApproval: (id, d, sessionId) =>
      host.resolveApproval(id, d, sessionId),
    resolveQuestion: (id, a) => host.resolveQuestion(id, a),
    getAutonomy: () => host.getAutonomy(),
    setAutonomy: (l) => host.setAutonomy(l),
    gatherMeta: host.gatherMeta
      ? (s) => host.gatherMeta!(s)
      : undefined,
    getWorkspaceRoot: () => host.getWorkspaceRoot(),
    isTrustedWorkspace: () => host.isTrustedWorkspace(),
    secrets: host.secrets,
    persistTodos: host.persistTodos
      ? (t) => host.persistTodos!(t)
      : undefined,
    loadTodos: host.loadTodos ? () => host.loadTodos!() : undefined,
    clearTodos: host.clearTodos ? () => host.clearTodos!() : undefined,
    persistAgentSession: host.persistAgentSession
      ? (s) => host.persistAgentSession!(s)
      : undefined,
    loadAgentSession: host.loadAgentSession
      ? () => host.loadAgentSession!()
      : undefined,
    clearAgentSession: host.clearAgentSession
      ? () => host.clearAgentSession!()
      : undefined,
    emit,
  };
}

export type LoopPhase = 'gather' | 'act' | 'verify';
