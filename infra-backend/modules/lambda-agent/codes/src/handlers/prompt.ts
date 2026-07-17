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

export type PromptBody = {
  message: string;
  projectId: string;
  mode?: 'plan' | 'build';
};

export async function runPromptStream(
  sessionId: string,
  body: PromptBody,
  write: (chunk: string) => void,
): Promise<void> {
  const db = createDbClient();
  try {
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
