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

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, accept, authorization',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

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
      ...CORS_HEADERS,
    },
    body: JSON.stringify(body),
  };
}
