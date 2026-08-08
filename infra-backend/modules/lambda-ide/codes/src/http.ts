/** Restrict browser origins in prod via CORS_ALLOW_ORIGIN (comma-separated). Default * for local. */
import { randomUUID } from 'node:crypto';

export function getCorsHeaders(): Record<string, string> {
  const configured = process.env.CORS_ALLOW_ORIGIN?.trim();
  const origin =
    configured && configured.length > 0 ? configured.split(',')[0]!.trim() : '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers':
      'content-type, accept, authorization, x-request-id',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-expose-headers':
      'x-request-id, retry-after, x-ratelimit-limit, x-ratelimit-remaining, x-credits-cost',
  };
}

/** Credit-pool headers (monthly quota). Attached after successful debits and on 429. */
export function creditHeaders(opts: {
  remaining: number;
  limit: number;
  cost: number;
}): Record<string, string> {
  return {
    'x-ratelimit-limit': String(Math.max(0, Math.floor(opts.limit))),
    'x-ratelimit-remaining': String(Math.max(0, Math.floor(opts.remaining))),
    'x-credits-cost': String(Math.max(0, Math.floor(opts.cost))),
  };
}

export const CORS_HEADERS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get(_t, prop: string) {
    return getCorsHeaders()[prop];
  },
  ownKeys() {
    return Object.keys(getCorsHeaders());
  },
  getOwnPropertyDescriptor(_t, prop) {
    const v = getCorsHeaders()[prop as string];
    if (v === undefined) return undefined;
    return { configurable: true, enumerable: true, value: v };
  },
});

export function jsonResponse(
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  const requestId =
    extraHeaders?.['x-request-id']?.trim() ||
    extraHeaders?.['X-Request-Id']?.trim() ||
    randomUUID();

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...getCorsHeaders(),
    'x-request-id': requestId,
    ...(extraHeaders ?? {}),
  };
  // Ensure caller-supplied headers cannot strip correlation.
  headers['x-request-id'] = requestId;

  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}
