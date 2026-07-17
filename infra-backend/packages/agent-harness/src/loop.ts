import type { ContentBlock, Message } from '@aws-sdk/client-bedrock-runtime';
import type { DbClient } from '@walkcroach/db';
import {
  streamConverseTurn,
  type ParsedToolUse,
} from './bedrock.js';
import { recallProjectMemory, writeMemoryEntry } from './memory.js';
import {
  appendBuildEvent,
  appendMessage,
  getSession,
  listMessages,
  setSessionStatus,
  type BedrockToolResult,
  type PendingToolState,
} from './session-store.js';
import { getToolKind, toBedrockTools } from './tools.js';
import type { AgentEvent, MemoryKind, ToolResultInput } from './types.js';

export type LoopMode = 'plan' | 'build';

const MAX_INNER_TURNS = 12;

function systemPrompt(mode: LoopMode, memoryBlock: string): string {
  const base =
    mode === 'plan'
      ? `You are WalkCroach in Plan mode. Reason about the request and outline steps.
You may use recall_project_memory and remember_preference.
Do NOT call write_file, edit_file, or run_terminal.`
      : `You are WalkCroach in Build mode. You scaffold and edit a React + TypeScript + Vite + Tailwind app.
Prefer small, correct file diffs. Use write_file / edit_file for code.
Use run_terminal only when you need package installs or scripts (e.g. npm install).
Use recall_project_memory when prior preferences/decisions may matter.
Use remember_preference when the user states a lasting style or architecture preference.`;

  return memoryBlock ? `${base}\n\n${memoryBlock}` : base;
}

function memoryBlockFromHits(
  hits: Array<{ kind: string; text: string }>,
): string {
  if (hits.length === 0) return '';
  return `Project memory (use when relevant):\n${hits
    .map((h) => `- [${h.kind}] ${h.text}`)
    .join('\n')}`;
}

function storedToBedrockMessages(
  stored: Array<{ role: string; content: unknown }>,
): Message[] {
  const out: Message[] = [];
  for (const m of stored) {
    if (m.role === 'user' || m.role === 'assistant') {
      out.push({
        role: m.role,
        content: m.content as ContentBlock[],
      });
    }
  }
  return out;
}

function toolResultMessage(results: BedrockToolResult[]): Message {
  return {
    role: 'user',
    content: results.map((r) => ({
      toolResult: {
        toolUseId: r.toolUseId,
        content: r.content,
        status: r.status,
      },
    })),
  };
}

async function executeServerTool(params: {
  db: DbClient;
  projectId: string;
  sessionId: string;
  tool: ParsedToolUse;
}): Promise<{ result: BedrockToolResult; events: AgentEvent[] }> {
  const { db, projectId, sessionId, tool } = params;
  const events: AgentEvent[] = [];

  try {
    if (tool.name === 'recall_project_memory') {
      const query = String(tool.input.query ?? '');
      const limit = Number(tool.input.limit ?? 5);
      const hits = await recallProjectMemory({ db, projectId, query, limit });
      events.push({
        type: 'memory_recalled',
        count: hits.length,
        kinds: [...new Set(hits.map((h) => h.kind))],
      });
      await appendBuildEvent(
        db,
        sessionId,
        tool.name,
        tool.input,
        `hits=${hits.length}`,
      );
      return {
        events,
        result: {
          toolUseId: tool.toolUseId,
          status: 'success',
          content: [
            {
              text:
                hits.length === 0
                  ? 'No matching memories.'
                  : hits
                      .map(
                        (h) =>
                          `[${h.kind}] (dist=${h.distance?.toFixed(3) ?? '?'}) ${h.text}`,
                      )
                      .join('\n'),
            },
          ],
        },
      };
    }

    if (tool.name === 'remember_preference') {
      const text = String(tool.input.text ?? '');
      const kind = (tool.input.kind as MemoryKind) || 'preference';
      const id = await writeMemoryEntry({
        db,
        projectId,
        sourceSurface: 'web',
        kind: kind === 'decision' ? 'decision' : 'preference',
        text,
      });
      await appendBuildEvent(
        db,
        sessionId,
        tool.name,
        tool.input,
        `memory_id=${id}`,
      );
      return {
        events,
        result: {
          toolUseId: tool.toolUseId,
          status: 'success',
          content: [{ text: `Stored ${kind} memory ${id}` }],
        },
      };
    }

    return {
      events,
      result: {
        toolUseId: tool.toolUseId,
        status: 'error',
        content: [{ text: `Unknown server tool: ${tool.name}` }],
      },
    };
  } catch (err) {
    return {
      events,
      result: {
        toolUseId: tool.toolUseId,
        status: 'error',
        content: [{ text: `Tool error: ${String(err)}` }],
      },
    };
  }
}

