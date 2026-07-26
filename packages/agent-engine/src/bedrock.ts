import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  InvokeModelCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
  type ToolConfiguration,
} from '@aws-sdk/client-bedrock-runtime';

export function getNovaModelId(): string {
  return (
    process.env.BEDROCK_NOVA_MODEL_ID ?? 'global.amazon.nova-2-lite-v1:0'
  );
}

export function getTitanEmbedModelId(): string {
  return (
    process.env.BEDROCK_TITAN_EMBED_MODEL_ID ?? 'amazon.titan-embed-text-v2:0'
  );
}

/**
 * Embed text with Titan Text Embeddings V2 (1024-dim), mirroring
 * infra-backend/packages/agent-harness/src/bedrock.ts's embedText exactly
 * (same model, same normalized-1024-dim body shape) — kept dimensionally
 * consistent with the VECTOR(1024) convention used across the codebase's
 * CockroachDB memory tables, even though this is a purely local index.
 */
export async function embedText(
  text: string,
  client?: BedrockRuntimeClient,
  modelId?: string,
): Promise<number[]> {
  const c = client ?? createBedrockClient();
  const model = modelId ?? getTitanEmbedModelId();
  const res = await c.send(
    new InvokeModelCommand({
      modelId: model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as {
    embedding: number[];
  };
  return parsed.embedding;
}

/** Explicit output budget (Bedrock defaults to model max and can truncate silently). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** Output budget when extended thinking is on — reasoning itself consumes output tokens. */
export const DEFAULT_MAX_REASONING_OUTPUT_TOKENS = 30_000;

/** Auto-continue rounds when stopReason is max_tokens (industry continuation pattern). */
export const DEFAULT_MAX_OUTPUT_CONTINUATIONS = 2;

export type NovaReasoningEffort = 'low' | 'medium' | 'high' | 'off';

/**
 * Nova 2 Lite extended thinking. Default medium — same tier as Web App
 * Builder for multi-step coding / tool loops. Set
 * BEDROCK_NOVA_REASONING=off|low|medium|high to override, or pass
 * `reasoningEffort` explicitly to streamConverseTurn (IDE settings do this).
 * @see https://docs.aws.amazon.com/nova/latest/nova2-userguide/extended-thinking.html
 */
export function getNovaReasoningEffort(): NovaReasoningEffort {
  const raw = (process.env.BEDROCK_NOVA_REASONING ?? 'medium')
    .trim()
    .toLowerCase();
  if (raw === 'off' || raw === 'disabled' || raw === '0' || raw === 'false') {
    return 'off';
  }
  if (raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  return 'medium';
}

export function createBedrockClient(
  regionOrOpts?: string | { region?: string; bearerToken?: string },
): BedrockRuntimeClient {
  const opts =
    typeof regionOrOpts === 'string'
      ? { region: regionOrOpts }
      : (regionOrOpts ?? {});
  const region =
    opts.region ??
    process.env.BEDROCK_REGION ??
    process.env.AWS_REGION ??
    'eu-west-2';
  const bearer =
    opts.bearerToken?.trim() ||
    process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() ||
    undefined;
  return new BedrockRuntimeClient({
    region,
    ...(bearer ? { token: { token: bearer } } : {}),
  });
}

export type ParsedToolUse = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
};

export type ConverseTurnResult = {
  stopReason: string;
  assistantContent: ContentBlock[];
  toolUses: ParsedToolUse[];
  text: string;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
};

type OpenToolBlock = {
  toolUseId: string;
  name: string;
  inputJson: string;
};

export type StreamDelta =
  | { type: 'token'; text: string }
  | {
      type: 'usage';
      cacheReadInputTokens: number;
      cacheWriteInputTokens: number;
    };

/**
 * One ConverseStream turn with optional tools and system cachePoints.
 */
export async function* streamConverseTurn(params: {
  system: SystemContentBlock[];
  messages: Message[];
  tools?: ToolConfiguration['tools'];
  client?: BedrockRuntimeClient;
  modelId?: string;
  signal?: AbortSignal;
  /** Override default output token budget. */
  maxTokens?: number;
  /** Override extended-thinking tier (default: getNovaReasoningEffort()). */
  reasoningEffort?: NovaReasoningEffort;
}): AsyncGenerator<StreamDelta, ConverseTurnResult> {
  if (params.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const client = params.client ?? createBedrockClient();
  const modelId = params.modelId ?? getNovaModelId();
  const reasoningEffort = params.reasoningEffort ?? getNovaReasoningEffort();

  const additionalModelRequestFields =
    reasoningEffort === 'off'
      ? undefined
      : {
          reasoningConfig: {
            type: 'enabled',
            maxReasoningEffort: reasoningEffort,
          },
        };

  // Nova's "high" reasoning tier forbids temperature/topP/maxTokens entirely —
  // leave inferenceConfig unset only in that case.
  const maxTokens =
    params.maxTokens ??
    (reasoningEffort === 'off'
      ? DEFAULT_MAX_OUTPUT_TOKENS
      : DEFAULT_MAX_REASONING_OUTPUT_TOKENS);

  const command = new ConverseStreamCommand({
    modelId,
    system: params.system,
    messages: params.messages,
    toolConfig: params.tools?.length
      ? { tools: params.tools }
      : undefined,
    ...(reasoningEffort === 'high' ? {} : { inferenceConfig: { maxTokens } }),
    ...(additionalModelRequestFields ? { additionalModelRequestFields } : {}),
  });

  const response = await client.send(command, {
    abortSignal: params.signal,
  });

  if (!response.stream) {
    throw new Error('No stream from Bedrock ConverseStream');
  }

  const assistantContent: ContentBlock[] = [];
  const toolUses: ParsedToolUse[] = [];
  let text = '';
  let stopReason = 'end_turn';
  let cacheReadInputTokens = 0;
  let cacheWriteInputTokens = 0;
  let currentText = '';
  let openTool: OpenToolBlock | null = null;

  const flushText = () => {
    if (currentText) {
      assistantContent.push({ text: currentText });
      currentText = '';
    }
  };

  for await (const event of response.stream) {
    if (params.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (event.contentBlockStart?.start?.toolUse) {
      flushText();
      const tu = event.contentBlockStart.start.toolUse;
      openTool = {
        toolUseId: tu.toolUseId ?? '',
        name: tu.name ?? '',
        inputJson: '',
      };
    }

    if (event.contentBlockDelta?.delta?.text) {
      const chunk = event.contentBlockDelta.delta.text;
      text += chunk;
      currentText += chunk;
      yield { type: 'token', text: chunk };
    }

    if (event.contentBlockDelta?.delta?.toolUse?.input) {
      if (openTool) {
        openTool.inputJson += event.contentBlockDelta.delta.toolUse.input;
      }
    }

    // Extended-thinking deltas stream as reasoningContent, not text — leave
    // them out of the chat timeline (still billed as output tokens).

    if (event.contentBlockStop) {
      if (openTool) {
        let input: Record<string, unknown> = {};
        try {
          input = openTool.inputJson
            ? (JSON.parse(openTool.inputJson) as Record<string, unknown>)
            : {};
        } catch {
          input = { _raw: openTool.inputJson };
        }
        const parsed: ParsedToolUse = {
          toolUseId: openTool.toolUseId,
          name: openTool.name,
          input,
        };
        toolUses.push(parsed);
        assistantContent.push({
          toolUse: {
            toolUseId: parsed.toolUseId,
            name: parsed.name,
            input: parsed.input as never,
          },
        });
        openTool = null;
      } else {
        flushText();
      }
    }

    if (event.messageStop?.stopReason) {
      stopReason = event.messageStop.stopReason;
    }

    if (event.metadata?.usage) {
      const u = event.metadata.usage;
      cacheReadInputTokens = u.cacheReadInputTokens ?? cacheReadInputTokens;
      cacheWriteInputTokens = u.cacheWriteInputTokens ?? cacheWriteInputTokens;
    }
  }

  flushText();

  yield {
    type: 'usage',
    cacheReadInputTokens,
    cacheWriteInputTokens,
  };

  return {
    stopReason,
    assistantContent,
    toolUses,
    text,
    cacheReadInputTokens,
    cacheWriteInputTokens,
  };
}

/** Phase 0 smoke — text-only ping with system cachePoint. */
export async function* streamPing(params: {
  userText?: string;
  client?: BedrockRuntimeClient;
  modelId?: string;
  signal?: AbortSignal;
}): AsyncGenerator<StreamDelta, Omit<ConverseTurnResult, 'assistantContent' | 'toolUses'> & { text: string }> {
  const system: SystemContentBlock[] = [
    {
      text: [
        'You are WalkCroach IDE Phase 0 smoke test.',
        'Reply in one short sentence confirming you received the ping.',
        'Do not call tools. Do not invent file changes.',
      ].join(' '),
    },
    { cachePoint: { type: 'default' } },
  ];

  const result = yield* streamConverseTurn({
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            text:
              params.userText?.trim() ||
              'Ping. Respond with a short acknowledgment only.',
          },
        ],
      },
    ],
    client: params.client,
    modelId: params.modelId,
    signal: params.signal,
  });

  return {
    text: result.text,
    cacheReadInputTokens: result.cacheReadInputTokens,
    cacheWriteInputTokens: result.cacheWriteInputTokens,
    stopReason: result.stopReason,
  };
}
