import type { Message } from '@aws-sdk/client-bedrock-runtime';
import type { HostAdapter } from './host.js';
import {
  streamConverseTurn,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type ConverseTurnResult,
} from './bedrock.js';
import {
  assembleSystemBlocks,
  buildUserTurn,
  buildFollowUpTurn,
  looksLikeActionTask,
} from './prompt.js';
import { toBedrockTools } from './tools/defs.js';
import { executeTool } from './tools/execute.js';
import { readWalkcroachMd } from './memory-local.js';
import { CockroachMcpClient, type McpConfig } from './mcp.js';
import { SkillsRegistry, defaultSkillRoots } from './skills.js';
import { TelemetrySink } from './telemetry.js';
import type { ProjectMemoryBridge } from './project-memory.js';
import { cloneMessages, trimSessionMessages, appendUserFollowUp } from './session.js';
import { loadWorkspaceAgentConfig } from './workspace-config.js';
import { WorkspacePolicy } from './workspace-policy.js';
import { runPostToolUseHooks } from './hooks.js';

export const DEFAULT_MAX_ITERATIONS = 24;
export const DEFAULT_MAX_SUBAGENTS = 3;

/** User-visible continuation prompt after max_tokens / max_iterations / stalled act. */
export const CONTINUE_PROMPT =
  'Continue the user\'s task now. Do not re-summarize the repo. Do not only list directories. Update todo_write, then call write_file / edit_file / run_terminal to finish remaining work, then briefly confirm what you did.';

/** One-shot nudge when an action task ends after exploration only. */
export const ACT_NUDGE_PROMPT =
  'You stopped before finishing. The user asked for concrete work (create/scaffold/start/fix). Call todo_write if helpful, then write_file / edit_file / run_terminal now. Use ask_user only if a real decision blocks you. Do not re-list the whole workspace.';

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

export type RunLoopParams = {
  host: HostAdapter;
  prompt: string;
  signal?: AbortSignal;
  mode?: 'ping' | 'full' | 'plan';
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
      await runFullLoop({ ...params, readOnly: true, mode: 'full' });
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

async function runFullLoop(params: RunLoopParams): Promise<void> {
  const { host, prompt, signal } = params;
  const depth = params.depth ?? 0;
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
            'todo_write',
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
      ? buildFollowUpTurn(prompt)
      : buildUserTurn({
          prompt,
          gitStatus: meta.gitStatus,
          workspaceRoot: host.getWorkspaceRoot(),
          mcpConnected: Boolean(mcp?.connected),
          mcpTools: mcp?.listTools().map((t) => t.name),
          linkedProjectId: params.projectMemory?.projectId,
          linkedProjectName: params.projectMemory?.projectName,
          verifyCommands: policy.verify.commands,
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

  host.emit({ type: 'phase', phase: 'act' });

  const MUTATING_TOOLS = new Set([
    'write_file',
    'edit_file',
    'run_terminal',
    'update_walkcroach_md',
  ]);
  let didMutatingWork = false;
  let actNudgeUsed = false;
  let verifyNudgesUsed = 0;

  async function streamOneTurn(): Promise<ConverseTurnResult> {
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
          looksLikeActionTask(actionPrompt) &&
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

        const needsVerify =
          !params.readOnly &&
          !stalledAction &&
          didMutatingWork &&
          looksLikeActionTask(actionPrompt) &&
          policy.verifyRequired &&
          !policy.didVerify;
        if (
          needsVerify &&
          verifyNudgesUsed < policy.maxVerifyNudges &&
          i < maxIterations - 1
        ) {
          verifyNudgesUsed += 1;
          host.emit({
            type: 'warning',
            message:
              'Changes made but not verified — nudging the agent to run verify…',
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

        host.emit({ type: 'phase', phase: 'verify' });
        host.emit({
          type: 'telemetry',
          name: 'session_complete',
          counters: telemetry.counters,
        });
        const reason = stalledAction
          ? 'incomplete'
          : needsVerify
            ? 'unverified'
            : result.stopReason || 'end_turn';
        persistSession(params, messages);
        host.emit({
          type: 'done',
          reason,
          canContinue:
            reason === 'max_tokens' ||
            stalledAction ||
            reason === 'incomplete' ||
            reason === 'unverified',
        });
        return;
      }

      const toolResults: Array<{
        toolResult: {
          toolUseId: string;
          content: Array<{ text: string }>;
          status: 'success' | 'error';
        };
      }> = [];

      for (const tool of result.toolUses) {
        if (tool.name === 'spawn_subagent') {
          if (!subagentsEnabled) {
            toolResults.push({
              toolResult: {
                toolUseId: tool.toolUseId,
                content: [{ text: 'Sub-agents are disabled.' }],
                status: 'error',
              },
            });
            continue;
          }
          if (subagentCount >= maxSubagents) {
            toolResults.push({
              toolResult: {
                toolUseId: tool.toolUseId,
                content: [
                  {
                    text: `Sub-agent limit reached (max ${maxSubagents}).`,
                  },
                ],
                status: 'error',
              },
            });
            continue;
          }
          subagentCount += 1;
        }

        const exec = await executeTool({
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

        if (
          MUTATING_TOOLS.has(tool.name) &&
          exec.status === 'success'
        ) {
          didMutatingWork = true;
        }

        // P2 — optional PostToolUse hooks (non-blocking).
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

        toolResults.push({
          toolResult: {
            toolUseId: exec.toolUseId,
            content: [{ text: exec.content }],
            status: exec.status === 'success' ? 'success' : 'error',
          },
        });
      }

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
      looksLikeActionTask(actionPrompt) &&
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
      event.type === 'error'
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
    emit,
  };
}

export type LoopPhase = 'gather' | 'act' | 'verify';