/**
 * Process tool_use batch from one Converse turn.
 * - server tools: execute now
 * - client_local: yield tool_call, auto-ack success for Bedrock
 * - client_resume: yield tool_call, return pending state (caller must stop)
 */
async function* resolveToolBatch(params: {
  db: DbClient;
  sessionId: string;
  projectId: string;
  toolUses: ParsedToolUse[];
  assistantContent: ContentBlock[];
}): AsyncGenerator<
  AgentEvent,
  { pending: PendingToolState | null; resolved: BedrockToolResult[] }
> {
  const resolved: BedrockToolResult[] = [];
  let pending: PendingToolState | null = null;

  for (const tool of params.toolUses) {
    const kind = getToolKind(tool.name);

    if (kind === 'server') {
      const { result, events } = await executeServerTool({
        db: params.db,
        projectId: params.projectId,
        sessionId: params.sessionId,
        tool,
      });
      for (const e of events) yield e;
      resolved.push(result);
      continue;
    }

    // Client-visible tools
    yield {
      type: 'tool_call',
      id: tool.toolUseId,
      tool: tool.name,
      args: tool.input,
      awaitResult: kind === 'client_resume',
    };

    if (kind === 'client_local') {
      await appendBuildEvent(
        params.db,
        params.sessionId,
        tool.name,
        tool.input,
        'auto-acked (client_local)',
      );
      resolved.push({
        toolUseId: tool.toolUseId,
        status: 'success',
        content: [
          {
            text: `Acknowledged ${tool.name}; client will apply in WebContainer.`,
          },
        ],
      });
      continue;
    }

    // client_resume — pause after emitting; keep prior resolved results
    await appendBuildEvent(
      params.db,
      params.sessionId,
      tool.name,
      tool.input,
      'awaiting client tool-result',
    );
    pending = {
      awaiting: {
        toolCallId: tool.toolUseId,
        tool: tool.name,
        args: tool.input,
      },
      resolvedResults: [...resolved],
      assistantContent: params.assistantContent as unknown[],
    };
    // Do not process further tools in this batch until resume
    break;
  }

  return { pending, resolved };
}

async function* runAgentLoop(params: {
  db: DbClient;
  sessionId: string;
  projectId: string;
  mode: LoopMode;
  messages: Message[];
  system: string;
}): AsyncGenerator<AgentEvent> {
  const { db, sessionId, projectId, mode } = params;
  let messages = [...params.messages];
  const tools = toBedrockTools(mode);

  for (let turn = 0; turn < MAX_INNER_TURNS; turn++) {
    const turnResult = yield* streamConverseTurn({
      system: params.system,
      messages,
      tools,
    });

    if (turnResult.assistantContent.length > 0) {
      await appendMessage(db, sessionId, 'assistant', turnResult.assistantContent);
      messages.push({
        role: 'assistant',
        content: turnResult.assistantContent,
      });
    }

    if (turnResult.toolUses.length === 0) {
      await setSessionStatus(db, sessionId, 'active', null);
      yield { type: 'done', reason: 'complete' };
      return;
    }

    const batch = yield* resolveToolBatch({
      db,
      sessionId,
      projectId,
      toolUses: turnResult.toolUses,
      assistantContent: turnResult.assistantContent,
    });

    if (batch.pending) {
      await setSessionStatus(db, sessionId, 'awaiting_tool', batch.pending);
      yield { type: 'done', reason: 'awaiting_tool' };
      return;
    }

    // All tools resolved in-process — feed results and continue
    const toolMsg = toolResultMessage(batch.resolved);
    await appendMessage(db, sessionId, 'user', toolMsg.content);
    messages.push(toolMsg);
  }

  yield {
    type: 'error',
    message: `Exceeded max inner turns (${MAX_INNER_TURNS})`,
  };
  yield { type: 'done', reason: 'complete' };
}

/**
 * Start or continue a user prompt turn.
 */
