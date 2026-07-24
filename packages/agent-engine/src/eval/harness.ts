/**
 * Lightweight eval harness helpers for golden agent-loop tasks.
 * Used by `src/eval/golden.test.ts` — scripted Bedrock turns + fake host.
 */

import type { ConverseTurnResult } from '../bedrock.js';
import type { ParsedToolUse } from '../bedrock.js';

export type ScriptedTurn = {
  text?: string;
  toolUses?: Array<{
    name: string;
    input?: Record<string, unknown>;
  }>;
  stopReason?: string;
};

let toolIdSeq = 0;

export function scriptedConverse(
  turns: ScriptedTurn[],
): () => AsyncGenerator<
  { type: 'token'; text: string },
  ConverseTurnResult
> {
  let i = 0;
  return async function* () {
    const turn = turns[Math.min(i, turns.length - 1)] ?? { text: 'done' };
    i += 1;
    const text = turn.text ?? (turn.toolUses?.length ? '' : 'done');
    if (text) yield { type: 'token' as const, text };

    const toolUses: ParsedToolUse[] = (turn.toolUses ?? []).map((t) => {
      toolIdSeq += 1;
      return {
        toolUseId: `eval-${toolIdSeq}`,
        name: t.name,
        input: t.input ?? {},
      };
    });

    const assistantContent: ConverseTurnResult['assistantContent'] = [];
    if (text) assistantContent.push({ text });
    for (const tu of toolUses) {
      assistantContent.push({
        toolUse: {
          toolUseId: tu.toolUseId,
          name: tu.name,
          input: tu.input as never,
        },
      });
    }

    return {
      stopReason: turn.stopReason ?? (toolUses.length ? 'tool_use' : 'end_turn'),
      assistantContent,
      toolUses,
      text,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    };
  };
}

export function resetEvalToolIds(): void {
  toolIdSeq = 0;
}

/** Golden task ids shipped with the harness. */
export const GOLDEN_TASK_IDS = [
  'scaffold-write',
  'fix-edit',
  'verify-gate',
] as const;

export type GoldenTaskId = (typeof GOLDEN_TASK_IDS)[number];
