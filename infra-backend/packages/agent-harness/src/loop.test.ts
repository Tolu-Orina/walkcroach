import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DbClient } from '@walkcroach/db';
import type { AgentEvent } from './types.js';

/**
 * Unit suite for the Web/Chrome agent loop.
 *
 * `loop.ts` is the widest-blast-radius file in the backend — every Web and Chrome
 * turn goes through it — and it had no dedicated tests. This covers the paths that
 * matter most if they regress: memory recall reaching the model, the session state
 * machine (which protects against double-spend and lost turns), mode escalation
 * (a privilege boundary), and loop termination.
 *
 * Mocking boundary: only modules that do I/O are mocked. `tools.ts`,
 * `tool-loop-guard.ts` and `attachment-content.ts` are left REAL — they are pure
 * and have no runtime imports, so mode→tool wiring and tool-kind routing are
 * genuinely exercised rather than stubbed into agreement.
 */

// --- Bedrock -----------------------------------------------------------------
type TurnScript = {
  events?: AgentEvent[];
  assistantContent?: unknown[];
  toolUses?: Array<{ toolUseId: string; name: string; input: Record<string, unknown> }>;
  guardrailIntervened?: boolean;
  throws?: Error;
};

let turnScripts: TurnScript[] = [];
const converseCalls: Array<{ system: string; messages: unknown[]; tools: unknown }> = [];

vi.mock('./bedrock.js', () => ({
  streamConverseTurn: async function* (params: {
    system: string;
    messages: unknown[];
    tools: unknown;
  }) {
    converseCalls.push({
      system: params.system,
      messages: params.messages,
      tools: params.tools,
    });
    const script = turnScripts.shift() ?? { assistantContent: [{ text: 'ok' }] };
    if (script.throws) throw script.throws;
    for (const e of script.events ?? []) yield e;
    return {
      assistantContent: script.assistantContent ?? [{ text: 'ok' }],
      toolUses: script.toolUses ?? [],
      guardrailIntervened: script.guardrailIntervened ?? false,
    };
  },
  getNovaModelId: () => 'test-model',
  getBedrockRegion: () => 'eu-west-2',
  formatBedrockModelErrorForLogs: (e: unknown) => `LOGS:${String(e)}`,
  formatBedrockErrorForUser: () => 'the model is temporarily unavailable',
}));

// --- Memory ------------------------------------------------------------------
const recallProjectMemory = vi.fn(async (_p: unknown) => [] as unknown[]);
const writeMemoryEntry = vi.fn(async (_p: unknown) => 'mem-1');
vi.mock('./memory.js', () => ({
  recallProjectMemory: (p: unknown) => recallProjectMemory(p),
  writeMemoryEntry: (p: unknown) => writeMemoryEntry(p),
  formatVector: (v: number[]) => `[${v.join(',')}]`,
}));

const refreshProjectMemorySummary = vi.fn(async () => null);
vi.mock('./project-memory.js', () => ({
  refreshProjectMemorySummary: () => refreshProjectMemorySummary(),
}));

// --- Session store -----------------------------------------------------------
let sessionRow: Record<string, unknown> | null = null;
let claimTurn = true;
const appendedMessages: Array<{ role: string; content: unknown }> = [];
const statusCalls: Array<{ status: string; pending: unknown }> = [];
const buildEvents: Array<{ tool: string; summary: string }> = [];
const released = { count: 0 };

vi.mock('./session-store.js', () => ({
  getSession: async () => sessionRow,
  tryBeginPromptTurn: async () => claimTurn,
  releasePromptTurnIfRunning: async () => {
    released.count++;
  },
  setSessionStatus: async (_db: unknown, _id: string, status: string, pending: unknown) => {
    statusCalls.push({ status, pending });
  },
  setToolLoopGuard: async () => {},
  appendMessage: async (_db: unknown, _id: string, role: string, content: unknown) => {
    appendedMessages.push({ role, content });
  },
  listMessages: async () => appendedMessages.map((m) => ({ role: m.role, content: m.content })),
  appendBuildEvent: async (
    _db: unknown,
    _s: string,
    tool: string,
    _in: unknown,
    summary: string,
  ) => {
    buildEvents.push({ tool, summary });
  },
}));

