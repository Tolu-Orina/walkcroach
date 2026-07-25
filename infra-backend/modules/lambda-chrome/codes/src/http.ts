/**
 * Chrome BFF CORS.
 * - Reflect chrome-extension:// Origins (Bearer auth; required without host_permissions)
 * - Reflect configured SPA origin(s)
 * - Fall back to first configured value or *
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const corsAls = new AsyncLocalStorage<{ requestOrigin?: string }>();

export function runWithRequestOrigin<T>(
  requestOrigin: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return corsAls.run({ requestOrigin }, fn);
}

export function getCorsHeaders(): Record<string, string> {
  const configured = process.env.CORS_ALLOW_ORIGIN?.trim();
  const allowlist =
    configured && configured.length > 0
      ? configured.split(',').map((s) => s.trim()).filter(Boolean)
      : ['*'];
  const requestOrigin = corsAls.getStore()?.requestOrigin?.trim();

  let origin = allowlist[0] ?? '*';
  if (requestOrigin) {
    if (allowlist.includes('*')) {
      origin = requestOrigin;
    } else if (allowlist.includes(requestOrigin)) {
      origin = requestOrigin;
    } else if (requestOrigin.startsWith('chrome-extension://')) {
      // Echo published extension ID(s) when configured; otherwise any extension
      // Origin (needed before the CWS ID is known / for local unpacked builds).
      const ids = (process.env.CHROME_EXTENSION_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const extensionId = requestOrigin.slice('chrome-extension://'.length);
      if (ids.length === 0 || ids.includes(extensionId)) {
        origin = requestOrigin;
      }
    }
  }

  const headers: Record<string, string> = {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, accept, authorization',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };
  if (origin !== '*') {
    headers.vary = 'Origin';
  }
  return headers;
}

export const CORS_HEADERS: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
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
  },
);

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
