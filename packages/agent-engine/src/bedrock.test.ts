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
  getNovaReasoningEffort,
  getTitanEmbedModelId,
  createBedrockClient,
  streamConverseTurn,
  streamPing,
  embedText,
} from './bedrock.js';

function makeStreamEvents(opts: {
  text?: string;
  reasoningText?: string;
  toolUse?: { id: string; name: string; input: Record<string, unknown> };
  stopReason?: string;
}) {
  const events: unknown[] = [];

  if (opts.reasoningText) {
    events.push({
      contentBlockDelta: {
        delta: { reasoningContent: { text: opts.reasoningText } },
      },
    });
    events.push({ contentBlockStop: {} });
  }

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

describe('getNovaReasoningEffort', () => {
  const orig = process.env.BEDROCK_NOVA_REASONING;
  afterEach(() => {
    if (orig !== undefined) process.env.BEDROCK_NOVA_REASONING = orig;
    else delete process.env.BEDROCK_NOVA_REASONING;
  });

  it('defaults to medium when env not set', () => {
    delete process.env.BEDROCK_NOVA_REASONING;
    expect(getNovaReasoningEffort()).toBe('medium');
  });

  it('respects low/medium/high env overrides', () => {
    process.env.BEDROCK_NOVA_REASONING = 'high';
    expect(getNovaReasoningEffort()).toBe('high');
    process.env.BEDROCK_NOVA_REASONING = 'LOW';
    expect(getNovaReasoningEffort()).toBe('low');
  });

  it('coerces off/disabled/0/false to medium (thinking always on)', () => {
    for (const v of ['off', 'disabled', '0', 'false']) {
      process.env.BEDROCK_NOVA_REASONING = v;
      expect(getNovaReasoningEffort()).toBe('medium');
    }
  });

  it('falls back to medium on unrecognized values', () => {
    process.env.BEDROCK_NOVA_REASONING = 'nonsense';
    expect(getNovaReasoningEffort()).toBe('medium');
  });
});

describe('createBedrockClient', () => {
  it('creates a client', () => {
    const client = createBedrockClient('us-east-1');
    expect(client).toBeDefined();
  });
});

describe('normalizeBedrockApiKey + formatBedrockAuthError', () => {
  it('strips Bearer prefix and quotes', async () => {
    const { normalizeBedrockApiKey } = await import('./bedrock.js');
    expect(normalizeBedrockApiKey('  Bearer abc.def  ')).toBe('abc.def');
    expect(normalizeBedrockApiKey('"abc.def"')).toBe('abc.def');
  });

  it('appends region hint for API key auth failures', async () => {
    const { formatBedrockAuthError } = await import('./bedrock.js');
    const msg = formatBedrockAuthError(
      new Error(
        'Authentication failed: Please make sure your API Key is valid.',
      ),
      'eu-west-2',
    );
    expect(msg).toContain('eu-west-2');
    expect(msg).toMatch(/region/i);
  });
});

describe('getTitanEmbedModelId', () => {
  const orig = process.env.BEDROCK_TITAN_EMBED_MODEL_ID;
  afterEach(() => {
    if (orig !== undefined) process.env.BEDROCK_TITAN_EMBED_MODEL_ID = orig;
    else delete process.env.BEDROCK_TITAN_EMBED_MODEL_ID;
  });

  it('returns the default Titan V2 model when env not set', () => {
    delete process.env.BEDROCK_TITAN_EMBED_MODEL_ID;
    expect(getTitanEmbedModelId()).toBe('amazon.titan-embed-text-v2:0');
  });

  it('respects env override', () => {
    process.env.BEDROCK_TITAN_EMBED_MODEL_ID = 'custom-embed-model';
    expect(getTitanEmbedModelId()).toBe('custom-embed-model');
  });
});

describe('embedText', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  function setMockEmbedResponse(embedding: number[]) {
    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({ embedding })),
    });
  }

  it('sends a normalized 1024-dim Titan request and returns the embedding', async () => {
    const embedding = Array.from({ length: 1024 }, (_, i) => i / 1024);
    setMockEmbedResponse(embedding);

    const result = await embedText('hello world');

    expect(result).toEqual(embedding);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0]![0];
    expect(command.input.modelId).toBe('amazon.titan-embed-text-v2:0');
    expect(command.input.contentType).toBe('application/json');
    expect(command.input.accept).toBe('application/json');
    expect(JSON.parse(command.input.body)).toEqual({
      inputText: 'hello world',
      dimensions: 1024,
      normalize: true,
    });
  });

  it('uses an explicit client and modelId override when provided', async () => {
    setMockEmbedResponse([1, 2, 3]);
    const explicitClient = { send: mockSend } as unknown as Parameters<
      typeof embedText
    >[1];

    await embedText('query text', explicitClient, 'custom-model');

    const command = mockSend.mock.calls[0]![0];
    expect(command.input.modelId).toBe('custom-model');
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

  it('defaults to medium reasoning with a bumped output budget', async () => {
    setMockStream(makeStreamEvents({ text: 'hi', stopReason: 'end_turn' }));

    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
    });
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    const input = mockSend.mock.calls[0]![0].input as Record<string, unknown>;
    expect(input.additionalModelRequestFields).toEqual({
      reasoningConfig: { type: 'enabled', maxReasoningEffort: 'medium' },
    });
    expect(input.inferenceConfig).toEqual({ maxTokens: 30_000 });
  });

  it('omits inferenceConfig entirely for high reasoning effort', async () => {
    setMockStream(makeStreamEvents({ text: 'hi', stopReason: 'end_turn' }));

    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
      reasoningEffort: 'high',
    });
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    const input = mockSend.mock.calls[0]![0].input as Record<string, unknown>;
    expect(input.inferenceConfig).toBeUndefined();
    expect(input.additionalModelRequestFields).toEqual({
      reasoningConfig: { type: 'enabled', maxReasoningEffort: 'high' },
    });
  });

  it('keeps reasoningConfig when override is off (thinking always on)', async () => {
    setMockStream(makeStreamEvents({ text: 'hi', stopReason: 'end_turn' }));

    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
      reasoningEffort: 'off',
    });
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    const input = mockSend.mock.calls[0]![0].input as Record<string, unknown>;
    expect(input.additionalModelRequestFields).toEqual({
      reasoningConfig: { type: 'enabled', maxReasoningEffort: 'medium' },
    });
    expect(input.inferenceConfig).toEqual({ maxTokens: 30_000 });
  });

  it('lets an explicit maxTokens override the reasoning-tier default', async () => {
    setMockStream(makeStreamEvents({ text: 'hi', stopReason: 'end_turn' }));

    const gen = streamConverseTurn({
      system: [{ text: 'sys' }],
      messages: [{ role: 'user', content: [{ text: 'hi' }] }],
      maxTokens: 1234,
    });
    let result = await gen.next();
    while (!result.done) result = await gen.next();

    const input = mockSend.mock.calls[0]![0].input as Record<string, unknown>;
    expect(input.inferenceConfig).toEqual({ maxTokens: 1234 });
  });

  it('emits a single opaque thinking event for [REDACTED] walls', async () => {
    setMockStream(
      makeStreamEvents({
        reasoningText: '[REDACTED]. [REDACTED]. [REDACTED]',
        text: 'ok',
        stopReason: 'end_turn',
      }),
    );

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

    const thinking = deltas.filter(
      (d): d is { type: 'thinking'; text: string; opaque?: boolean } =>
        typeof d === 'object' &&
        d !== null &&
        (d as { type?: string }).type === 'thinking',
    );
    expect(thinking).toEqual([{ type: 'thinking', text: '', opaque: true }]);
  });

  it('streams readable reasoning when Nova returns real text', async () => {
    setMockStream(
      makeStreamEvents({
        reasoningText: 'Check contrast next.',
        text: 'ok',
        stopReason: 'end_turn',
      }),
    );

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

    expect(deltas).toContainEqual({
      type: 'thinking',
      text: 'Check contrast next.',
    });
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
