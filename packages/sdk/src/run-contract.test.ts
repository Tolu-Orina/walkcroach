import { describe, expect, it } from 'vitest';
import {
  CONTENT_PUBLISH_CONTRACT_VERSION,
  isCriticProgressEvent,
  isPlanProgressEvent,
  isRunProgressEventType,
  isStageProgressEvent,
  RUN_PROGRESS_EVENT_TYPES,
  WalkCroach,
} from './index.js';
import { ValidationError } from './errors.js';

const KEY = `wc_live_${'a'.repeat(10)}_${'b'.repeat(32)}`;

describe('content.publish/v1 contract (Phase 6)', () => {
  it('exports a stable contract version id', () => {
    expect(CONTENT_PUBLISH_CONTRACT_VERSION).toBe('content.publish/v1');
  });

  it('classifies platform progress event types', () => {
    expect(isStageProgressEvent('stage.started')).toBe(true);
    expect(isStageProgressEvent('tool_card')).toBe(false);
    expect(isCriticProgressEvent('critic.findings')).toBe(true);
    expect(isPlanProgressEvent('plan.auto_approved')).toBe(true);
    expect(isRunProgressEventType('stage.completed')).toBe(true);
    expect(isRunProgressEventType('token_delta')).toBe(false);
    expect(RUN_PROGRESS_EVENT_TYPES).toContain('plan.auto_approved');
    expect(RUN_PROGRESS_EVENT_TYPES).toContain('critic.enforcement');
  });

  it('rejects requirePlanApproval on v1 (A1 — auto-approve only)', async () => {
    const calls: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const wc = new WalkCroach({
      apiKey: KEY,
      baseUrl: 'https://api.test',
      fetch: fetchImpl,
    });

    await expect(
      wc.content.publish({
        source: { kind: 'markdown', content: '# x' },
        target: { repo: 'acme/site' },
        writeScope: { mode: 'additive' },
        requirePlanApproval: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      wc.content.publish({
        source: { kind: 'markdown', content: '# x' },
        target: { repo: 'acme/site' },
        writeScope: { mode: 'additive' },
        planApproval: 'required',
      }),
    ).rejects.toThrow(/auto-approves Plan/i);

    expect(calls).toHaveLength(0);
  });

  it('stamps contractVersion on wait() results when the server omitted it', async () => {
    let polls = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('/content/publish')) {
        return new Response(
          JSON.stringify({
            runId: '11111111-1111-1111-1111-111111111111',
            status: 'queued',
            createdAt: 't',
          }),
          { status: 202, headers: { 'content-type': 'application/json' } },
        );
      }
      polls += 1;
      return new Response(
        JSON.stringify({
          runId: '11111111-1111-1111-1111-111111111111',
          threadId: '11111111-1111-1111-1111-111111111111',
          status: 'succeeded',
          kind: 'content.publish',
          attempts: 1,
          createdAt: 't',
          startedAt: 't',
          finishedAt: 't',
          result: {
            ok: true,
            filesWritten: ['a.tsx'],
            signals: [],
            flags: [],
            refusals: [],
            learned: [],
            reason: 'completed',
            planAutoApproved: true,
          },
          error: null,
          interrupt: null,
          events: [
            {
              seq: 1,
              at: 't',
              type: 'plan.auto_approved',
              payload: {},
            },
          ],
          lastSeq: 1,
          pollAfterMs: 500,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch;

    const wc = new WalkCroach({
      apiKey: KEY,
      baseUrl: 'https://api.test',
      fetch: fetchImpl,
    });
    const seen: string[] = [];
    const run = await wc.content.publish({
      source: { kind: 'markdown', content: '# x' },
      target: { repo: 'acme/site' },
      writeScope: { mode: 'additive' },
    });
    const result = await run.wait({
      onProgress: (e) => seen.push(e.type),
    });

    expect(polls).toBeGreaterThanOrEqual(1);
    expect(result.contractVersion).toBe(CONTENT_PUBLISH_CONTRACT_VERSION);
    expect(result.planAutoApproved).toBe(true);
    expect(seen).toContain('plan.auto_approved');
  });
});
