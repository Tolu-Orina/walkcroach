import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ apiBaseUrl: 'http://test-api:3000' }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { ideHealth, ideMe, listMyProjects, createLink, deleteLink } from './api.js';

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
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ide/v1/health'),
    );
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'service down' }, 500),
    );
    await expect(ideHealth()).rejects.toThrow('service down');
  });
});

describe('ideMe', () => {
  it('calls /ide/v1/me with auth header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ownerId: 'u1', link: null, linkCount: 0 }),
    );
    const result = await ideMe('tok-123');
    expect(result.ownerId).toBe('u1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tok-123',
        }),
      }),
    );
  });

  it('passes local_repo_key as query param', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ownerId: 'u1', link: null, linkCount: 0 }),
    );
    await ideMe('tok-123', 'git:foo');
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.searchParams.get('local_repo_key')).toBe('git:foo');
  });
});

describe('listMyProjects', () => {
  it('returns project array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        projects: [
          { id: 'p1', name: 'Proj', status: 'active', updated_at: '2025-01-01' },
        ],
      }),
    );
    const result = await listMyProjects('tok');
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Proj');
  });

  it('returns empty array when no projects key', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const result = await listMyProjects('tok');
    expect(result).toEqual([]);
  });
});

describe('createLink', () => {
  it('posts link data and returns link', async () => {
    const mockLink = {
      id: 'lnk-1',
      projectId: 'p1',
      localRepoKey: 'git:foo',
    };
    fetchMock.mockResolvedValueOnce(jsonResponse({ link: mockLink }));
    const result = await createLink('tok', {
      projectId: 'p1',
      gitRemoteUrl: 'https://github.com/test/repo',
    });
    expect(result.id).toBe('lnk-1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('deleteLink', () => {
  it('sends DELETE request', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await deleteLink('tok', 'lnk-1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('throws on error response', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'not found' }, 404),
    );
    await expect(deleteLink('tok', 'bad-id')).rejects.toThrow('not found');
  });
});
