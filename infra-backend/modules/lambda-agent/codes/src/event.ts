/**
 * Normalize API Gateway REST (v1) and HTTP API (v2) proxy events.
 */
export type HttpRequest = {
  method: string;
  path: string;
  body: string | undefined;
  pathParameters: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
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

export function normalizeEvent(event: unknown): HttpRequest {
  const e = event as Record<string, unknown>;

  // HTTP API v2
  if (e.version === '2.0' || e.requestContext) {
    const ctx = e.requestContext as Record<string, unknown> | undefined;
    const http = ctx?.http as Record<string, unknown> | undefined;
    if (http?.method && (e.rawPath || http.path)) {
      return {
        method: String(http.method),
        path: String(e.rawPath ?? http.path),
        body: (e.body as string | undefined) ?? undefined,
        pathParameters:
          (e.pathParameters as Record<string, string | undefined>) ?? {},
        headers: normalizeHeaders(
          e.headers as Record<string, string | undefined> | undefined,
        ),
      };
    }
  }

  // REST API v1
  return {
    method: String(e.httpMethod ?? 'GET'),
    path: String(e.path ?? '/'),
    body: (e.body as string | undefined) ?? undefined,
    pathParameters:
      (e.pathParameters as Record<string, string | undefined>) ?? {},
    headers: normalizeHeaders(
      e.headers as Record<string, string | undefined> | undefined,
    ),
  };
}
