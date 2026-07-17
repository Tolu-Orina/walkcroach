/**
 * Streaming prompt handler (API Gateway ResponseTransferMode: STREAM).
 *
 * On Lambda, wrap with:
 *   export const handler = awslambda.streamifyResponse(streamHandler)
 *
 * Local server uses the same core via runPromptForLocal.
 */
import { createDbClient } from '@walkcroach/db';
import { runPromptTurn } from '@walkcroach/agent-harness';
import { writeNdjson } from '../http.js';
import { assertCredits, debitCredits } from './billing.js';

export type PromptBody = {
  message: string;
  projectId: string;
  mode?: 'plan' | 'build';
};

export async function runPromptStream(
  sessionId: string,
  body: PromptBody,
  write: (chunk: string) => void,
  ownerId?: string,
): Promise<void> {
  const db = createDbClient();
  try {
    if (ownerId) {
      const credits = await assertCredits(db, ownerId, 'agent_turn');
      if (!credits.ok) {
        await writeNdjson(
          write,
          (async function* () {
            yield {
              type: 'error' as const,
              message: `insufficient credits (${credits.remaining} remaining)`,
            };
          })(),
        );
        return;
      }
      await debitCredits(db, ownerId, 'agent_turn', body.projectId);
    }

    await writeNdjson(
      write,
      runPromptTurn({
        db,
        sessionId,
        projectId: body.projectId,
        message: body.message,
        mode: body.mode,
      }),
    );
  } finally {
    await db.close();
  }
}
