import type { ContentBlock, Message } from '@aws-sdk/client-bedrock-runtime';
import type { DbClient } from '@walkcroach/db';
import {
  streamConverseTurn,
  type ParsedToolUse,
} from './bedrock.js';
import { recallProjectMemory, writeMemoryEntry } from './memory.js';
import { refreshProjectMemorySummary } from './project-memory.js';
import {
  formatProjectKnowledgeBlock,
  loadProjectKnowledge,
} from './project-knowledge.js';
import {
  appendBuildEvent,
  appendMessage,
  getSession,
  listMessages,
  setSessionStatus,
  setToolLoopGuard,
  type BedrockToolResult,
  type PendingToolState,
} from './session-store.js';
import { getToolKind, toBedrockTools } from './tools.js';
import type { AgentEvent, MemoryKind, PlanDecisionInput, ToolResultInput } from './types.js';
import {
  DEFAULT_IDENTICAL_FAILURE_LIMIT,
  afterToolResult,
  beforeToolCall,
  buildStuckLoopNudge,
  emptyToolLoopGuard,
  readPersistedToolLoopGuard,
} from './tool-loop-guard.js';
import { webExtract, webSearch } from './web-search.js';

export type LoopMode = 'plan' | 'build' | 'chat' | 'project_chat';

const MAX_INNER_TURNS = 12;
/** FR-08: approval required when unique file paths exceed this (single-file bypass). */
const PLAN_FILE_THRESHOLD = Number(process.env.PLAN_FILE_THRESHOLD ?? 3);
const IDENTICAL_FAILURE_LIMIT = Number(
  process.env.IDENTICAL_TOOL_FAILURE_LIMIT ?? DEFAULT_IDENTICAL_FAILURE_LIMIT,
);

function isFileTool(name: string): boolean {
  return name === 'write_file' || name === 'edit_file';
}

function fileReason(toolName: string): string {
  return toolName === 'write_file' ? 'create or replace file' : 'edit existing file';
}

function systemPrompt(
  mode: LoopMode,
  memoryBlock: string,
  knowledgeBlock?: string,
): string {
  const base =
    mode === 'plan'
      ? `You are WalkCroach in Plan mode. Reason about the request and outline steps.
You may use web_search, web_extract, recall_project_memory, and remember_preference.
Do NOT call write_file, edit_file, or run_terminal.`
      : mode === 'chat' || mode === 'project_chat'
        ? `You are WalkCroach Chat — a helpful assistant for the WalkCroach ecosystem.
Web search is available and preferred for current facts (web_search, then web_extract when needed).
Cite sources with titles and URLs when you used search.
${mode === 'project_chat' ? 'You are working inside a Project — obey standing instructions and use project documents when relevant.' : 'You may use recall_project_memory / remember_preference when a project is linked.'}
You cannot edit app files or run terminals in Chat mode — suggest opening App Builder for that.`
        : `You are WalkCroach in Build mode. You scaffold and edit a React + TypeScript + Vite + Tailwind app inside a project sandbox (cloud when available, otherwise local preview).
Prefer small, correct file diffs. Use write_file / edit_file for code.
Use run_terminal only when you need package installs or scripts (e.g. npm install).
Use web_search / web_extract when researching APIs or docs.
Use recall_project_memory when prior preferences/decisions may matter.
Use remember_preference when the user states a lasting style or architecture preference.
Obey project standing instructions and documents when provided.`;

  const extras = [knowledgeBlock, memoryBlock].filter(Boolean);
  return extras.length ? `${base}\n\n${extras.join('\n\n')}` : base;
}

function memoryBlockFromHits(
  hits: Array<{ kind: string; text: string }>,
): string {
  if (hits.length === 0) return '';
  return `Project memory (use when relevant):\n${hits
    .map((h) => `- [${h.kind}] ${h.text}`)
    .join('\n')}`;
}

