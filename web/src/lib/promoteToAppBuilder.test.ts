import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  createProject: vi.fn(),
  patchProject: vi.fn(),
}));

import { createProject, patchProject } from '../api/client';
import { promoteProjectToAppBuilder } from './promoteToAppBuilder';
import type { ProjectDetail } from '../api/types';

const base: ProjectDetail = {
  id: 'k1',
  name: 'Acme research',
  kind: 'knowledge',
  status: 'active',
  ownerId: 'u1',
  templateId: null,
  description: 'About Acme',
  instructions: 'Be concise',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  memorySummary: null,
};

describe('promoteProjectToAppBuilder', () => {
  beforeEach(() => {
    vi.mocked(createProject).mockReset();
    vi.mocked(patchProject).mockReset();
  });

  it('creates a new kind=app row and copies description/instructions', async () => {
    vi.mocked(createProject).mockResolvedValueOnce({
      id: 'a1',
      kind: 'app',
      templateId: 'blank',
    });
    vi.mocked(patchProject).mockResolvedValueOnce({
      ...base,
      id: 'a1',
      kind: 'app',
      templateId: 'blank',
    });

    const id = await promoteProjectToAppBuilder(base);

    expect(id).toBe('a1');
    expect(createProject).toHaveBeenCalledWith('Acme research', 'blank', {
      kind: 'app',
    });
    expect(patchProject).toHaveBeenCalledWith('a1', {
      description: 'About Acme',
      instructions: 'Be concise',
    });
  });

  it('skips patch when there is nothing to copy', async () => {
    vi.mocked(createProject).mockResolvedValueOnce({ id: 'a2', kind: 'app' });
    const id = await promoteProjectToAppBuilder({
      ...base,
      description: null,
      instructions: '   ',
    });
    expect(id).toBe('a2');
    expect(patchProject).not.toHaveBeenCalled();
  });
});