// --- Project knowledge / skills ----------------------------------------------
let knowledge: Record<string, unknown> | null = null;
vi.mock('./project-knowledge.js', () => ({
  loadProjectKnowledge: async () => knowledge,
  formatProjectKnowledgeBlock: () => 'KNOWLEDGE_BLOCK',
}));
vi.mock('./web-skills.js', () => ({
  webSkillsCatalogText: () => 'SKILLS_CATALOG',
  loadWebSkill: () => null,
  generateCreativeBrief: vi.fn(),
  generateFlyerBrief: vi.fn(),
}));

// --- Everything else the module imports but these tests do not exercise -------
vi.mock('./creative-memory.js', () => ({
  embedAndStoreCreativeAsset: vi.fn(),
  recallCreativeAssets: vi.fn(async () => []),
  saveCreativeToProjectMemory: vi.fn(),
}));
vi.mock('./workflow-memory.js', () => ({ recallWorkflowRuns: vi.fn(async () => []) }));
vi.mock('./mcp.js', () => ({
  getSharedMcpClient: vi.fn(async () => null),
  isMcpWriteTool: () => true,
}));
vi.mock('./creative-moderation.js', () => ({ moderateCreativeCopy: vi.fn(() => null) }));
vi.mock('./image-gen.js', () => ({ generateCanvasImage: vi.fn() }));
vi.mock('./creative-brief.js', () => ({
  generateCreativeBrief: vi.fn(),
  generateFlyerBrief: vi.fn(),
  generateVideoBrief: vi.fn(),
}));
vi.mock('./creative-client.js', () => ({ invokeComposeVideo: vi.fn() }));
vi.mock('./web-search.js', () => ({
  webSearch: vi.fn(async () => ({ results: [] })),
  webExtract: vi.fn(async () => ({ text: '' })),
}));
vi.mock('@walkcroach/connectors', () => ({
  configuredProviders: () => [],
  describeAction: () => null,
  getAction: () => null,
  getConnector: vi.fn(async () => null),
  listConnectors: vi.fn(async () => []),
  recordProposal: vi.fn(),
  toConnectorView: (x: unknown) => x,
  validateActionArgs: () => ({ ok: true }),
}));

const { runPromptTurn, resolveEffectiveMode, defaultCreativeLimits } = await import(
  './loop.js'
);

// --- Harness -----------------------------------------------------------------
const PROJECT = '11111111-1111-1111-1111-111111111111';
const SESSION = '22222222-2222-2222-2222-222222222222';

const db = { query: vi.fn(async () => ({ rows: [] })) } as unknown as DbClient;

function activeSession(over: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    project_id: PROJECT,
    status: 'active',
    mode: 'builder',
    model_config: {},
    ...over,
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const run = (over: Record<string, unknown> = {}) =>
  collect(
    runPromptTurn({
      db,
      sessionId: SESSION,
      projectId: PROJECT,
      message: 'add a dark mode toggle',
      ...over,
    } as Parameters<typeof runPromptTurn>[0]),
  );

const typesOf = (events: AgentEvent[]) => events.map((e) => e.type);
const find = <T extends AgentEvent['type']>(events: AgentEvent[], type: T) =>
  events.find((e) => e.type === type) as Extract<AgentEvent, { type: T }> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  turnScripts = [];
  converseCalls.length = 0;
  appendedMessages.length = 0;
  statusCalls.length = 0;
  buildEvents.length = 0;
  released.count = 0;
  sessionRow = activeSession();
  claimTurn = true;
  knowledge = null;
  recallProjectMemory.mockResolvedValue([]);
});

// =============================================================================
describe('runPromptTurn — session state machine', () => {
  it('refuses an unknown session', async () => {
    sessionRow = null;
    const events = await run();
    expect(find(events, 'error')?.message).toMatch(/Unknown session/);
    expect(typesOf(events)).toEqual(['error', 'done']);
  });

  it('refuses a session belonging to a different project', async () => {
    sessionRow = activeSession({ project_id: 'aaaaaaaa-0000-0000-0000-000000000000' });
    const events = await run();
    expect(find(events, 'error')?.message).toMatch(/does not match session/);
  });

  it.each([
    ['awaiting_tool', /POST \/tool-result/, 'awaiting_tool'],
    ['awaiting_plan_approval', /POST \/plan-decision/, 'awaiting_plan_approval'],
  ])('refuses a new prompt while %s', async (status, msg, reason) => {
    sessionRow = activeSession({ status });
    const events = await run();
    expect(find(events, 'error')?.message).toMatch(msg);
    expect(find(events, 'done')?.reason).toBe(reason);
  });

  it('refuses a concurrent prompt on a running session', async () => {
    sessionRow = activeSession({ status: 'running' });
    const events = await run();
    expect(find(events, 'error')?.message).toMatch(/already has a prompt in progress/);
  });

  it('refuses when the turn claim is lost to a racing request', async () => {
    claimTurn = false;
    const events = await run();
    expect(find(events, 'error')?.message).toMatch(/busy/i);
    // Nothing was claimed, so nothing may be released.
    expect(released.count).toBe(0);
  });

  it('does not reach the model on any guard rejection', async () => {
    sessionRow = activeSession({ status: 'running' });
    await run();
    expect(converseCalls).toHaveLength(0);
  });

  it('always releases the turn claim, even when the model throws', async () => {
    turnScripts = [{ throws: new Error('bedrock exploded') }];
    await run();
    expect(released.count).toBe(1);
  });
});

