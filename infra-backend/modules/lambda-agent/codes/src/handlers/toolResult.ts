import { createDbClient } from '@walkcroach/db';
import { continueAfterTool, type ToolResultInput } from '@walkcroach/agent-harness';
import { writeNdjson } from '../http.js';

export type ToolResultBody = ToolResultInput & {
  projectId: string;
};

export async function runToolResultStream(
  sessionId: string,
  body: ToolResultBody,
  write: (chunk: string) => void,
): Promise<void> {
  const db = createDbClient();
  try {
    await writeNdjson(
      write,
      continueAfterTool({
        db,
        sessionId,
        projectId: body.projectId,
        toolResult: {
          toolCallId: body.toolCallId,
          ok: body.ok,
          exitCode: body.exitCode,
          stdout: body.stdout,
          stderr: body.stderr,
          output: body.output,
        },
      }),
    );
  } finally {
    await db.close();
  }
}
