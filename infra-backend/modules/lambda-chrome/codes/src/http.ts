/** Restrict browser origins in prod via CORS_ALLOW_ORIGIN (comma-separated). Default * for local. */
export function getCorsHeaders(): Record<string, string> {
  const configured = process.env.CORS_ALLOW_ORIGIN?.trim();
  const origin =
    configured && configured.length > 0 ? configured.split(',')[0]!.trim() : '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, accept, authorization',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...getCorsHeaders(),
    },
    body: JSON.stringify(body),
  };
}