// =============================================================================
describe('runPromptTurn — memory recall', () => {
  it('recalls memory before the model runs, not after', async () => {
    const order: string[] = [];
    recallProjectMemory.mockImplementation(async () => {
      order.push('recall');
      return [];
    });
    turnScripts = [{ assistantContent: [{ text: 'done' }] }];
    await run();
    order.push('converse');
    expect(order).toEqual(['recall', 'converse']);
  });

  it('recalls against the user message, scoped to the project', async () => {
    await run({ message: 'what did we decide about auth?' });
    expect(recallProjectMemory).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, query: 'what did we decide about auth?' }),
    );
  });

  it('emits memory_recalled so the UI can show what was remembered', async () => {
    recallProjectMemory.mockResolvedValue([
      { kind: 'decision', text: 'Use Postgres', sourceSurface: 'ide' },
      { kind: 'preference', text: 'Dark mode', sourceSurface: 'chrome' },
    ]);
    const events = await run();
    const ev = find(events, 'memory_recalled');
    expect(ev?.count).toBe(2);
    expect(ev?.kinds).toEqual(['decision', 'preference']);
    expect(ev?.hits[0]).toMatchObject({ kind: 'decision', sourceSurface: 'ide' });
  });

  it('emits memory_recalled even when nothing was found', async () => {
    const events = await run();
    expect(find(events, 'memory_recalled')?.count).toBe(0);
  });

  it('de-duplicates kinds and caps the event at 5 hits', async () => {
    recallProjectMemory.mockResolvedValue(
      Array.from({ length: 9 }, (_, i) => ({
        kind: 'preference',
        text: `p${i}`,
        sourceSurface: 'web',
      })),
    );
    const ev = find(await run(), 'memory_recalled');
    expect(ev?.count).toBe(9); // true total is reported
    expect(ev?.kinds).toEqual(['preference']); // but kinds are deduped
    expect(ev?.hits).toHaveLength(5); // and the payload is bounded
  });

  it('truncates long memory text in the event payload', async () => {
    recallProjectMemory.mockResolvedValue([
      { kind: 'decision', text: 'x'.repeat(400), sourceSurface: 'web' },
    ]);
    const ev = find(await run(), 'memory_recalled');
    expect(ev?.hits[0]?.text).toHaveLength(281); // 280 + ellipsis
    expect(ev?.hits[0]?.text.endsWith('…')).toBe(true);
  });

  it('injects recalled memory into the system prompt the model actually sees', async () => {
    recallProjectMemory.mockResolvedValue([
      { kind: 'decision', text: 'Use CockroachDB for all persistence', sourceSurface: 'ide' },
    ]);
    await run();
    expect(converseCalls[0]?.system).toContain('Project memory');
    expect(converseCalls[0]?.system).toContain('Use CockroachDB for all persistence');
    expect(converseCalls[0]?.system).toContain('[ide|decision]');
  });

  it('omits the memory block entirely when there is nothing to recall', async () => {
    await run();
    expect(converseCalls[0]?.system).not.toContain('Project memory');
  });
});

