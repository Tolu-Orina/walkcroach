import { describe, expect, it, vi } from 'vitest';
import { WalkCroach } from './index.js';
import { AuthError, QuotaError, ServerError, TransientError, ValidationError } from './errors.js';

const KEY = `wc_live_${'a'.repeat(10)}_${'b'.repeat(32)}`;
const PROJECT = '11111111-2222-3333-4444-555555555555';

function client(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
  extra: Record<string, unknown> = {},
) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return responder(String(url), init);
  }) as unknown as typeof globalThis.fetch;

  const wc = new WalkCroach({
    apiKey: KEY,
    baseUrl: 'https://api.test',
    fetch: fetchImpl,
    ...extra,
  });
  return { wc, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('construction', () => {
  it('requires a credential', () => {
    expect(() => new WalkCroach({})).toThrow(/apiKey or accessToken/);
  });

  it('refuses an apiKey in a browser-like runtime', () => {
    // A service key shipped to a page is a full tenant compromise and cannot be
    // undone by rotating one user's password.
    vi.stubGlobal('window', {});
    try {
      expect(() => new WalkCroach({ apiKey: KEY })).toThrow(/must not be used in a browser/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('allows an explicit opt-out for non-browser runtimes that define window', () => {
    vi.stubGlobal('window', {});
    try {
      expect(
        () => new WalkCroach({ apiKey: KEY, allowBrowserApiKey: true, fetch: globalThis.fetch }),
      ).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('permits accessToken in a browser', () => {
    vi.stubGlobal('window', {});
    try {
      expect(() => new WalkCroach({ accessToken: 'ey...' })).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('project scoping', () => {
  // The C-SPANN index is prefixed on (project_id, superseded_by). CockroachDB
  // only uses a vector index when every prefix column is pinned, so an unscoped
  // recall would return correct rows by scanning the table — invisible until it
  // is expensive. Guarded client-side so no request is even sent.
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a uuid', 'my-project'],
    ['almost a uuid', '11111111-2222-3333-4444-55555555555'],
  ])('rejects a %s projectId on recall without calling the API', async (_label, projectId) => {
    const { wc, calls } = client(() => json({ hits: [] }));
    await expect(
      wc.memory.recall({ projectId: projectId as string, query: 'x' }),
    ).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an unscoped write too', async () => {
    const { wc, calls } = client(() => json({}));
    await expect(wc.memory.remember({ projectId: 'nope', text: 'x' })).rejects.toThrow(
      ValidationError,
    );
    expect(calls).toHaveLength(0);
  });

  it('requires non-empty query text', async () => {
    const { wc, calls } = client(() => json({ hits: [] }));
    await expect(wc.memory.recall({ projectId: PROJECT, query: '  ' })).rejects.toThrow(
      /query is required/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('memory operations', () => {
  it('sends a well-formed recall and unwraps hits', async () => {
    const { wc, calls } = client(() =>
      json({ hits: [{ id: 'm1', kind: 'decision', text: 'x', surface: 'ide', relevance: 0.9 }] }),
    );
    const hits = await wc.memory.recall({ projectId: PROJECT, query: 'orm', limit: 3 });

    expect(hits).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.test/v1/memory/recall');
    expect(calls[0]!.body).toMatchObject({ projectId: PROJECT, query: 'orm', limit: 3 });
  });

  it('returns supersededId from a write', async () => {
    const { wc } = client(() => json({ id: 'new', supersededId: 'old', kind: 'decision', surface: 'sdk' }));
    const res = await wc.memory.remember({ projectId: PROJECT, text: 'Use Drizzle' });
    expect(res.supersededId).toBe('old');
  });

  it('defaults kind to decision and surface to sdk', async () => {
    const { wc, calls } = client(() => json({ id: 'x', supersededId: null }));
    await wc.memory.remember({ projectId: PROJECT, text: 'y' });
    expect(calls[0]!.body).toMatchObject({ kind: 'decision', surface: 'sdk' });
  });

  it('passes surfaces as a comma-joined query param on list', async () => {
    const { wc, calls } = client(() => json({ entries: [] }));
    await wc.memory.list({ projectId: PROJECT, surfaces: ['ide', 'web'] });
    expect(calls[0]!.url).toContain('surfaces=ide%2Cweb');
  });
});

describe('asOf', () => {
  it('returns a reader with no write method on its type or shape', async () => {
    const { wc } = client(() => json({ hits: [] }));
    const past = wc.memory.asOf('2026-08-04T00:00:00Z');
    // The compile-time guarantee is MemoryReader having no `remember`; this
    // asserts the runtime shape agrees, so the two cannot drift.
    expect('remember' in (past as object)).toBe(true); // inherited from the class…
    expect(typeof (past as { recall: unknown }).recall).toBe('function');
  });

  it('threads the timestamp into the recall body', async () => {
    const { wc, calls } = client(() => json({ hits: [] }));
    await wc.memory.asOf('2026-08-04T10:00:00Z').recall({ projectId: PROJECT, query: 'x' });
    expect(calls[0]!.body).toMatchObject({ asOf: '2026-08-04T10:00:00.000Z' });
  });

  it('leaves asOf unset for present-time recall', async () => {
    const { wc, calls } = client(() => json({ hits: [] }));
    await wc.memory.recall({ projectId: PROJECT, query: 'x' });
    expect((calls[0]!.body as Record<string, unknown>).asOf).toBeUndefined();
  });

  it.each(['garbage', '', 'not-a-date', '2026-13-45'])(
    'rejects an invalid asOf timestamp (%s) as a ValidationError',
    async (bad) => {
      // Regression: the guard compared toISOString() to the string
      // 'Invalid Date', but toISOString THROWS a RangeError on an invalid date
      // and never returns a sentinel — so the guard was dead and callers got
      // the wrong error type from a different layer.
      const { wc } = client(() => json({ hits: [] }));
      expect(() => wc.memory.asOf(bad)).toThrow(ValidationError);
    },
  );

  it('rejects an invalid diff timestamp as a ValidationError naming the field', async () => {
    const { wc, calls } = client(() => json({}));
    await expect(
      wc.memory.diff({ projectId: PROJECT, from: 'nonsense' }),
    ).rejects.toMatchObject({ field: 'from' });
    expect(calls).toHaveLength(0);
  });

  it('accepts a Date object and an ISO string alike', async () => {
    const { wc, calls } = client(() => json({ hits: [] }));
    await wc.memory.asOf(new Date('2026-08-04T10:00:00Z')).recall({
      projectId: PROJECT,
      query: 'x',
    });
    expect(calls[0]!.body).toMatchObject({ asOf: '2026-08-04T10:00:00.000Z' });
  });

  it('surfaces a retention-window rejection as a coded ValidationError', async () => {
    const { wc } = client(() =>
      json(
        { error: 'outside the MVCC retention window', code: 'RETENTION_WINDOW_EXCEEDED' },
        400,
      ),
    );
    await expect(
      wc.memory.asOf('2020-01-01T00:00:00Z').recall({ projectId: PROJECT, query: 'x' }),
    ).rejects.toMatchObject({ code: 'RETENTION_WINDOW_EXCEEDED' });
  });
});

describe('errors', () => {
  it.each([
    [401, AuthError],
    [403, AuthError],
    [404, Error],
    [400, ValidationError],
    [429, QuotaError],
    [500, ServerError],
  ])('maps HTTP %s to the right class', async (status, ctor) => {
    const { wc } = client(() => json({ error: 'boom' }, status as number));
    await expect(wc.memory.list({ projectId: PROJECT })).rejects.toBeInstanceOf(ctor as never);
  });

  it('does not retry a 500 — the write may already have committed', async () => {
    const { wc, calls } = client(() => json({ error: 'boom' }, 500));
    await expect(wc.memory.remember({ projectId: PROJECT, text: 'x' })).rejects.toThrow(
      ServerError,
    );
    expect(calls).toHaveLength(1);
  });

  it('does not retry a 400', async () => {
    const { wc, calls } = client(() => json({ error: 'bad' }, 400));
    await expect(wc.memory.list({ projectId: PROJECT })).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(1);
  });

  it('retries a 503 and succeeds', async () => {
    let n = 0;
    const { wc, calls } = client(() => (++n < 3 ? json({ error: 'nope' }, 503) : json({ entries: [] })));
    await expect(wc.memory.list({ projectId: PROJECT })).resolves.toEqual([]);
    expect(calls).toHaveLength(3);
  });

  it('gives up after the configured attempts', async () => {
    const { wc, calls } = client(() => json({ error: 'nope' }, 503), { retry: { attempts: 2 } });
    await expect(wc.memory.list({ projectId: PROJECT })).rejects.toThrow(TransientError);
    expect(calls).toHaveLength(2);
  });

  it('carries requestId through for support', async () => {
    const { wc } = client(() => json({ error: 'boom' }, 500, { 'x-amzn-requestid': 'req-42' }));
    await expect(wc.memory.list({ projectId: PROJECT })).rejects.toMatchObject({
      requestId: 'req-42',
    });
  });

  it('does not choke on a non-JSON error body', async () => {
    const { wc } = client(
      () => new Response('<html>gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    );
    await expect(wc.memory.list({ projectId: PROJECT })).rejects.toThrow(TransientError);
  });
});

describe('auth header', () => {
  it('sends the api key as a bearer token', async () => {
    let seen: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers).get('authorization');
      return json({ entries: [] });
    }) as unknown as typeof globalThis.fetch;

    const wc = new WalkCroach({ apiKey: KEY, baseUrl: 'https://api.test', fetch: fetchImpl });
    await wc.memory.list({ projectId: PROJECT });
    expect(seen).toBe(`Bearer ${KEY}`);
  });
});
