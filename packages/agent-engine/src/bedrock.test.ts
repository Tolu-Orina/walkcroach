import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-bedrock-runtime', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@aws-sdk/client-bedrock-runtime')
  >();
  return {
    ...actual,
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

import {
  getNovaModelId,
  createBedrockClient,
  streamConverseTurn,
  streamPing,
} from './bedrock.js';

function makeStreamEvents(opts: {
  text?: string;
  toolUse?: { id: string; name: string; input: Record<string, unknown> };
  stopReason?: string;
}) {
  const events: unknown[] = [];

  if (opts.text) {
    events.push({ contentBlockDelta: { delta: { text: opts.text } } });
    events.push({ contentBlockStop: {} });
  }

  if (opts.toolUse) {
    events.push({
      contentBlockStart: {
        start: {
          toolUse: { toolUseId: opts.toolUse.id, name: opts.toolUse.name },
        },
      },
    });
    events.push({
      contentBlockDelta: {
        delta: { toolUse: { input: JSON.stringify(opts.toolUse.input) } },
      },
    });
    events.push({ contentBlockStop: {} });
  }

  events.push({
    messageStop: { stopReason: opts.stopReason ?? 'end_turn' },
  });
  events.push({
    metadata: {
      usage: { cacheReadInputTokens: 10, cacheWriteInputTokens: 5 },
    },
  });

  return events;
}

function setMockStream(events: unknown[]) {
  mockSend.mockResolvedValue({
    stream: (async function* () {
      for (const e of events) yield e;
    })(),
  });
}

describe('getNovaModelId', () => {
  const orig = process.env.BEDROCK_NOVA_MODEL_ID;
  afterEach(() => {
    if (orig !== undefined) process.env.BEDROCK_NOVA_MODEL_ID = orig;
    else delete process.env.BEDROCK_NOVA_MODEL_ID;
  });

  it('returns default model when env not set', () => {
    delete process.env.BEDROCK_NOVA_MODEL_ID;
    expect(getNovaModelId()).toBe('global.amazon.nova-2-lite-v1:0');
  });

  it('respects env override', () => {
    process.env.BEDROCK_NOVA_MODEL_ID = 'custom-model';
    expect(getNovaModelId()).toBe('custom-model');
  });
});

describe('createBedrockClient', () => {
  it('creates a client', () => {
    const client = createBedrockClient('us-east-1');
    expect(client).toBeDefined();
  });
});

describe('streamConverseTurn', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('yields token deltas and returns result', async () => {
    setMockStream(makeStreamEvents({ text: 'Hello world', stopReason: 'end_turn' }));

    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
    });
    const deltas: unknown[] = [];
    let result = await gen.next();
    while (!result.done) {
      deltas.push(result.value);
      result = await gen.next();
    }

    expect(deltas.some((d: any) => d.type === 'token' && d.text === 'Hello world')).toBe(true);
    expect(deltas.some((d: any) => d.type === 'usage')).toBe(true);
    expect(result.value.stopReason).toBe('end_turn');
    expect(result.value.text).toBe('Hello world');
    expect(result.value.cacheReadInputTokens).toBe(10);
  });

  it('parses tool use blocks', async () => {
    setMockStream(
      makeStreamEvents({
        toolUse: { id: 'tu-1', name: 'read_file', input: { path: 'a.ts' } },
        stopReason: 'tool_use',
      }),
    );

    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'read' }] }],
    });
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    expect(result.value.toolUses).toHaveLength(1);
    expect(result.value.toolUses[0]!.name).toBe('read_file');
    expect(result.value.toolUses[0]!.input).toEqual({ path: 'a.ts' });
  });

  it('throws on abort before start', async () => {
    const ac = new AbortController();
    ac.abort();
    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
      signal: ac.signal,
    });
    await expect(gen.next()).rejects.toThrow(/Aborted/);
  });

  it('throws when stream is missing', async () => {
    mockSend.mockResolvedValue({ stream: null });

    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
    });
    await expect(gen.next()).rejects.toThrow(/No stream/);
  });

  it('handles malformed tool JSON gracefully', async () => {
    const events = [
      {
        contentBlockStart: {
          start: { toolUse: { toolUseId: 'tu-2', name: 'read_file' } },
        },
      },
      {
        contentBlockDelta: {
          delta: { toolUse: { input: 'not valid json{' } },
        },
      },
      { contentBlockStop: {} },
      { messageStop: { stopReason: 'tool_use' } },
      { metadata: { usage: {} } },
    ];
    setMockStream(events);

    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
    });
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    expect(result.value.toolUses[0]!.input).toEqual({ _raw: 'not valid json{' });
  });
});

describe('streamPing', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns text and usage from a ping turn', async () => {
    setMockStream(makeStreamEvents({ text: 'Pong!', stopReason: 'end_turn' }));

    const gen = streamPing({ userText: 'Ping.' });
    const deltas: unknown[] = [];
    let result = await gen.next();
    while (!result.done) {
      deltas.push(result.value);
      result = await gen.next();
    }

    expect(result.value.text).toBe('Pong!');
    expect(result.value.stopReason).toBe('end_turn');
    expect(deltas.some((d: any) => d.type === 'token')).toBe(true);
  });

  it('uses default user text when none provided', async () => {
    setMockStream(makeStreamEvents({ text: 'OK', stopReason: 'end_turn' }));

    const gen = streamPing({});
    let r = await gen.next();
    while (!r.done) r = await gen.next();

    expect(r.value.text).toBe('OK');
  });
});
