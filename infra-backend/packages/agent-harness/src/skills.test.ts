import { describe, expect, it, vi } from 'vitest';

vi.mock('./bedrock.js', () => ({
  embedText: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

import { listSharedSkills, writeSharedSkill } from './skills.js';

function fakeDb(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows }));
  return { query } as unknown as import('@walkcroach/db').DbClient;
}

describe('writeSharedSkill', () => {
  it('upserts on (owner_id, name) and returns the id', async () => {
    const db = fakeDb([{ id: 'skill-1' }]);
    const id = await writeSharedSkill({
      db,
      ownerId: 'owner-1',
      name: 'my-skill',
      description: 'desc',
      body: 'body text',
      sourceSurface: 'ide',
    });
    expect(id).toBe('skill-1');
    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (owner_id, name) DO UPDATE');
    expect(sql).toContain('INSERT INTO shared_skills');
    expect(params[0]).toBe('owner-1');
    expect(params[1]).toBe('my-skill');
    expect(params[5]).toBe('[0.1,0.2,0.3]');
  });
});

describe('listSharedSkills', () => {
  it('scopes to owner_id and maps snake_case rows to camelCase', async () => {
    const db = fakeDb([
      {
        id: 'skill-1',
        name: 'my-skill',
        description: 'desc',
        body: 'body text',
        source_surface: 'ide',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
    ]);
    const result = await listSharedSkills({ db, ownerId: 'owner-1' });
    expect(result).toEqual([
      {
        id: 'skill-1',
        name: 'my-skill',
        description: 'desc',
        body: 'body text',
        sourceSurface: 'ide',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      },
    ]);
    const [sql, params] = (db.query as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE owner_id = $1');
    expect(params).toEqual(['owner-1', 100]);
  });
});
