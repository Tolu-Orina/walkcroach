import { errorFromResponse, TransientError, WalkCroachError } from './errors.js';
import type { WalkCroachConfig } from './types.js';
import { PRODUCTION_API_ORIGIN } from './defaults.js';

const DEFAULT_BASE_URL = PRODUCTION_API_ORIGIN;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPTS = 3;

export type Transport = {
  request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts?: { body?: unknown; query?: Record<string, string | number | undefined> },
  ): Promise<T>;
};

function isBrowserLike(): boolean {
  // `globalThis.window` is present in browsers and absent in Node, Deno, Bun,
  // and Cloudflare Workers. Workers are a legitimate place to hold a service
  // key; a page served to end users is not.
  return typeof (globalThis as { window?: unknown }).window !== 'undefined';
}

/** Full-jitter backoff, matching the server-side db client's retry shape. */
function backoffMs(attempt: number, random: () => number = Math.random): number {
  return Math.floor(random() * Math.min(1_000, 100 * 2 ** attempt));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createTransport(config: WalkCroachConfig): Transport {
  const { apiKey, accessToken } = config;

  if (!apiKey && !accessToken) {
    throw new WalkCroachError(
      'either apiKey or accessToken is required',
      0,
      null,
    );
  }
  if (apiKey && isBrowserLike() && config.allowBrowserApiKey !== true) {
    // A service key in page-served JavaScript is a full tenant compromise, and
    // it is not recoverable by rotating one user's password. Refuse by default.
    throw new WalkCroachError(
      'apiKey must not be used in a browser — anything shipped to a page is public. ' +
        'Use accessToken for user-context calls, or set allowBrowserApiKey:true if this ' +
        'is a trusted non-browser runtime that defines `window`.',
      0,
      null,
    );
  }

  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = Math.max(1, config.retry?.attempts ?? DEFAULT_ATTEMPTS);
  const doFetch = config.fetch ?? globalThis.fetch;

  if (typeof doFetch !== 'function') {
    throw new WalkCroachError(
      'no fetch implementation available — pass one via config.fetch on Node <18',
      0,
      null,
    );
  }

  async function once<T>(
    method: string,
    url: string,
    body: unknown,
  ): Promise<{ ok: true; value: T } | { ok: false; err: WalkCroachError }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method,
        headers: {
          authorization: `Bearer ${apiKey ?? accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': `@walkcroach/sdk/0.1.0`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const requestId =
        res.headers.get('x-amzn-requestid') ?? res.headers.get('x-request-id');
      const retryAfter = res.headers.get('retry-after');
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : null;

      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { error: text.slice(0, 500) };
        }
      }

      if (!res.ok) {
        return {
          ok: false,
          err: errorFromResponse(
            res.status,
            parsed,
            requestId,
            Number.isFinite(retryAfterMs) ? retryAfterMs : null,
          ),
        };
      }
      return { ok: true, value: parsed as T };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        err: new TransientError(
          aborted ? `request timed out after ${timeoutMs}ms` : String(err),
          0,
          null,
        ),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async request<T>(
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
      path: string,
      opts: {
        body?: unknown;
        query?: Record<string, string | number | undefined>;
      } = {},
    ): Promise<T> {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined && v !== '') qs.set(k, String(v));
      }
      const url = `${baseUrl}${path}${qs.toString() ? `?${qs}` : ''}`;

      let last: WalkCroachError | null = null;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const result = await once<T>(method, url, opts.body);
        if (result.ok) return result.value;
        last = result.err;
        if (!result.err.retryable || attempt === attempts - 1) break;
        const wait =
          result.err instanceof Object && 'retryAfterMs' in result.err
            ? ((result.err as { retryAfterMs: number | null }).retryAfterMs ??
              backoffMs(attempt))
            : backoffMs(attempt);
        await sleep(wait);
      }
      throw last;
    },
  };
}
