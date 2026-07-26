import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeSharedSkill = vi.fn();
const listSharedSkills = vi.fn();
const dbClose = vi.fn(async () => {});

vi.mock('@walkcroach/agent-harness', () => ({
  writeSharedSkill: (...args: unknown[]) => writeSharedSkill(...args),
  listSharedSkills: (...args: unknown[]) => listSharedSkills(...args),
}));
vi.mock('@walkcroach/db', () => ({
  createDbClient: () => ({ close: dbClose }),
}));

import type { AuthContext } from '../auth.js';
import { handleSkillsList, handleSkillsMirror } from './skills.js';

const auth: AuthContext = {
  ownerId: 'owner-1',
  isAnonymous: false,
  source: 'jwt',
};

beforeEach(() => {
  writeSharedSkill.mockReset();
  listSharedSkills.mockReset();
  dbClose.mockClear();
});

describe('handleSkillsMirror', () => {
  it('rejects a missing name', async () => {
    const res = await handleSkillsMirror(
      auth,
      JSON.stringify({ description: 'd', body: 'b' }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-kebab-case name', async () => {
    const res = await handleSkillsMirror(
      auth,
      JSON.stringify({ name: 'Not Kebab!', description: 'd', body: 'b' }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('writes the skill scoped to auth.ownerId and defaults sourceSurface to ide', async () => {
    writeSharedSkill.mockResolvedValue('skill-1');
    const res = await handleSkillsMirror(
      auth,
      JSON.stringify({ name: 'my-skill', description: 'desc', body: 'body' }),
    );
    expect(res.statusCode).toBe(200);
    expect(writeSharedSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-1',
        name: 'my-skill',
        sourceSurface: 'ide',
      }),
    );
    expect(dbClose).toHaveBeenCalled();
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      id: 'skill-1',
      name: 'my-skill',
    });
  });
});

describe('handleSkillsList', () => {
  it('lists skills scoped to auth.ownerId', async () => {
    listSharedSkills.mockResolvedValue([{ name: 'my-skill' }]);
    const res = await handleSkillsList(auth);
    expect(res.statusCode).toBe(200);
    expect(listSharedSkills).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'owner-1' }),
    );
    expect(JSON.parse(res.body)).toEqual({ skills: [{ name: 'my-skill' }] });
  });
});