export async function* runPromptTurn(params: {
  db: DbClient;
  sessionId: string;
  projectId: string;
  message: string;
  mode?: LoopMode;
}): AsyncGenerator<AgentEvent> {
  const mode = params.mode ?? 'build';
  const session = await getSession(params.db, params.sessionId);
  if (!session) {
    yield { type: 'error', message: `Unknown session ${params.sessionId}` };
    yield { type: 'done', reason: 'complete' };
    return;
  }
  if (session.project_id !== params.projectId) {
    yield { type: 'error', message: 'projectId does not match session' };
    yield { type: 'done', reason: 'complete' };
    return;
  }
  if (session.status === 'awaiting_tool') {
    yield {
      type: 'error',
      message:
        'Session is awaiting a tool result. POST /tool-result before a new prompt.',
    };
    yield { type: 'done', reason: 'awaiting_tool' };
    return;
  }

  const hits = await recallProjectMemory({
    db: params.db,
    projectId: params.projectId,
    query: params.message,
    limit: 5,
  });
  yield {
    type: 'memory_recalled',
    count: hits.length,
    kinds: [...new Set(hits.map((h) => h.kind))],
  };

  const userContent: ContentBlock[] = [{ text: params.message }];
  await appendMessage(params.db, params.sessionId, 'user', userContent);

  const history = await listMessages(params.db, params.sessionId);
  const messages = storedToBedrockMessages(history);

  const system = systemPrompt(mode, memoryBlockFromHits(hits));

  yield* runAgentLoop({
    db: params.db,
    sessionId: params.sessionId,
    projectId: params.projectId,
    mode,
    messages,
    system,
  });
}

/**
 * Resume after WebContainer shell tool (POST /tool-result).
 */
export async function* continueAfterTool(params: {
  db: DbClient;
  sessionId: string;
  projectId: string;
  toolResult: ToolResultInput;
}): AsyncGenerator<AgentEvent> {
  const session = await getSession(params.db, params.sessionId);
  if (!session) {
    yield { type: 'error', message: `Unknown session ${params.sessionId}` };
    yield { type: 'done', reason: 'complete' };
    return;
  }
  if (session.project_id !== params.projectId) {
    yield { type: 'error', message: 'projectId does not match session' };
    yield { type: 'done', reason: 'complete' };
    return;
  }

  const pending = session.pending_tool;
  if (!pending || session.status !== 'awaiting_tool') {
    yield {
      type: 'error',
      message: 'Session has no pending tool awaiting a result',
    };
    yield { type: 'done', reason: 'complete' };
    return;
  }
  if (pending.awaiting.toolCallId !== params.toolResult.toolCallId) {
    yield {
      type: 'error',
      message: `Expected toolCallId ${pending.awaiting.toolCallId}, got ${params.toolResult.toolCallId}`,
    };
    yield { type: 'done', reason: 'awaiting_tool' };
    return;
  }

  const summary =
    params.toolResult.output ??
    params.toolResult.stdout ??
    (params.toolResult.ok ? 'ok' : 'failed');

  const resumeResult: BedrockToolResult = {
    toolUseId: params.toolResult.toolCallId,
    status: params.toolResult.ok ? 'success' : 'error',
    content: [
      {
        text: [
          summary,
          params.toolResult.stderr
            ? `stderr:\n${params.toolResult.stderr}`
            : '',
          params.toolResult.exitCode !== undefined
            ? `exitCode=${params.toolResult.exitCode}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  };

  await appendBuildEvent(
    params.db,
    params.sessionId,
    pending.awaiting.tool,
    pending.awaiting.args,
    `client result ok=${params.toolResult.ok} ${summary.slice(0, 200)}`,
  );

  const allResults = [...pending.resolvedResults, resumeResult];
  const toolMsg = toolResultMessage(allResults);
  await appendMessage(params.db, params.sessionId, 'user', toolMsg.content);
  await setSessionStatus(params.db, params.sessionId, 'active', null);

  // Rebuild conversation: history already has assistant tool_use message;
  // we just appended tool results. Load full history for next Converse.
  const history = await listMessages(params.db, params.sessionId);
  const messages = storedToBedrockMessages(history);

  const hits = await recallProjectMemory({
    db: params.db,
    projectId: params.projectId,
    query: `${pending.awaiting.tool} ${summary}`.slice(0, 500),
    limit: 3,
  });
  yield {
    type: 'memory_recalled',
    count: hits.length,
    kinds: [...new Set(hits.map((h) => h.kind))],
  };

  const mode: LoopMode =
    (session.model_config?.mode as LoopMode | undefined) ?? 'build';
  const system = systemPrompt(mode, memoryBlockFromHits(hits));

  yield* runAgentLoop({
    db: params.db,
    sessionId: params.sessionId,
    projectId: params.projectId,
    mode,
    messages,
    system,
  });
}
