import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
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

export function createBedrockClient(region?: string): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region:
      region ??
      process.env.BEDROCK_REGION ??
      process.env.AWS_REGION ??
      'eu-west-2',
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
}): AsyncGenerator<StreamDelta, ConverseTurnResult> {
  if (params.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const client = params.client ?? createBedrockClient();
  const modelId = params.modelId ?? getNovaModelId();

  const command = new ConverseStreamCommand({
    modelId,
    system: params.system,
    messages: params.messages,
    toolConfig: params.tools?.length
      ? { tools: params.tools }
      : undefined,
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
