import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  InvokeModelCommand,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { AgentEvent } from './types.js';
import type { toBedrockTools } from './tools.js';

function getClient() {
  // Lambda: IAM via execution role. Local: optional AWS_BEARER_TOKEN_BEDROCK from .env.
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'eu-west-2',
  });
}

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

/** Optional Bedrock Guardrail (PROMPT_ATTACK / leakage). Empty = disabled. */
export function getGuardrailConfig():
  | { guardrailIdentifier: string; guardrailVersion: string; trace?: 'enabled' | 'disabled' | 'enabled_full' }
  | undefined {
  const id =
    process.env.BEDROCK_GUARDRAIL_ID?.trim() ||
    process.env.BEDROCK_GUARDRAIL_IDENTIFIER?.trim();
  const version =
    process.env.BEDROCK_GUARDRAIL_VERSION?.trim() || 'DRAFT';
  if (!id) return undefined;
  return {
    guardrailIdentifier: id,
    guardrailVersion: version,
    trace:
      process.env.BEDROCK_GUARDRAIL_TRACE === '1' ||
      process.env.BEDROCK_GUARDRAIL_TRACE === 'true'
        ? 'enabled'
        : 'disabled',
  };
}

/**
 * Wrap plain text ContentBlocks as guardContent so PROMPT_ATTACK evaluates
 * only user text (not system prompt / RAG / images).
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-use-converse-api.html
 */
export function wrapUserTextForGuardrail(
  content: ContentBlock[],
): ContentBlock[] {
  return content.map((block) => {
    if ('text' in block && typeof block.text === 'string') {
      return {
        guardContent: {
          text: { text: block.text },
        },
      } as ContentBlock;
    }
    return block;
  });
}

/** Apply guardContent wrapping to the latest user message only. */
export function tagLatestUserMessageForGuardrail(
  messages: Message[],
): Message[] {
  if (messages.length === 0) return messages;
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return messages;
  return messages.map((m, i) => {
    if (i !== lastUser || !m.content) return m;
    return {
      ...m,
      content: wrapUserTextForGuardrail(m.content),
    };
  });
}

/** Embed text with Titan Text Embeddings V2 (1024-dim). */
export async function embedText(text: string): Promise<number[]> {
  const client = getClient();
  const modelId = getTitanEmbedModelId();
  const res = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text,
        dimensions: 1024,
        normalize: true,
      }),
    }),
  );
  const body = JSON.parse(new TextDecoder().decode(res.body)) as {
    embedding: number[];
  };
  return body.embedding;
}

export type ConverseMessage = Message;

export type ParsedToolUse = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
};

export type ConverseTurnResult = {
  stopReason: string;
  /** Full assistant message content blocks (text + toolUse) for history */
  assistantContent: ContentBlock[];
  toolUses: ParsedToolUse[];
  text: string;
  /** True when Bedrock Guardrails blocked the turn. */
  guardrailIntervened?: boolean;
};

type OpenToolBlock = {
  toolUseId: string;
  name: string;
  inputJson: string;
};

/**
 * One ConverseStream turn: yield token events; return structured tool uses.
 * Does not decide how to execute tools — that is the loop's job.
 */
export async function* streamConverseTurn(params: {
  system?: string;
  messages: Message[];
  tools?: ReturnType<typeof toBedrockTools>;
}): AsyncGenerator<AgentEvent, ConverseTurnResult> {
  const client = getClient();
  const guardrail = getGuardrailConfig();
  const messages = guardrail
    ? tagLatestUserMessageForGuardrail(params.messages)
    : params.messages;

  const command = new ConverseStreamCommand({
    modelId: getNovaModelId(),
    system: params.system ? [{ text: params.system }] : undefined,
    messages,
    toolConfig: params.tools?.length
      ? { tools: params.tools as never }
      : undefined,
    ...(guardrail
      ? {
          guardrailConfig: {
            guardrailIdentifier: guardrail.guardrailIdentifier,
            guardrailVersion: guardrail.guardrailVersion,
            trace: guardrail.trace,
            streamProcessingMode: 'sync',
          },
        }
      : {}),
  });

  const response = await client.send(command);
  if (!response.stream) {
    yield { type: 'error', message: 'No stream from Bedrock' };
    return {
      stopReason: 'error',
      assistantContent: [],
      toolUses: [],
      text: '',
    };
  }

  const assistantContent: ContentBlock[] = [];
  const toolUses: ParsedToolUse[] = [];
  let text = '';
  let stopReason = 'end_turn';
  let guardrailIntervened = false;

  let currentText = '';
  let openTool: OpenToolBlock | null = null;

  const flushText = () => {
    if (currentText) {
      assistantContent.push({ text: currentText });
      currentText = '';
    }
  };

  for await (const event of response.stream) {
    if (event.messageStart) {
      // role starts — nothing to do
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
      if (stopReason === 'guardrail_intervened') {
        guardrailIntervened = true;
      }
    }
  }

  flushText();

  if (guardrailIntervened) {
    const blocked =
      text.trim() ||
      'That request was blocked by safety filters. Try rephrasing without asking for internal instructions or system details.';
    if (!text.trim()) {
      yield { type: 'token', text: blocked };
      text = blocked;
      assistantContent.push({ text: blocked });
    }
    yield {
      type: 'warning',
      message: 'Request blocked by Bedrock Guardrails (prompt attack / leakage filter).',
    };
  }

  return {
    stopReason,
    assistantContent,
    toolUses: guardrailIntervened ? [] : toolUses,
    text,
    guardrailIntervened,
  };
}

/** @deprecated use streamConverseTurn — kept for simple text-only callers */
export async function* streamConverse(params: {
  system?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: Array<{ text?: string; toolUse?: unknown; toolResult?: unknown }>;
  }>;
  tools?: ReturnType<typeof toBedrockTools>;
}): AsyncGenerator<AgentEvent> {
  const result = yield* streamConverseTurn({
    system: params.system,
    messages: params.messages as Message[],
    tools: params.tools,
  });
  yield {
    type: 'done',
    reason: result.toolUses.length > 0 ? 'awaiting_tool' : 'complete',
  };
}
