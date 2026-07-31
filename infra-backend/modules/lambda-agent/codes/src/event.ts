/**
 * Normalize API Gateway REST (v1) and HTTP API (v2) proxy events.
 */
export type HttpRequest = {
  method: string;
  path: string;
  body: string | undefined;
  pathParameters: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  queryString: string;
};

function normalizeHeaders(
  raw: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  if (!raw) return {};
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

function queryFromEvent(e: Record<string, unknown>): string {
  if (typeof e.rawQueryString === 'string') return e.rawQueryString;
  const qs = e.queryStringParameters as Record<string, string> | undefined;
  if (qs && typeof qs === 'object') {
    return new URLSearchParams(qs).toString();
  }
  return '';
}

function decodeBody(
  body: string | undefined,
  isBase64Encoded: unknown,
): string | undefined {
  if (body == null || body === '') return body ?? undefined;
  if (isBase64Encoded === true) {
    return Buffer.from(body, 'base64').toString('utf8');
  }
  return body;
}

export function normalizeEvent(event: unknown): HttpRequest {
  const e = event as Record<string, unknown>;
  const isBase64 = e.isBase64Encoded;

  // HTTP API v2
  if (e.version === '2.0' || e.requestContext) {
    const ctx = e.requestContext as Record<string, unknown> | undefined;
    const http = ctx?.http as Record<string, unknown> | undefined;
    if (http?.method && (e.rawPath || http.path)) {
      return {
        method: String(http.method),
        path: String(e.rawPath ?? http.path),
        body: decodeBody(e.body as string | undefined, isBase64),
        pathParameters:
          (e.pathParameters as Record<string, string | undefined>) ?? {},
        headers: normalizeHeaders(
          e.headers as Record<string, string | undefined> | undefined,
        ),
        queryString: queryFromEvent(e),
      };
    }
  }

  // REST API v1
  return {
    method: String(e.httpMethod ?? 'GET'),
    path: String(e.path ?? '/'),
    body: decodeBody(e.body as string | undefined, isBase64),
    pathParameters:
      (e.pathParameters as Record<string, string | undefined>) ?? {},
    headers: normalizeHeaders(
      e.headers as Record<string, string | undefined> | undefined,
    ),
    queryString: queryFromEvent(e),
  };
}