// =============================================================================
describe('runPromptTurn — memory tools', () => {
  it('recall_project_memory returns hits with distances and logs a build event', async () => {
    recallProjectMemory
      .mockResolvedValueOnce([]) // pre-turn recall
      .mockResolvedValueOnce([
        {
          kind: 'decision',
          text: 'Use Postgres',
          distance: 0.0421,
          sourceSurface: 'ide',
        },
      ]);
    turnScripts = [
      {
        assistantContent: [{ text: 'checking' }],
        toolUses: [
          { toolUseId: 't1', name: 'recall_project_memory', input: { query: 'db choice' } },
        ],
      },
      { assistantContent: [{ text: 'Postgres it is' }] },
    ];

    await run();

    const toolMsg = appendedMessages.find((m) =>
      JSON.stringify(m.content).includes('toolResult'),
    );
    const text = JSON.stringify(toolMsg?.content);
    expect(text).toContain('[ide|decision]');
    expect(text).toContain('dist=0.042');
    expect(buildEvents).toContainEqual({ tool: 'recall_project_memory', summary: 'hits=1' });
  });

  it('recall_project_memory says so plainly when memory is empty', async () => {
    turnScripts = [
      {
        toolUses: [{ toolUseId: 't1', name: 'recall_project_memory', input: { query: 'x' } }],
      },
      {},
    ];
    await run();
    const toolMsg = appendedMessages.find((m) =>
      JSON.stringify(m.content).includes('toolResult'),
    );
    expect(JSON.stringify(toolMsg?.content)).toContain('No matching memories');
  });

  it('remember_preference writes to project memory and refreshes the summary', async () => {
    turnScripts = [
      {
        toolUses: [
          {
            toolUseId: 't1',
            name: 'remember_preference',
            input: { text: 'Always use Tailwind', kind: 'preference' },
          },
        ],
      },
      {},
    ];

    await run();

    expect(writeMemoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        kind: 'preference',
        text: 'Always use Tailwind',
        sourceSurface: 'web',
      }),
    );
    expect(refreshProjectMemorySummary).toHaveBeenCalled();
    expect(buildEvents).toContainEqual({
      tool: 'remember_preference',
      summary: 'memory_id=mem-1',
    });
  });

  it('coerces an unrecognised memory kind to preference rather than storing it', async () => {
    // The model can emit anything here; only 'decision' may become a decision.
    turnScripts = [
      {
        toolUses: [
          {
            toolUseId: 't1',
            name: 'remember_preference',
            input: { text: 'note', kind: 'wildly-invalid-kind' },
          },
        ],
      },
      {},
    ];
    await run();
    expect(writeMemoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'preference' }),
    );
  });

  it('stores a decision as a decision', async () => {
    turnScripts = [
      {
        toolUses: [
          {
            toolUseId: 't1',
            name: 'remember_preference',
            input: { text: 'Postgres over MySQL', kind: 'decision' },
          },
        ],
      },
      {},
    ];
    await run();
    expect(writeMemoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'decision' }),
    );
  });
});

// =============================================================================
describe('runPromptTurn — loop termination', () => {
  it('completes when the model returns no tool uses', async () => {
    turnScripts = [{ assistantContent: [{ text: 'all done' }] }];
    const events = await run();
    expect(find(events, 'done')?.reason).toBe('complete');
    expect(statusCalls.at(-1)).toEqual({ status: 'active', pending: null });
  });

  it('stops immediately when a guardrail intervenes', async () => {
    turnScripts = [
      {
        assistantContent: [{ text: 'blocked' }],
        toolUses: [{ toolUseId: 't1', name: 'recall_project_memory', input: {} }],
        guardrailIntervened: true,
      },
    ];
    const events = await run();
    expect(find(events, 'done')?.reason).toBe('complete');
    // The tool must NOT run — a guardrail stop outranks a pending tool call.
    expect(converseCalls).toHaveLength(1);
    expect(buildEvents).toHaveLength(0);
  });

  it('errors out rather than looping forever on a tool-calling model', async () => {
    // Every turn asks for another server tool; nothing ever terminates.
    turnScripts = Array.from({ length: 20 }, () => ({
      toolUses: [
        { toolUseId: 't', name: 'recall_project_memory', input: { query: 'again' } },
      ],
    }));
    const events = await run();
    expect(find(events, 'error')?.message).toMatch(/Exceeded max inner turns/);
    expect(find(events, 'done')?.reason).toBe('complete');
    expect(converseCalls.length).toBe(12); // MAX_INNER_TURNS
  });

  it('reports a model failure without leaking infra detail to the user', async () => {
    turnScripts = [{ throws: new Error('AccessDeniedException: arn:aws:bedrock:...') }];
    const events = await run();
    const msg = find(events, 'error')?.message ?? '';
    expect(msg).toBe('the model is temporarily unavailable');
    expect(msg).not.toMatch(/arn:aws|AccessDenied|test-model/);
  });

  it('persists the failure as an assistant message so the transcript is not silently truncated', async () => {
    turnScripts = [{ throws: new Error('boom') }];
    await run();
    const last = appendedMessages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(JSON.stringify(last?.content)).toMatch(/the model failed on this turn/);
  });
});

