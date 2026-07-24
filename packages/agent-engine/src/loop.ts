import type { Message } from '@aws-sdk/client-bedrock-runtime';
import type { HostAdapter } from './host.js';
import {
  streamConverseTurn,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type ConverseTurnResult,
  type ParsedToolUse,
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
import { CockroachMcpClient, type McpConfig } from './mcp.js';
import { SkillsRegistry, defaultSkillRoots } from './skills.js';
import { TelemetrySink } from './telemetry.js';
import type { ProjectMemoryBridge } from './project-memory.js';
import { cloneMessages, trimSessionMessages, appendUserFollowUp } from './session.js';
import { compactSessionMessages } from './compact.js';
import { loadWorkspaceAgentConfig } from './workspace-config.js';
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

export const DEFAULT_MAX_ITERATIONS = 24;
export const DEFAULT_MAX_SUBAGENTS = 3;

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
  /** Per-turn Bedrock output budget (default DEFAULT_MAX_OUTPUT_TOKENS). */
  maxTokens?: number;
  /** Auto-continue rounds on max_tokens (default DEFAULT_MAX_OUTPUT_CONTINUATIONS). */
  maxOutputContinuations?: number;
  /**
   * Prior Bedrock messages for multi-turn continuity (Continue / follow-ups).
   * When set with followUp, prompt is appended as a lightweight user turn.
   */
  priorMessages?: Message[];
  /** Treat prompt as a follow-up (Continue or next user message in-session). */
  followUp?: boolean;
  /** Persist full conversation after the run (including tool turns). */
  onSessionMessages?: (messages: Message[]) => void;
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
  params.onSessionMessages?.(trimSessionMessages(cloneMessages(messages)));
}

/** Mid-loop compact (when large) else pair-safe trim. */
function prepareMessagesInPlace(messages: Message[]): void {
  const { messages: compacted, compacted: didCompact } =
    compactSessionMessages(messages);
  const next = didCompact ? compacted : trimSessionMessages(messages);
  if (next.length === messages.length && next === messages) return;
  messages.length = 0;
  messages.push(...next);
}

async function runPing(params: RunLoopParams): Promise<void> {
  const { streamPing } = await import('./bedrock.js');
  const { host, prompt, signal } = params;
  host.emit({ type: 'phase', phase: 'gather' });
  host.emit({ type: 'phase', phase: 'act' });
  const gen = streamPing({
    userText: prompt.trim().toLowerCase() === 'ping' ? undefined : prompt,
    signal,
  });
  let result = await gen.next();
  while (!result.done) {
    const ev = result.value;
    if (ev.type === 'token') host.emit({ type: 'token_delta', text: ev.text });
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
}

/**
 * Abortable gather → act → verify agent loop (Phase A + B).
 */
export async function runAgentLoop(params: RunLoopParams): Promise<void> {
  const { host, prompt, signal } = params;
  const mode =
    params.mode ??
    (prompt.trim().toLowerCase() === 'ping' ? 'ping' : 'full');

  assertTrusted(host);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  try {
    if (mode === 'ping') {
      await runPing(params);
      return;
    }

    if (mode === 'plan') {
      await runFullLoop({
        ...params,
        readOnly: true,
        mode: 'full',
        actionBias: params.actionBias ?? 'never',
      });
      return;
    }

    await runFullLoop(params);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      host.emit({ type: 'done', reason: 'cancelled' });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
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
  const maxIterations = params.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxSubagents = params.maxSubagents ?? DEFAULT_MAX_SUBAGENTS;
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const maxOutputContinuations =
    params.maxOutputContinuations ?? DEFAULT_MAX_OUTPUT_CONTINUATIONS;
  let subagentCount = 0;

  host.emit({ type: 'phase', phase: 'gather' });

  const telemetry = new TelemetrySink();
  const skills = new SkillsRegistry();
  await skills.init(defaultSkillRoots(host.getWorkspaceRoot()));

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

  const walkcroachMd = await readWalkcroachMd(host);
  const workspaceConfig = await loadWorkspaceAgentConfig(
    host.getWorkspaceRoot(),
  );
  const policy = new WorkspacePolicy(
    workspaceConfig.settings,
    workspaceConfig.verify,
  );
  const meta = (await host.gatherMeta?.(signal)) ?? {};

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

  const system = assembleSystemBlocks({
    walkcroachMd,
    skillsCatalog: includePhaseB ? skills.catalogText() : undefined,
    rulesMd: workspaceConfig.rulesMd || undefined,
  });
  const tools = (
    params.readOnly
      ? toBedrockTools({
          includeSubagents: false,
          includePhaseB: false,
          includePhaseC: Boolean(params.projectMemory),
        }).filter((t) =>
          [
            'read_file',
            'list_dir',
            'search',
            'glob',
            'ask_user',
            'recall_project_memory',
          ].includes(t.toolSpec?.name ?? ''),
        )
      : toBedrockTools({
          includeSubagents: subagentsEnabled,
          includePhaseB,
          includePhaseC,
        })
  ) as import('@aws-sdk/client-bedrock-runtime').ToolConfiguration['tools'];

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

  const messages: Message[] =
    prior.length > 0
      ? appendUserFollowUp(prior, userText)
      : [
          {
            role: 'user',
            content: [{ text: userText }],
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
  ]);
  let didMutatingWork = false;
  let actNudgeUsed = false;
  let verifyNudgesUsed = 0;
  let todoWriteNudgesUsed = 0;
  let todoProgressNudgesUsed = 0;
  let verifyReviewsUsed = 0;
  let stopHookNudgesUsed = 0;

  async function streamOneTurn(): Promise<ConverseTurnResult> {
    prepareMessagesInPlace(messages);
    const gen = streamConverseTurn({
      system,
      messages,
      tools,
      signal,
      maxTokens,
    });
    let turn = await gen.next();
    while (!turn.done) {
      const ev = turn.value;
      if (ev.type === 'token') {
        host.emit({ type: 'token_delta', text: ev.text });
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

    const exec: ToolExecResult = await executeTool({
      host,
      tool,
      signal,
      readOnly: params.readOnly,
      mcp,
      skills,
      telemetry,
      ccloudApiKey: params.ccloudApiKey,
      projectMemory: params.projectMemory,
      policy,
      spawnSubagent: subagentsEnabled
        ? async ({ name, prompt: subPrompt, signal: subSignal }) => {
            return runSubagent({
              host,
              name,
              prompt: subPrompt,
              signal: subSignal ?? signal,
              depth: depth + 1,
            });
          }
        : undefined,
    });

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
        });
        return;
      }

      const toolResults = await executeToolBatch(result.toolUses);
      messages.push({
        role: 'user',
        content: toolResults,
      });
    }

    host.emit({ type: 'phase', phase: 'verify' });
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
    });
  } finally {
    await mcp?.close();
  }
}

async function runSubagent(params: {
  host: HostAdapter;
  name: string;
  prompt: string;
  signal?: AbortSignal;
  depth: number;
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

  await runFullLoop({
    host: wrapping,
    prompt: `[Sub-agent: ${params.name}]\n${params.prompt}\n\nReturn a concise summary of findings. Do not write files.`,
    signal: params.signal,
    mode: 'full',
    readOnly: true,
    actionBias: 'never',
    subagentsEnabled: false,
    includePhaseB: false,
    depth: params.depth,
    maxIterations: 8,
    projectMemory: undefined,
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
    resolveApproval: (id, d) => host.resolveApproval(id, d),
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
    emit,
  };
}

export type LoopPhase = 'gather' | 'act' | 'verify';
