import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { HostAdapter, AgentEvent } from './host.js';

const mockStreamPing = vi.fn();
const mockStreamConverseTurn = vi.fn();

vi.mock('./bedrock.js', () => ({
  getNovaModelId: () => 'test-model',
  createBedrockClient: vi.fn(),
  streamConverseTurn: (...args: unknown[]) => mockStreamConverseTurn(...args),
  streamPing: (...args: unknown[]) => mockStreamPing(...args),
  DEFAULT_MAX_OUTPUT_TOKENS: 4096,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS: 2,
}));

import { runAgentLoop, DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_SUBAGENTS } from './loop.js';

function makeHost(overrides?: Partial<HostAdapter>): HostAdapter & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    events,
    readFile: async () => '',
    writeFile: async () => undefined,
    listDir: async () => [],
    search: async () => [],
    runTerminal: async function* () {},
    showDiffPreview: async () => 'approve' as const,
    confirmCommand: async () => 'approve' as const,
    resolveApproval: () => undefined,
    getAutonomy: () => 'strict' as const,
    setAutonomy: () => undefined,
    getWorkspaceRoot: () => '/workspace',
    isTrustedWorkspace: () => true,
    secrets: { get: async () => undefined, store: async () => undefined },
    emit: (event: AgentEvent) => { events.push(event); },
    gatherMeta: async () => ({ gitStatus: '## main' }),
    ...overrides,
  };
}

describe('runAgentLoop — ping mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs ping mode and emits done', async () => {
    mockStreamPing.mockImplementation(async function* () {
      yield { type: 'token' as const, text: 'Pong' };
      yield {
        type: 'usage' as const,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      };
      return { text: 'Pong', stopReason: 'end_turn', cacheReadInputTokens: 0, cacheWriteInputTokens: 0 };
    });

    const host = makeHost();
    await runAgentLoop({ host, prompt: 'ping' });

    expect(host.events.some(e => e.type === 'phase' && e.phase === 'gather')).toBe(true);
    expect(host.events.some(e => e.type === 'phase' && e.phase === 'act')).toBe(true);
    expect(host.events.some(e => e.type === 'done')).toBe(true);
    expect(host.events.some(e => e.type === 'token_delta')).toBe(true);
  });
});

describe('runAgentLoop — untrusted workspace', () => {
  it('throws for untrusted workspace', async () => {
    const host = makeHost({ isTrustedWorkspace: () => false });
    await expect(
      runAgentLoop({ host, prompt: 'test' }),
    ).rejects.toThrow(/not trusted/i);
  });
});

describe('runAgentLoop — abort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits done with cancelled reason on pre-aborted signal in ping mode', async () => {
    mockStreamPing.mockImplementation(async function* () {
      throw new DOMException('Aborted', 'AbortError');
    });

    const host = makeHost();
    await runAgentLoop({ host, prompt: 'test', mode: 'ping' });

    expect(host.events.some(e => e.type === 'done' && e.reason === 'cancelled')).toBe(true);
  });

  it('throws AbortError when signal is pre-aborted in full mode', async () => {
    const host = makeHost();
    const ac = new AbortController();
    ac.abort();

    await expect(
      runAgentLoop({ host, prompt: 'test', signal: ac.signal, mode: 'full' }),
    ).rejects.toThrow(/Aborted/);
  });
});

describe('runAgentLoop — end_turn without tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes after model returns with no tool_uses', async () => {
    mockStreamConverseTurn.mockImplementation(async function* () {
      yield { type: 'token' as const, text: 'Done thinking.' };
      yield {
        type: 'usage' as const,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      };
      return {
        stopReason: 'end_turn',
        assistantContent: [{ text: 'Done thinking.' }],
        toolUses: [],
        text: 'Done thinking.',
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      };
    });

    const host = makeHost();
    await runAgentLoop({ host, prompt: 'explain something', mode: 'full' });

    expect(host.events.some(e => e.type === 'done')).toBe(true);
    const doneEvent = host.events.find(e => e.type === 'done') as any;
    expect(doneEvent.reason).toBe('end_turn');
  });
});

describe('constants', () => {
  it('exports sensible defaults', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(24);
    expect(DEFAULT_MAX_SUBAGENTS).toBe(3);
  });
});
