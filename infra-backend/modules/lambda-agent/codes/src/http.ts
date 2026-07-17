/**
 * Minimal Lambda streaming helpers.
 * Production handlers use awslambda.streamifyResponse (Node 20 Lambda runtime).
 * Local server uses Node ReadableStream-style NDJSON.
 */

import type { AgentEvent } from '@walkcroach/agent-harness';

export async function writeNdjson(
  write: (chunk: string) => void,
  events: AsyncIterable<AgentEvent>,
): Promise<void> {
  for await (const event of events) {
    write(`${JSON.stringify(event)}\n`);
  }
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(body),
  };
}
