import { describe, expect, it } from 'vitest';
import { RunFailedError, WalkCroach } from './index.js';
import { ValidationError } from './errors.js';

const KEY = `wc_live_${'a'.repeat(10)}_${'b'.repeat(32)}`;
const PROJECT = '11111111-2222-3333-4444-555555555555';

function client(response: unknown = { ok: true, filesWritten: [] }) {
  const calls: Array<{ url: string; body: Record<string, never> }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  return {
    wc: new WalkCroach({ apiKey: KEY, baseUrl: 'https://api.test', fetch: fetchImpl }),
    calls,
  };
}

const valid = {
  projectId: PROJECT,
  source: { kind: 'docx' as const, content: 'base64...', filename: 'launch.docx' },
  target: { repo: 'anycompany/website' },
  writeScope: { mode: 'additive' as const },
};

describe('content.publish validation', () => {
  it('requires writeScope, with no default', async () => {
    // Choosing this is the caller's decision. A safe default would be silent;
    // a permissive one dangerous.
    const { wc, calls } = client();
    await expect(
      wc.content.publish({ ...valid, writeScope: undefined as never }),
    ).rejects.toThrow(/writeScope is required/);
    expect(calls).toHaveLength(0);
  });

  it('names additive in the error, so the safe choice is obvious', async () => {
    const { wc } = client();
    await expect(
      wc.content.publish({ ...valid, writeScope: undefined as never }),
    ).rejects.toThrow(/additive/);
  });

  it('rejects an empty allow list in scoped mode', async () => {
    const { wc, calls } = client();
    await expect(
      wc.content.publish({ ...valid, writeScope: { mode: 'scoped', allow: [] } }),
    ).rejects.toThrow(/at least one path/);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['not-a-uuid', 'projectId'],
    ['', 'projectId'],
  ])('rejects projectId %s before calling the API', async (projectId) => {
    const { wc, calls } = client();
    await expect(wc.content.publish({ ...valid, projectId })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(calls).toHaveLength(0);
  });

  it.each(['website', 'https://github.com/acme/site', 'acme/site/extra'])(
    'rejects malformed repo %s',
    async (repo) => {
      const { wc, calls } = client();
      await expect(
        wc.content.publish({ ...valid, target: { repo } }),
      ).rejects.toThrow(/owner\/name/);
      expect(calls).toHaveLength(0);
    },
  );

  it('requires source content', async () => {
    const { wc } = client();
    await expect(
      wc.content.publish({ ...valid, source: { kind: 'markdown', content: '' } }),
    ).rejects.toThrow(/source\.content is required/);
  });
});

describe('content.publish submission', () => {
  const accepted = { runId: 'run-1', status: 'queued', createdAt: '2026-08-05T00:00:00Z' };

  it('posts a well-formed body and returns a handle, not a result', async () => {
    // A publish takes minutes; no HTTP request survives that.
    const { wc, calls } = client(accepted);
    const run = await wc.content.publish({ ...valid, instructions: 'technical audience' });

    expect(calls[0]!.url).toBe('https://api.test/v1/content/publish');
    expect(calls[0]!.body).toMatchObject({
      projectId: PROJECT,
      target: { repo: 'anycompany/website' },
      writeScope: { mode: 'additive' },
      instructions: 'technical audience',
    });
    expect(run.runId).toBe('run-1');
    expect(run.status).toBe('queued');
  });

  it('passes dryRun and idempotencyKey through', async () => {
    const { wc, calls } = client(accepted);
    await wc.content.publish({ ...valid, dryRun: true, idempotencyKey: 'post-42' });
    expect(calls[0]!.body).toMatchObject({ dryRun: true, idempotencyKey: 'post-42' });
  });

  it('can re-attach to a run submitted elsewhere', async () => {
    // The point of an async model: the handle holds only an id, so a run can be
    // resumed from another process or another day.
    const { wc } = client(accepted);
    expect(wc.content.run('run-9').runId).toBe('run-9');
  });
});

describe('RunHandle.wait', () => {
  const result = {
    ok: true,
    pullRequest: { number: 42, url: 'https://github.com/x/y/pull/42', branch: 'b', commitSha: 'c' },
    filesWritten: ['src/content/blog/launch.tsx'],
    signals: [{ pattern: 'instruction-override', excerpt: 'ignore all previous' }],
    flags: [{ rule: 'inline-script', path: 'a.tsx', excerpt: '<script>' }],
    refusals: [{ rule: 'write-scope', reason: 'r', subject: 'src/components/Button.tsx' }],
    learned: ['content.dir'],
    reason: 'completed',
  };

  /** Replays a sequence of poll responses. */
  function polling(snapshots: Array<Record<string, unknown>>) {
    const calls: string[] = [];
    let i = 0;
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      const body =
        String(url).includes('/content/publish')
          ? { runId: 'run-1', status: 'queued', createdAt: 'x' }
          : (snapshots[Math.min(i++, snapshots.length - 1)] ?? {});
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    return {
      wc: new WalkCroach({ apiKey: KEY, baseUrl: 'https://api.test', fetch: fetchImpl }),
      calls,
    };
  }

  const snap = (over: Record<string, unknown>) => ({
    runId: 'run-1',
    kind: 'content.publish',
    attempts: 1,
    events: [],
    lastSeq: 0,
    pollAfterMs: 0,
    result: null,
    error: null,
    ...over,
  });

  it('polls until terminal and returns the result', async () => {
    const { wc } = polling([
      snap({ status: 'queued' }),
      snap({ status: 'running' }),
      snap({ status: 'succeeded', result }),
    ]);
    const run = await wc.content.publish(valid);
    const res = await run.wait();

    expect(res.pullRequest?.number).toBe(42);
    expect(res.refusals[0]!.subject).toBe('src/components/Button.tsx');
    expect(res.learned).toContain('content.dir');
  });

  it('streams progress events and never repeats one', async () => {
    const { wc, calls } = polling([
      snap({ status: 'running', events: [{ seq: 1, at: 'x', type: 'started', payload: {} }] }),
      snap({ status: 'running', events: [{ seq: 2, at: 'x', type: 'phase', payload: {} }] }),
      snap({ status: 'succeeded', result, events: [] }),
    ]);
    const seen: string[] = [];
    const run = await wc.content.publish(valid);
    await run.wait({ onProgress: (e) => seen.push(`${e.seq}:${e.type}`) });

    expect(seen).toEqual(['1:started', '2:phase']);
    // Resumes from the last seq rather than refetching the whole log.
    expect(calls.some((u) => u.includes('afterSeq=1'))).toBe(true);
  });

  it('surfaces injection signals through the finished result', async () => {
    // An unattended pipeline needs to route a flagged document to a human.
    const { wc } = polling([snap({ status: 'succeeded', result })]);
    const res = await (await wc.content.publish(valid)).wait();
    expect(res.signals[0]!.pattern).toBe('instruction-override');
    expect(res.flags[0]!.rule).toBe('inline-script');
  });

  it('throws RunFailedError carrying the reason', async () => {
    const { wc } = polling([snap({ status: 'failed', error: 'the worker stopped responding' })]);
    const run = await wc.content.publish(valid);
    await expect(run.wait()).rejects.toMatchObject({
      name: 'RunFailedError',
      runStatus: 'failed',
      message: expect.stringMatching(/stopped responding/),
    });
  });

  it('treats cancellation as a failed wait, not a success', async () => {
    const { wc } = polling([snap({ status: 'cancelled' })]);
    await expect((await wc.content.publish(valid)).wait()).rejects.toBeInstanceOf(RunFailedError);
  });

  it('times out the wait without killing the run, and says so', async () => {
    const { wc } = polling([snap({ status: 'running' })]);
    const run = await wc.content.publish(valid);
    await expect(run.wait({ timeoutMs: 1 })).rejects.toThrow(/still running/);
    await expect(run.wait({ timeoutMs: 1 })).rejects.toThrow(/Poll again/);
  });

  it('honours an abort signal', async () => {
    const { wc } = polling([snap({ status: 'running' })]);
    const run = await wc.content.publish(valid);
    const ac = new AbortController();
    ac.abort();
    await expect(run.wait({ signal: ac.signal })).rejects.toThrow(/aborted/);
  });
});
