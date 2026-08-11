import { describe, expect, it, vi } from 'vitest';
import { getLatestSessionForProject } from './session-store.js';
import type { DbClient } from '@walkcroach/db';

function mockDb(rows: Array<{ id: string }>): DbClient {
  return {
    query: vi.fn(async (_sql: string, _params?: unknown[]) => ({
      rows,
      rowCount: rows.length,
    })),
    close: vi.fn(async () => undefined),
  } as unknown as DbClient;
}

describe('getLatestSessionForProject', () => {
  it('pins mode in SQL (builder)', async () => {
    const db = mockDb([{ id: 's-builder' }]);
    const result = await getLatestSessionForProject(db, 'p1', 'builder');
    expect(result).toEqual({ id: 's-builder' });
    const [sql, params] = vi.mocked(db.query).mock.calls[0]!;
    expect(String(sql)).toMatch(/COALESCE\(mode, 'builder'\) = \$2/);
    expect(params).toEqual(['p1', 'builder']);
  });

  it('pins mode in SQL (chat)', async () => {
    const db = mockDb([{ id: 's-chat' }]);
    const result = await getLatestSessionForProject(db, 'p1', 'chat');
    expect(result).toEqual({ id: 's-chat' });
    const [, params] = vi.mocked(db.query).mock.calls[0]!;
    expect(params).toEqual(['p1', 'chat']);
  });

  it('returns null when no matching session', async () => {
    const db = mockDb([]);
    const result = await getLatestSessionForProject(db, 'p1', 'builder');
    expect(result).toBeNull();
  });
});
