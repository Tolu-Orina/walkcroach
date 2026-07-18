import type { Message } from '@aws-sdk/client-bedrock-runtime';
import type { HostAdapter } from './host.js';
import { streamConverseTurn } from './bedrock.js';
import { assembleSystemBlocks, buildUserTurn } from './prompt.js';
import { toBedrockTools } from './tools/defs.js';
import { executeTool } from './tools/execute.js';
import { readWalkcroachMd } from './memory-local.js';
import { CockroachMcpClient, type McpConfig } from './mcp.js';
import { SkillsRegistry, defaultSkillRoots } from './skills.js';
import { TelemetrySink } from './telemetry.js';
import type { ProjectMemoryBridge } from './project-memory.js';

export const DEFAULT_MAX_ITERATIONS = 16;
export const DEFAULT_MAX_SUBAGENTS = 3;

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
};

function assertTrusted(host: HostAdapter): void {
  if (!host.isTrustedWorkspace()) {
    throw new Error(
      'Workspace is not trusted. Agentic actions are disabled until you trust this folder (NFR-D07).',
    );
  }
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
  const meta = (await host.gatherMeta?.(signal)) ?? {};
  const system = assembleSystemBlocks({
    walkcroachMd,
    skillsCatalog: includePhaseB ? skills.catalogText() : undefined,
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
            'recall_project_memory',
          ].includes(t.toolSpec?.name ?? ''),
        )
      : toBedrockTools({
          includeSubagents: subagentsEnabled,
          includePhaseB,
          includePhaseC,
        })
  ) as import('@aws-sdk/client-bedrock-runtime').ToolConfiguration['tools'];

  const messages: Message[] = [
    {
      role: 'user',
      content: [
        {
          text: buildUserTurn({
            prompt,
            gitStatus: meta.gitStatus,
            workspaceRoot: host.getWorkspaceRoot(),
            mcpConnected: Boolean(mcp?.connected),
            mcpTools: mcp?.listTools().map((t) => t.name),
            linkedProjectId: params.projectMemory?.projectId,
            linkedProjectName: params.projectMemory?.projectName,
          }),
        },
      ],
    },
  ];

  host.emit({ type: 'phase', phase: 'act' });

  try {
    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const gen = streamConverseTurn({
        system,
        messages,
        tools,
        signal,
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

      const result = turn.value;
      messages.push({
        role: 'assistant',
        content: result.assistantContent,
      });

      if (!result.toolUses.length) {
        host.emit({ type: 'phase', phase: 'verify' });
        host.emit({
          type: 'telemetry',
          name: 'session_complete',
          counters: telemetry.counters,
        });
        host.emit({ type: 'done', reason: result.stopReason || 'complete' });
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
    host.emit({
      type: 'done',
      reason: 'max_iterations',
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
    applyDiff: host.applyDiff
      ? (p, d) => host.applyDiff!(p, d)
      : undefined,
    runTerminal: (c, o) => host.runTerminal(c, o),
    showDiffPreview: (p, b, a, m) => host.showDiffPreview(p, b, a, m),
    confirmCommand: (c, m) => host.confirmCommand(c, m),
    resolveApproval: (id, d) => host.resolveApproval(id, d),
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