// =============================================================================
describe('runPromptTurn — attachments', () => {
  it('surfaces an ingest failure to the user instead of silently dropping it', async () => {
    const events = await run({
      attachments: [
        { name: 'big.pdf', mime: 'application/pdf', textPreview: '', ingestError: 'too large' },
      ],
    });
    expect(find(events, 'error')?.message).toMatch(/Attachment skipped: big\.pdf — too large/);
    // A bad attachment must not abort the turn.
    expect(find(events, 'done')?.reason).toBe('complete');
  });
});

// =============================================================================
describe('resolveEffectiveMode — privilege boundary', () => {
  it('defaults to build when nothing is stored or requested', () => {
    expect(resolveEffectiveMode(null, undefined, undefined)).toBe('build');
  });

  it.each(['build', 'plan', undefined] as const)(
    'never lets a chat session escalate to %s via the client body',
    (requested) => {
      expect(resolveEffectiveMode('chat', undefined, requested)).toBe('chat');
    },
  );

  it('lets a chat session opt into project_chat, the only permitted sibling', () => {
    expect(resolveEffectiveMode('chat', undefined, 'project_chat')).toBe('project_chat');
  });

  it('lets a build session drop privilege to plan', () => {
    expect(resolveEffectiveMode('builder', undefined, 'plan')).toBe('plan');
  });

  it('treats the legacy "builder" column value as build', () => {
    expect(resolveEffectiveMode('builder', undefined, undefined)).toBe('build');
  });

  it('lets a plan session be promoted to build (an explicit user approval path)', () => {
    expect(resolveEffectiveMode(null, 'plan', 'build')).toBe('build');
  });

  it('prefers the sessions.mode column over model_config', () => {
    expect(resolveEffectiveMode('chat', 'build', 'build')).toBe('chat');
  });

  it('falls back to model_config when the column says nothing', () => {
    expect(resolveEffectiveMode(null, 'chat', 'build')).toBe('chat');
  });

  it('ignores junk in model_config rather than trusting it', () => {
    expect(resolveEffectiveMode(null, 'root', 'plan')).toBe('plan');
  });
});

// =============================================================================
describe('mode wiring', () => {
  it('gives a chat session no file-writing tools', async () => {
    sessionRow = activeSession({ mode: 'chat' });
    await run({ mode: 'build' }); // client tries to escalate
    const names = JSON.stringify(converseCalls[0]?.tools);
    expect(names).not.toMatch(/write_file|edit_file|run_terminal/);
    expect(names).toMatch(/recall_project_memory/);
  });

  it('gives a build session the file tools', async () => {
    sessionRow = activeSession({ mode: 'builder' });
    await run();
    expect(JSON.stringify(converseCalls[0]?.tools)).toMatch(/write_file/);
  });

  it('forbids file writes in plan mode', async () => {
    sessionRow = activeSession({ mode: 'builder' });
    await run({ mode: 'plan' });
    expect(converseCalls[0]?.system).toMatch(/Do NOT call write_file/);
  });
});

// =============================================================================
describe('system prompt composition', () => {
  it('includes project knowledge when the project has any', async () => {
    knowledge = { instructions: 'Ship small diffs', description: '', documents: [] };
    await run();
    expect(converseCalls[0]?.system).toContain('KNOWLEDGE_BLOCK');
  });

  it('always carries the prompt-extraction refusal instruction', async () => {
    await run();
    expect(converseCalls[0]?.system).toMatch(/system instructions/i);
  });

  it('tells the model when web search is unavailable', async () => {
    sessionRow = activeSession({ mode: 'chat' });
    await run({ webSearchEnabled: false });
    expect(converseCalls[0]?.system).toMatch(/Live web browsing is disabled/);
  });
});

// =============================================================================
describe('defaultCreativeLimits', () => {
  it('defaults to the free tier with no video allowance', () => {
    const limits = defaultCreativeLimits();
    expect(limits.isPaid).toBe(false);
    expect(limits.videoRemaining).toBe(0);
    expect(limits.imageDailyRemaining).toBe(limits.imageDailyLimit);
  });
});
