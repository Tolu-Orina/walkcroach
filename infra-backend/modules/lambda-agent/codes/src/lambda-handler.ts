/**
 * Single Lambda entry for API Gateway response streaming.
 * All routes use response-streaming-invocations (streamifyResponse).
 */
import { normalizeEvent } from './event.js';
import { runPromptStream, type PromptBody } from './handlers/prompt.js';
import { runToolResultStream, type ToolResultBody } from './handlers/toolResult.js';
import { handleRest } from './handlers/rest.js';
import { ensureRuntimeSecrets } from './secrets.js';
import { CORS_HEADERS } from './http.js';

function writeHttp(
  responseStream: NodeJS.WritableStream,
  statusCode: number,
  headers: Record<string, string>,
  body: string,
): void {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers,
  });
  stream.write(body);
  stream.end();
}

async function streamHandler(
  event: unknown,
  responseStream: NodeJS.WritableStream,
  _context: unknown,
): Promise<void> {
  try {
    await ensureRuntimeSecrets();
    const req = normalizeEvent(event);

    if (req.method === 'OPTIONS') {
      writeHttp(responseStream, 204, CORS_HEADERS, '');
      return;
    }

    const promptMatch = req.path.match(/\/sessions\/([^/]+)\/prompt\/?$/);
    if (req.method === 'POST' && promptMatch) {
      const body = JSON.parse(req.body ?? '{}') as PromptBody;
      const stream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          'content-type': 'application/x-ndjson',
          ...CORS_HEADERS,
        },
      });
      await runPromptStream(promptMatch[1]!, body, (chunk) => {
        stream.write(chunk);
      });
      stream.end();
      return;
    }

    const toolMatch = req.path.match(/\/sessions\/([^/]+)\/tool-result\/?$/);
    if (req.method === 'POST' && toolMatch) {
      const body = JSON.parse(req.body ?? '{}') as ToolResultBody;
      const stream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: {
          'content-type': 'application/x-ndjson',
          ...CORS_HEADERS,
        },
      });
      await runToolResultStream(toolMatch[1]!, body, (chunk) => {
        stream.write(chunk);
      });
      stream.end();
      return;
    }

    const result = await handleRest(
      req.method,
      req.path,
      req.body,
      req.pathParameters,
    );
    writeHttp(
      responseStream,
      result.statusCode,
      result.headers,
      result.body,
    );
  } catch (err) {
    console.error(err);
    try {
      writeHttp(
        responseStream,
        500,
        {
          'content-type': 'application/json',
          ...CORS_HEADERS,
        },
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } catch {
      responseStream.end();
    }
  }
}

export const handler = awslambda.streamifyResponse(streamHandler);
