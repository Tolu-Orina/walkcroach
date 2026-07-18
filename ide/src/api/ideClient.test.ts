import { describe, expect, it, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import {
  ideHealth,
  ideMe,
  listMyProjects,
  createLink,
  deleteLink,
  listMemoryEntries,
  updateMemoryEntry,
  createProjectMemoryBridge,
} from './ideClient.js';

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('ideHealth', () => {
  it('fetches /ide/v1/health', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await ideHealth();
    expect(result.ok).toBe(true);
  });
});

describe('ideMe', () => {
  it('fetches with auth header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ownerId: 'u1', link: null, linkCount: 0 }),
    );
    const result = await ideMe('tok-1');
    expect(result.ownerId).toBe('u1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tok-1',
        }),
      }),
    );
  });

  it('throws on error response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'unauthorized' }, 401),
    );
    await expect(ideMe('bad')).rejects.toThrow('unauthorized');
  });
});

describe('listMyProjects', () => {
  it('returns project array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        projects: [{ id: 'p1', name: 'Proj', status: 'active', updated_at: '2025-01' }],
      }),
    );
    const result = await listMyProjects('tok');
    expect(result).toHaveLength(1);
  });
});

describe('createLink', () => {
  it('posts and returns link', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ link: { id: 'l1', projectId: 'p1', localRepoKey: 'k' } }),
    );
    const result = await createLink('tok', { projectId: 'p1' });
    expect(result.id).toBe('l1');
  });
});

describe('deleteLink', () => {
  it('sends DELETE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await deleteLink('tok', 'l1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('listMemoryEntries', () => {
  it('returns entries', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        entries: [
          { id: 'e1', kind: 'decision', text: 'Use UUIDs', sourceSurface: 'web', createdAt: '2025-01' },
        ],
      }),
    );
    const result = await listMemoryEntries('tok', 'p1');
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('decision');
  });
});

describe('updateMemoryEntry', () => {
  it('sends PATCH', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await updateMemoryEntry('tok', 'e1', 'p1', 'new text');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});

describe('createProjectMemoryBridge', () => {
  it('creates a bridge that can recall and mirror', async () => {
    const bridge = createProjectMemoryBridge({
      getToken: async () => 'tok-1',
      projectId: 'p1',
      projectName: 'Test',
    });

    expect(bridge.projectId).toBe('p1');
    expect(bridge.projectName).toBe('Test');

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        hits: [{ id: 'h1', kind: 'decision', text: 'Use CRDB' }],
      }),
    );
    const hits = await bridge.recall({ query: 'database' });
    expect(hits).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'new-1' }));
    const mirrored = await bridge.mirror({ text: 'Prefer UUID PKs' });
    expect(mirrored.id).toBe('new-1');
  });

  it('throws when not signed in', async () => {
    const bridge = createProjectMemoryBridge({
      getToken: async () => undefined,
      projectId: 'p1',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(bridge.recall({ query: 'test' })).rejects.toThrow(
      /Not signed in/,
    );
  });
});
