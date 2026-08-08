/**
 * Phase 3 / A5 — lease recovery + resume preserve Graph checkpoints.
 * Uses a scripted fake DbClient (no CRDB required).
 */
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '@walkcroach/db';
import { reapExpiredRuns, resumeRun } from '../run-store.js';

function fakeDb(script: Array<{ match: RegExp; result: unknown }>): DbClient {
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      for (const step of script) {
        if (step.match.test(sql)) {
          return typeof step.result === 'function'
            ? (step.result as (sql: string) => unknown)(sql)
            : step.result;
        }
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 120)}`);
    }),
  } as unknown as DbClient;
}

describe('reapExpiredRuns (A5)', () => {
  it('re-queues graph-backed runs and fail-wipes legacy runs', async () => {
    const db = fakeDb([
      {
        match: /graph_id IS NOT NULL/,
        result: { rowCount: 2, rows: [] },
      },
      {
        match: /graph_id IS NULL/,
        result: { rowCount: 1, rows: [] },
      },
    ]);

    expect(await reapExpiredRuns(db)).toBe(3);
    expect(await reapExpiredRuns(db, { detailed: true })).toEqual({
      failed: 1,
      recovered: 2,
    });

    const sqls = (db.query as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    );
    expect(sqls.some((s) => /leaseRecovery/.test(s))).toBe(true);
    expect(sqls.some((s) => /status = 'failed'/.test(s))).toBe(true);
    expect(sqls.some((s) => /status = 'queued'/.test(s))).toBe(true);
  });
});

describe('resumeRun (A5 checkpoint preserve)', () => {
  it('does not null result for graph-backed runs; keeps stage columns untouched in SQL', async () => {
    const runRow = {
      id: '11111111-1111-1111-1111-111111111111',
      owner_id: 'owner',
      project_id: '22222222-2222-2222-2222-222222222222',
      kind: 'graph.run',
      status: 'interrupted',
      request: { graphId: 'dummy.cycle' },
      result: {
        interrupt: { id: 'intr-1', kind: 'ask', payload: {}, createdAt: 't' },
        partial: true,
      },
      error: null,
      attempts: 1,
      created_at: new Date(),
      started_at: new Date(),
      finished_at: null,
      graph_id: 'dummy.cycle',
      current_stage: 'critique',
      stage_state: { writes: ['fence'], __visitCounts: { fence: 1 } },
      stage_state_version: 4,
      checkpoint_at: new Date(),
      revise_count: 1,
      node_execution_count: 2,
      tool_fingerprints: [],
    };

    let updateSql = '';
    const db = fakeDb([
      {
        match: /FROM agent_runs WHERE id/,
        result: { rows: [runRow], rowCount: 1 },
      },
      {
        match: /UPDATE agent_runs/,
        result: (sql: string) => {
          updateSql = sql;
          return {
            rows: [
              {
                ...runRow,
                status: 'queued',
                result: { partial: true },
              },
            ],
            rowCount: 1,
          };
        },
      },
    ]);

    const outcome = await resumeRun({
      db,
      runId: runRow.id,
      ownerId: 'owner',
      interruptId: 'intr-1',
      value: 'yes',
    });

    expect(outcome.ok).toBe(true);
    expect(updateSql).toMatch(/graph_id IS NOT NULL/);
    expect(updateSql).not.toMatch(/stage_state\s*=/);
    expect(updateSql).not.toMatch(/current_stage\s*=/);
    expect(updateSql).toMatch(/COALESCE\(result/);
  });
});
