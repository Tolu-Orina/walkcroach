import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DbClient } from '@walkcroach/db';

const embedText = vi.fn(async (_text: string) => new Array(1024).fill(0.1));
vi.mock('./bedrock.js', () => ({ embedText: (t: string) => embedText(t) }));

const {
  formatVector,
  supersedeThreshold,
  writeMemoryEntryDetailed,
  recallProjectMemory,
  RECALL_OVERFETCH,
  DEFAULT_SUPERSEDE_DISTANCE,
} = await import('./memory.js');

type Call = { sql: string; params: unknown[] };

/**
 * Fake DbClient that records SQL and replies from a per-pattern script.
 * `withTransaction` routes through the same recorder, so a test can assert the
 * ordering of statements inside the transaction.
 */
function fakeDb(script: Array<[RegExp, { rows: unknown[] }]> = []) {
  const calls: Call[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    for (const [pattern, result] of script) {
      if (pattern.test(sql)) return result;
    }
    return { rows: [] };
  };
  const db = {
    query,
    withTransaction: async (fn: (tx: { query: typeof query }) => unknown) =>
      fn({ query }),
    close: async () => {},
  } as unknown as DbClient;
  return { db, calls };
}

beforeEach(() => {
  embedText.mockClear();
  delete process.env.MEMORY_SUPERSEDE_THRESHOLD;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('formatVector', () => {
  it('formats pgvector literal', () => {
    expect(formatVector([1, 2, 3])).toBe('[1,2,3]');
  });

  it('handles empty vector', () => {
    expect(formatVector([])).toBe('[]');
  });
});

describe('supersedeThreshold', () => {
  it('defaults to the conservative near-duplicate distance', () => {
    expect(supersedeThreshold({})).toBe(DEFAULT_SUPERSEDE_DISTANCE);
  });

  it('honours an explicit override', () => {
    expect(supersedeThreshold({ MEMORY_SUPERSEDE_THRESHOLD: '0.3' })).toBe(0.3);
  });

  it('treats 0 as "never supersede"', () => {
    expect(supersedeThreshold({ MEMORY_SUPERSEDE_THRESHOLD: '0' })).toBe(0);
  });

  it('falls back to the default on junk rather than disabling silently', () => {
    expect(supersedeThreshold({ MEMORY_SUPERSEDE_THRESHOLD: 'abc' })).toBe(
      DEFAULT_SUPERSEDE_DISTANCE,
    );
    expect(supersedeThreshold({ MEMORY_SUPERSEDE_THRESHOLD: '-1' })).toBe(
      DEFAULT_SUPERSEDE_DISTANCE,
    );
  });
});

describe('writeMemoryEntryDetailed — supersede lifecycle', () => {
  const base = {
    projectId: '11111111-1111-1111-1111-111111111111',
    sourceSurface: 'ide',
    kind: 'preference' as const,
    text: 'Use dark mode by default',
  };

  it('retires the nearest entry when the new one restates it', async () => {
    const { db, calls } = fakeDb([
      [/SELECT id, embedding <=>/, { rows: [{ id: 'old-1', distance: '0.04' }] }],
      [/INSERT INTO memory_entries/, { rows: [{ id: 'new-1' }] }],
    ]);

    const result = await writeMemoryEntryDetailed({ db, ...base });

    expect(result).toEqual({ id: 'new-1', supersededId: 'old-1' });
    const update = calls.find((c) => /UPDATE memory_entries/.test(c.sql));
    expect(update?.params).toEqual(['old-1', 'new-1']);
    // Only the superseded row is touched, and only while still live.
    expect(update?.sql).toMatch(/superseded_by IS NULL/);
  });

  it('leaves a merely-related entry alone when it is beyond the threshold', async () => {
    const { db, calls } = fakeDb([
      [/SELECT id, embedding <=>/, { rows: [{ id: 'old-1', distance: '0.42' }] }],
      [/INSERT INTO memory_entries/, { rows: [{ id: 'new-1' }] }],
    ]);

    const result = await writeMemoryEntryDetailed({ db, ...base });

    expect(result).toEqual({ id: 'new-1', supersededId: null });
    expect(calls.some((c) => /UPDATE memory_entries/.test(c.sql))).toBe(false);
  });

  it('reads the neighbour BEFORE inserting, so the new row cannot supersede itself', async () => {
    const { db, calls } = fakeDb([
      [/SELECT id, embedding <=>/, { rows: [] }],
      [/INSERT INTO memory_entries/, { rows: [{ id: 'new-1' }] }],
    ]);

    await writeMemoryEntryDetailed({ db, ...base });

    const selectAt = calls.findIndex((c) => /SELECT id, embedding <=>/.test(c.sql));
    const insertAt = calls.findIndex((c) => /INSERT INTO memory_entries/.test(c.sql));
    expect(selectAt).toBeGreaterThanOrEqual(0);
    expect(selectAt).toBeLessThan(insertAt);
  });

  it('scopes the neighbour search to the same project and kind', async () => {
    const { db, calls } = fakeDb([
      [/SELECT id, embedding <=>/, { rows: [] }],
      [/INSERT INTO memory_entries/, { rows: [{ id: 'new-1' }] }],
    ]);

    await writeMemoryEntryDetailed({ db, ...base });

    const select = calls.find((c) => /SELECT id, embedding <=>/.test(c.sql));
    expect(select?.sql).toMatch(/project_id = \$1::uuid/);
    expect(select?.sql).toMatch(/kind = \$2/);
    expect(select?.sql).toMatch(/superseded_by IS NULL/);
    expect(select?.params?.[0]).toBe(base.projectId);
    expect(select?.params?.[1]).toBe('preference');
  });

  it('skips the neighbour lookup entirely when superseding is disabled', async () => {
    process.env.MEMORY_SUPERSEDE_THRESHOLD = '0';
    const { db, calls } = fakeDb([
      [/INSERT INTO memory_entries/, { rows: [{ id: 'new-1' }] }],
    ]);

    const result = await writeMemoryEntryDetailed({ db, ...base });

    expect(result.supersededId).toBeNull();
    expect(calls.some((c) => /SELECT id, embedding <=>/.test(c.sql))).toBe(false);
  });

  it('embeds once, outside the transaction, so a replay does not re-bill Bedrock', async () => {
    const { db } = fakeDb([
      [/SELECT id, embedding <=>/, { rows: [] }],
      [/INSERT INTO memory_entries/, { rows: [{ id: 'new-1' }] }],
    ]);

    await writeMemoryEntryDetailed({ db, ...base });

    expect(embedText).toHaveBeenCalledTimes(1);
  });
});

describe('recallProjectMemory', () => {
  const projectId = '22222222-2222-2222-2222-222222222222';

  function hits(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      kind: 'decision',
      text: `t${i}`,
      distance: i / 100,
      source_surface: 'web',
    }));
  }

  it('over-fetches past the caller limit to survive post-filtering', async () => {
    const { db, calls } = fakeDb([[/FROM memory_entries/, { rows: hits(20) }]]);

    await recallProjectMemory({ db, projectId, query: 'q', limit: 5 });

    const select = calls.find((c) => /FROM memory_entries/.test(c.sql));
    expect(select?.params?.[2]).toBe(5 * RECALL_OVERFETCH);
  });

  it('still returns only the requested number of hits', async () => {
    const { db } = fakeDb([[/FROM memory_entries/, { rows: hits(20) }]]);

    const out = await recallProjectMemory({ db, projectId, query: 'q', limit: 5 });

    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ id: 'm0', sourceSurface: 'web' });
  });

  it('excludes superseded entries so retired memory cannot resurface', async () => {
    const { db, calls } = fakeDb([[/FROM memory_entries/, { rows: [] }]]);

    await recallProjectMemory({ db, projectId, query: 'q' });

    expect(calls[0]?.sql).toMatch(/superseded_by IS NULL/);
  });

  it('applies the surface filter in SQL when one is supplied', async () => {
    const { db, calls } = fakeDb([[/FROM memory_entries/, { rows: [] }]]);

    await recallProjectMemory({
      db,
      projectId,
      query: 'q',
      sourceSurfaces: ['chrome', 'ide'],
    });

    expect(calls[0]?.sql).toMatch(/source_surface = ANY/);
    expect(calls[0]?.params?.[3]).toEqual(['chrome', 'ide']);
  });

  it('constrains project_id, which is what lets the prefixed vector index engage', async () => {
    const { db, calls } = fakeDb([[/FROM memory_entries/, { rows: [] }]]);

    await recallProjectMemory({ db, projectId, query: 'q' });

    expect(calls[0]?.sql).toMatch(/project_id = \$1::uuid/);
    expect(calls[0]?.params?.[0]).toBe(projectId);
  });
});