async function buildSystemForTurn(params: {
  db: import('@walkcroach/db').DbClient;
  projectId: string;
  mode: LoopMode;
  memoryHits: Array<{ kind: string; text: string }>;
}): Promise<string> {
  const knowledge = await loadProjectKnowledge(params.db, params.projectId);
  const knowledgeBlock = knowledge
    ? formatProjectKnowledgeBlock(knowledge)
    : '';
  const promptMode: LoopMode =
    (params.mode === 'chat' || params.mode === 'project_chat') &&
    knowledge &&
    Boolean(
      knowledge.instructions?.trim() ||
        knowledge.description?.trim() ||
        knowledge.documents.length > 0,
    )
      ? 'project_chat'
      : params.mode;
  return systemPrompt(
    promptMode,
    memoryBlockFromHits(params.memoryHits),
    knowledgeBlock || undefined,
  );
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
      await refreshProjectMemorySummary(db, projectId);
      return {
        events,
        result: {
          toolUseId: tool.toolUseId,
          status: 'success',
          content: [{ text: `Stored ${kind} memory ${id}` }],
        },
      };
    }

    if (tool.name === 'web_search') {
      const query = String(tool.input.query ?? '');
      const limit = Number(tool.input.limit ?? 5);
      const result = await webSearch(query, { limit });
      await appendBuildEvent(
        db,
        sessionId,
        tool.name,
        tool.input,
        `provider=${result.provider} hits=${result.hits.length}`,
      );
      if (result.provider === 'none') {
        return {
          events,
          result: {
            toolUseId: tool.toolUseId,
            status: 'error',
            content: [
              {
                text: 'web_search unavailable: SEARXNG_URL is not configured. Tell the user search is offline and answer from known knowledge without inventing URLs.',
              },
            ],
          },
        };
      }
      const text =
        result.hits.length === 0
          ? `No results for: ${query}`
          : result.hits
              .map(
                (h, i) =>
                  `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.content.slice(0, 280)}`,
              )
              .join('\n\n');
      return {
        events,
        result: {
          toolUseId: tool.toolUseId,
          status: 'success',
          content: [{ text }],
        },
      };
    }

    if (tool.name === 'web_extract') {
      const url = String(tool.input.url ?? '');
      const extracted = await webExtract(url);
      await appendBuildEvent(
        db,
        sessionId,
        tool.name,
        tool.input,
        `url=${url} chars=${extracted.text.length}`,
      );
      return {
        events,
        result: {
          toolUseId: tool.toolUseId,
          status: 'success',
          content: [
            {
              text: `Title: ${extracted.title}\nURL: ${extracted.url}\n\n${extracted.text}`,
            },
          ],
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
 * - client_resume: yield tool_call, pause for verified POST /tool-result
 *   (queues remaining client tools in the same batch)
 */
async function* resolveToolBatch(params: {
  db: DbClient;
  sessionId: string;
  projectId: string;
  mode: LoopMode;
  toolUses: ParsedToolUse[];
  assistantContent: ContentBlock[];
  toolLoopGuard: ReturnType<typeof readPersistedToolLoopGuard>;
}): AsyncGenerator<
  AgentEvent,
  {
    pending: PendingToolState | null;
    resolved: BedrockToolResult[];
    toolLoopGuard: ReturnType<typeof readPersistedToolLoopGuard>;
    stuckStop: boolean;
  }
> {
  const resolved: BedrockToolResult[] = [];
  let pending: PendingToolState | null = null;
  let toolLoopGuard = params.toolLoopGuard;
  let stuckStop = false;

  const fileTools = params.toolUses.filter((t) => isFileTool(t.name));
  const uniquePaths = new Set(
    fileTools.map((t) => String(t.input.path ?? '')).filter(Boolean),
  );
  const needsPlanApproval =
    params.mode === 'build' &&
    uniquePaths.size > PLAN_FILE_THRESHOLD &&
    uniquePaths.size > 1;

  // Pass 1 — server tools (order preserved in resolvedResults)
  for (const tool of params.toolUses) {
    if (needsPlanApproval && isFileTool(tool.name)) continue;
    if (getToolKind(tool.name) !== 'server') continue;

    const { result, events } = await executeServerTool({
      db: params.db,
      projectId: params.projectId,
      sessionId: params.sessionId,
      tool,
    });
    for (const e of events) yield e;
    resolved.push(result);
    toolLoopGuard = afterToolResult(
      toolLoopGuard,
      tool.name,
      tool.input,
      result.status,
    );
  }

  // Pass 2 — client tools (verified apply via /tool-result; no optimistic acks)
  // When multi-file plan approval is required, gate files first and stash any
  // non-file client tools (e.g. run_terminal) to run after the plan resolves.
  const nonFileClientTools = params.toolUses.filter((t) => {
    if (isFileTool(t.name)) return false;
    return getToolKind(t.name) === 'client_resume';
  });
  const immediateClientTools = params.toolUses.filter((t) => {
    if (needsPlanApproval && isFileTool(t.name)) return false;
    if (needsPlanApproval && getToolKind(t.name) === 'client_resume') return false;
    return getToolKind(t.name) === 'client_resume';
  });

  if (needsPlanApproval && fileTools.length > 0 && !stuckStop) {
    const planId = crypto.randomUUID();
    const files = fileTools.map((t) => ({
      path: String(t.input.path ?? ''),
      reason: fileReason(t.name),
    }));
    yield {
      type: 'plan_preview',
      planId,
      files,
    };
    yield { type: 'plan_awaiting_approval', planId };
    pending = {
      awaiting: {
        toolCallId: planId,
        tool: 'plan_approval',
        args: { planId, files },
      },
      deferredToolUses: fileTools.map((t) => ({
        toolUseId: t.toolUseId,
        name: t.name,
        input: t.input,
      })),
      queuedClientTools: nonFileClientTools.map((t) => ({
        toolUseId: t.toolUseId,
        name: t.name,
        input: t.input,
      })),
      resolvedResults: [...resolved],
      assistantContent: params.assistantContent as unknown[],
    };
  } else if (immediateClientTools.length > 0 && !stuckStop) {
    const first = immediateClientTools[0]!;
    const rest = immediateClientTools.slice(1);

    const gate = beforeToolCall(
      toolLoopGuard,
      first.name,
      first.input,
      IDENTICAL_FAILURE_LIMIT,
    );
    if (gate.action === 'refuse') {
      yield {
        type: 'warning',
        message: `Blocked identical failing tool retry (${first.name})`,
      };
      await appendBuildEvent(
        params.db,
        params.sessionId,
        first.name,
        first.input,
        gate.message,
      );
      resolved.push({
        toolUseId: first.toolUseId,
        status: 'error',
        content: [{ text: gate.message }],
      });
      // Fail remaining queued tools so Bedrock gets a full result set
      for (const t of rest) {
        resolved.push({
          toolUseId: t.toolUseId,
          status: 'error',
          content: [{ text: gate.message }],
        });
      }
      stuckStop = true;
    } else {
      yield {
        type: 'tool_call',
        id: first.toolUseId,
        tool: first.name,
        args: first.input,
        awaitResult: true,
      };
      await appendBuildEvent(
        params.db,
        params.sessionId,
        first.name,
        first.input,
        'awaiting verified client tool-result',
      );
      pending = {
        awaiting: {
          toolCallId: first.toolUseId,
          tool: first.name,
          args: first.input,
        },
        resolvedResults: [...resolved],
        assistantContent: params.assistantContent as unknown[],
        queuedClientTools: rest.map((t) => ({
          toolUseId: t.toolUseId,
          name: t.name,
          input: t.input,
        })),
      };
    }
  }

  await setToolLoopGuard(params.db, params.sessionId, toolLoopGuard);
  return { pending, resolved, toolLoopGuard, stuckStop };
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

  const session = await getSession(db, sessionId);
  let toolLoopGuard = readPersistedToolLoopGuard(session?.model_config);

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
      await setToolLoopGuard(db, sessionId, emptyToolLoopGuard());
      yield { type: 'done', reason: 'complete' };
      return;
    }

    const batch = yield* resolveToolBatch({
      db,
      sessionId,
      projectId,
      mode,
      toolUses: turnResult.toolUses,
      assistantContent: turnResult.assistantContent,
      toolLoopGuard,
    });
    toolLoopGuard = batch.toolLoopGuard;

    if (batch.stuckStop) {
      const toolMsg = toolResultMessage(batch.resolved);
      await appendMessage(db, sessionId, 'user', toolMsg.content);
      messages.push(toolMsg);
      await setSessionStatus(db, sessionId, 'active', null);
      yield {
        type: 'warning',
        message: buildStuckLoopNudge(toolLoopGuard),
      };
      yield { type: 'done', reason: 'stuck_tool_loop' };
      return;
    }

    if (batch.pending?.awaiting.tool === 'plan_approval') {
      await setSessionStatus(db, sessionId, 'awaiting_plan_approval', batch.pending);
      yield { type: 'done', reason: 'awaiting_plan_approval' };
      return;
    }

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
  attachments?: Array<{
    name: string;
    mime: string;
    textPreview: string;
    byteSize?: number;
    storageKey?: string;
  }>;
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
  if (session.status === 'awaiting_plan_approval') {
    yield {
      type: 'error',
      message:
        'Session is awaiting plan approval. POST /plan-decision before a new prompt.',
    };
    yield { type: 'done', reason: 'awaiting_plan_approval' };
    return;
  }

  await params.db.query(
    `UPDATE sessions
     SET model_config = jsonb_set(COALESCE(model_config, '{}'::jsonb), '{mode}', $2::jsonb),
         updated_at = now()
     WHERE id = $1::uuid`,
    [params.sessionId, JSON.stringify(mode)],
  );
  // Fresh user prompt resets identical-failure streak
  await setToolLoopGuard(params.db, params.sessionId, emptyToolLoopGuard());

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
  await appendMessage(params.db, params.sessionId, 'user', userContent, {
    attachments: params.attachments?.length ? params.attachments : null,
  });

  const history = await listMessages(params.db, params.sessionId);
  const messages = storedToBedrockMessages(history);

  const system = await buildSystemForTurn({
    db: params.db,
    projectId: params.projectId,
    mode,
    memoryHits: hits,
  });

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
 * Resume after a verified client tool apply (POST /tool-result).
 * Drains queuedClientTools one-by-one before appending the full tool-result
 * message and continuing Converse.
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

  // Persist identical-failure streak across client resumes
  let toolLoopGuard = readPersistedToolLoopGuard(session.model_config);
  toolLoopGuard = afterToolResult(
    toolLoopGuard,
    pending.awaiting.tool,
    pending.awaiting.args,
    params.toolResult.ok ? 'success' : 'error',
  );
  await setToolLoopGuard(params.db, params.sessionId, toolLoopGuard);

  const allResultsSoFar = [...pending.resolvedResults, resumeResult];
  const queue = pending.queuedClientTools ?? [];

  // More client tools in this Converse batch — emit next, stay awaiting_tool
  if (queue.length > 0) {
    const next = queue[0]!;
    const rest = queue.slice(1);
    yield {
      type: 'tool_call',
      id: next.toolUseId,
      tool: next.name,
      args: next.input,
      awaitResult: true,
    };
    await appendBuildEvent(
      params.db,
      params.sessionId,
      next.name,
      next.input,
      'awaiting verified client tool-result',
    );
    await setSessionStatus(params.db, params.sessionId, 'awaiting_tool', {
      awaiting: {
        toolCallId: next.toolUseId,
        tool: next.name,
        args: next.input,
      },
      resolvedResults: allResultsSoFar,
      assistantContent: pending.assistantContent,
      queuedClientTools: rest,
    });
    yield { type: 'done', reason: 'awaiting_tool' };
    return;
  }

  const toolMsg = toolResultMessage(allResultsSoFar);
  await appendMessage(params.db, params.sessionId, 'user', toolMsg.content);
  await setSessionStatus(params.db, params.sessionId, 'active', null);

  if (
    !params.toolResult.ok &&
    toolLoopGuard.streak >= IDENTICAL_FAILURE_LIMIT
  ) {
    yield {
      type: 'warning',
      message: buildStuckLoopNudge(toolLoopGuard),
    };
  }

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
  const system = await buildSystemForTurn({
    db: params.db,
    projectId: params.projectId,
    mode,
    memoryHits: hits,
  });

  yield* runAgentLoop({
    db: params.db,
    sessionId: params.sessionId,
    projectId: params.projectId,
    mode,
    messages,
    system,
  });
}

async function* executeDeferredFileTools(params: {
  db: DbClient;
  sessionId: string;
  deferred: NonNullable<PendingToolState['deferredToolUses']>;
  resolvedResults: BedrockToolResult[];
  assistantContent: unknown[];
  /** Non-file client tools stashed while plan was pending (e.g. run_terminal). */
  existingQueued?: NonNullable<PendingToolState['queuedClientTools']>;
}): AsyncGenerator<
  AgentEvent,
  { pending: PendingToolState | null; resolved: BedrockToolResult[] }
> {
  if (params.deferred.length === 0) {
    const queued = params.existingQueued ?? [];
    if (queued.length === 0) {
      return { pending: null, resolved: params.resolvedResults };
    }
    const [first, ...rest] = queued;
    yield {
      type: 'tool_call',
      id: first!.toolUseId,
      tool: first!.name,
      args: first!.input,
      awaitResult: true,
    };
    await appendBuildEvent(
      params.db,
      params.sessionId,
      first!.name,
      first!.input,
      'plan resolved — awaiting verified client tool-result',
    );
    return {
      pending: {
        awaiting: {
          toolCallId: first!.toolUseId,
          tool: first!.name,
          args: first!.input,
        },
        resolvedResults: params.resolvedResults,
        assistantContent: params.assistantContent,
        queuedClientTools: rest,
      },
      resolved: params.resolvedResults,
    };
  }
  const [first, ...rest] = params.deferred;
  yield {
    type: 'tool_call',
    id: first!.toolUseId,
    tool: first!.name,
    args: first!.input,
    awaitResult: true,
  };
  await appendBuildEvent(
    params.db,
    params.sessionId,
    first!.name,
    first!.input,
    'plan approved — awaiting verified client apply',
  );
  return {
    pending: {
      awaiting: {
        toolCallId: first!.toolUseId,
        tool: first!.name,
        args: first!.input,
      },
      resolvedResults: params.resolvedResults,
      assistantContent: params.assistantContent,
      queuedClientTools: [...rest, ...(params.existingQueued ?? [])],
    },
    resolved: params.resolvedResults,
  };
}

/** Close unresolved Bedrock tool_use blocks so the session can continue. */
async function closeUnresolvedClientTools(params: {
  db: DbClient;
  sessionId: string;
  pending: PendingToolState;
  reason: string;
}): Promise<void> {
  const cancelled: BedrockToolResult[] = [];
  for (const t of params.pending.deferredToolUses ?? []) {
    cancelled.push({
      toolUseId: t.toolUseId,
      status: 'error',
      content: [{ text: params.reason }],
    });
  }
  for (const t of params.pending.queuedClientTools ?? []) {
    cancelled.push({
      toolUseId: t.toolUseId,
      status: 'error',
      content: [{ text: params.reason }],
    });
  }
  const allResults = [...params.pending.resolvedResults, ...cancelled];
  if (allResults.length === 0) return;
  const toolMsg = toolResultMessage(allResults);
  await appendMessage(params.db, params.sessionId, 'user', toolMsg.content);
}

/**
 * Resume after user approves, adjusts, or cancels a file-write plan.
 */
export async function* continueAfterPlanDecision(params: {
  db: DbClient;
  sessionId: string;
  projectId: string;
  decision: PlanDecisionInput;
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
  if (!pending || session.status !== 'awaiting_plan_approval') {
    yield {
      type: 'error',
      message: 'Session has no plan awaiting approval',
    };
    yield { type: 'done', reason: 'complete' };
    return;
  }
  if (pending.awaiting.tool !== 'plan_approval') {
    yield { type: 'error', message: 'Pending state is not a plan approval' };
    yield { type: 'done', reason: 'complete' };
    return;
  }

  const storedPlanId = String(pending.awaiting.args.planId ?? '');
  if (storedPlanId !== params.decision.planId) {
    yield {
      type: 'error',
      message: `Expected planId ${storedPlanId}, got ${params.decision.planId}`,
    };
    yield { type: 'done', reason: 'awaiting_plan_approval' };
    return;
  }

  const mode: LoopMode =
    (session.model_config?.mode as LoopMode | undefined) ?? 'build';

  if (params.decision.decision === 'cancel') {
    await closeUnresolvedClientTools({
      db: params.db,
      sessionId: params.sessionId,
      pending,
      reason: 'Plan cancelled — no files were written.',
    });
    await setSessionStatus(params.db, params.sessionId, 'active', null);
    yield {
      type: 'error',
      message: 'Plan cancelled — no files were written.',
    };
    yield { type: 'done', reason: 'complete' };
    return;
  }

  if (params.decision.decision === 'adjust') {
    const adjustment =
      params.decision.adjustment?.trim() ||
      'Please revise the file plan based on my feedback.';
    await closeUnresolvedClientTools({
      db: params.db,
      sessionId: params.sessionId,
      pending,
      reason: 'Plan adjusted — previous proposed file writes were not applied.',
    });
    await setSessionStatus(params.db, params.sessionId, 'active', null);
    await appendMessage(params.db, params.sessionId, 'user', [
      { text: `[Plan adjustment] ${adjustment}` },
    ]);
    const history = await listMessages(params.db, params.sessionId);
    const messages = storedToBedrockMessages(history);
    const hits = await recallProjectMemory({
      db: params.db,
      projectId: params.projectId,
      query: adjustment,
      limit: 5,
    });
    yield {
      type: 'memory_recalled',
      count: hits.length,
      kinds: [...new Set(hits.map((h) => h.kind))],
    };
    const system = await buildSystemForTurn({
      db: params.db,
      projectId: params.projectId,
      mode,
      memoryHits: hits,
    });
    yield* runAgentLoop({
      db: params.db,
      sessionId: params.sessionId,
      projectId: params.projectId,
      mode,
      messages,
      system,
    });
    return;
  }

  const deferred = pending.deferredToolUses ?? [];
  const started = yield* executeDeferredFileTools({
    db: params.db,
    sessionId: params.sessionId,
    deferred,
    resolvedResults: pending.resolvedResults,
    assistantContent: pending.assistantContent,
    existingQueued: pending.queuedClientTools ?? [],
  });

  if (started.pending) {
    await setSessionStatus(
      params.db,
      params.sessionId,
      'awaiting_tool',
      started.pending,
    );
    yield { type: 'done', reason: 'awaiting_tool' };
    return;
  }

  const toolMsg = toolResultMessage(started.resolved);
  await appendMessage(params.db, params.sessionId, 'user', toolMsg.content);
  await setSessionStatus(params.db, params.sessionId, 'active', null);

  const history = await listMessages(params.db, params.sessionId);
  const messages = storedToBedrockMessages(history);
  const hits = await recallProjectMemory({
    db: params.db,
    projectId: params.projectId,
    query: 'plan approved file writes',
    limit: 3,
  });
  yield {
    type: 'memory_recalled',
    count: hits.length,
    kinds: [...new Set(hits.map((h) => h.kind))],
  };
  const system = await buildSystemForTurn({
    db: params.db,
    projectId: params.projectId,
    mode,
    memoryHits: hits,
  });
  yield* runAgentLoop({
    db: params.db,
    sessionId: params.sessionId,
    projectId: params.projectId,
    mode,
    messages,
    system,
  });
}
