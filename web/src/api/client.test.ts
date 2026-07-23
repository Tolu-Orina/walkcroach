import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeStore: Record<string, string> = {};

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.test');
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((k: string) => fakeStore[k] ?? null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  for (const k of Object.keys(fakeStore)) delete fakeStore[k];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    }),
  );
}

async function loadClient() {
  return import('./client');
}

describe('listProjects', () => {
  it('fetches and returns projects array', async () => {
    mockFetch({ projects: [{ id: 'p1', name: 'Foo' }] });
    const { listProjects } = await loadClient();
    const result = await listProjects();
    expect(result).toEqual([{ id: 'p1', name: 'Foo' }]);
  });
});

describe('createProject', () => {
  it('sends POST and returns id', async () => {
    mockFetch({ id: 'p2', templateId: 'blank' });
    const { createProject } = await loadClient();
    const result = await createProject('Test', 'blank');
    expect(result.id).toBe('p2');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe('POST');
  });
});

describe('getProject', () => {
  it('fetches single project', async () => {
    mockFetch({ id: 'p1', name: 'X', status: 'active' });
    const { getProject } = await loadClient();
    const result = await getProject('p1');
    expect(result.id).toBe('p1');
  });
});

describe('archiveProject', () => {
  it('sends POST to archive endpoint', async () => {
    mockFetch({});
    const { archiveProject } = await loadClient();
    await archiveProject('p1');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/archive');
  });
});

describe('deleteProject', () => {
  it('sends DELETE request', async () => {
    mockFetch({});
    const { deleteProject } = await loadClient();
    await deleteProject('p1');
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('getLatestSession', () => {
  it('fetches latest session', async () => {
    mockFetch({ sessionId: 's1', projectId: 'p1' });
    const { getLatestSession } = await loadClient();
    const result = await getLatestSession('p1');
    expect(result.sessionId).toBe('s1');
  });
});

describe('createSession', () => {
  it('sends POST and returns session', async () => {
    mockFetch({ id: 's2', projectId: 'p1' });
    const { createSession } = await loadClient();
    const result = await createSession('p1');
    expect(result.id).toBe('s2');
  });
});

describe('getSession', () => {
  it('fetches session detail', async () => {
    mockFetch({ id: 's1', projectId: 'p1', status: 'active', pendingTool: null, messages: [] });
    const { getSession } = await loadClient();
    const result = await getSession('s1');
    expect(result.id).toBe('s1');
  });
});

describe('authHeaders via localStorage token', () => {
  it('prefers Cognito idToken over legacy access token field', async () => {
    fakeStore['walkcroach.auth.v1'] = JSON.stringify({
      token: 'access-legacy',
      cognito: { idToken: 'id-preferred' },
    });
    mockFetch({ projects: [] });
    const { listProjects } = await loadClient();
    await listProjects();
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers?.authorization).toBe('Bearer id-preferred');
  });

  it('includes Bearer token when auth is stored', async () => {
    fakeStore['walkcroach.auth.v1'] = JSON.stringify({ token: 'tok42' });
    mockFetch({ projects: [] });
    const { listProjects } = await loadClient();
    await listProjects();
    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers;
    expect(headers?.authorization).toBe('Bearer tok42');
  });

  it('omits authorization when no token', async () => {
    mockFetch({ projects: [] });
    const { listProjects } = await loadClient();
    await listProjects();
    const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.headers;
    expect(headers?.authorization).toBeUndefined();
  });
});

describe('parseJson error path', () => {
  it('throws on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve('Server down'),
      }),
    );
    const { listProjects } = await loadClient();
    await expect(listProjects()).rejects.toThrow('Server down');
  });

  it('throws status text when body is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: () => Promise.resolve(''),
      }),
    );
    const { getProject } = await loadClient();
    await expect(getProject('missing')).rejects.toThrow('404 Not Found');
  });
});

describe('getApiUrl', () => {
  it('returns configured URL', async () => {
    const { getApiUrl } = await loadClient();
    expect(getApiUrl()).toBe('https://api.test');
  });
});

describe('getUsage', () => {
  it('fetches usage summary', async () => {
    mockFetch({ monthlyCredits: 100, used: 30, remaining: 70, costs: {} });
    const { getUsage } = await loadClient();
    const result = await getUsage();
    expect(result.remaining).toBe(70);
  });
});

describe('syncProjectFiles', () => {
  it('sends files via POST', async () => {
    mockFetch({});
    const { syncProjectFiles } = await loadClient();
    await syncProjectFiles('p1', [{ path: 'a.ts', content: 'x' }]);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('/files/sync');
  });
});

describe('getDeployments', () => {
  it('returns deployments array', async () => {
    mockFetch({ deployments: [{ id: 'd1' }] });
    const { getDeployments } = await loadClient();
    const result = await getDeployments('p1');
    expect(result).toEqual([{ id: 'd1' }]);
  });
});

describe('triggerDeploy', () => {
  it('sends POST to deploy endpoint', async () => {
    mockFetch({ deploymentId: 'd1', slug: 's', url: 'http://x', status: 'ok', remainingCredits: 50 });
    const { triggerDeploy } = await loadClient();
    const result = await triggerDeploy('p1', {});
    expect(result.deploymentId).toBe('d1');
  });
});

describe('getSessionActivity', () => {
  it('returns events array', async () => {
    mockFetch({ events: [{ id: 'e1', tool: 'edit', args: {}, summary: null, at: '' }] });
    const { getSessionActivity } = await loadClient();
    const result = await getSessionActivity('s1');
    expect(result).toEqual([{ id: 'e1', tool: 'edit', args: {}, summary: null, at: '' }]);
  });
});

describe('listCheckpoints', () => {
  it('returns checkpoints array', async () => {
    mockFetch({ checkpoints: [{ id: 'cp1', summary: 'snap' }] });
    const { listCheckpoints } = await loadClient();
    const result = await listCheckpoints('p1');
    expect(result).toEqual([{ id: 'cp1', summary: 'snap' }]);
  });
});

describe('createCheckpoint', () => {
  it('sends POST and returns checkpoint', async () => {
    mockFetch({ checkpointId: 'cp2', summary: 'saved' });
    const { createCheckpoint } = await loadClient();
    const result = await createCheckpoint('p1', { name: 'snap' });
    expect(result.checkpointId).toBe('cp2');
  });
});

describe('revertCheckpoint', () => {
  it('sends POST and returns files', async () => {
    mockFetch({ files: [{ path: 'a.ts', content: 'x' }] });
    const { revertCheckpoint } = await loadClient();
    const result = await revertCheckpoint('cp1');
    expect(result.files).toHaveLength(1);
  });
});

describe('exportProject', () => {
  it('returns url and file count', async () => {
    mockFetch({ url: 'https://dl', fileCount: 5 });
    const { exportProject } = await loadClient();
    const result = await exportProject('p1');
    expect(result.url).toBe('https://dl');
    expect(result.fileCount).toBe(5);
  });
});

describe('getProjectResources', () => {
  it('returns resources', async () => {
    mockFetch({ database: null, secrets: [] });
    const { getProjectResources } = await loadClient();
    const result = await getProjectResources('p1');
    expect(result.database).toBeNull();
    expect(result.secrets).toEqual([]);
  });
});

describe('getProjectSecrets', () => {
  it('returns secrets', async () => {
    mockFetch({ secrets: [{ key: 'K', masked: '***' }] });
    const { getProjectSecrets } = await loadClient();
    const result = await getProjectSecrets('p1');
    expect(result.secrets).toHaveLength(1);
  });
});

describe('putProjectSecret', () => {
  it('sends POST', async () => {
    mockFetch({});
    const { putProjectSecret } = await loadClient();
    await putProjectSecret('p1', 'API_KEY', 'val');
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('/secrets');
    expect(call[1].method).toBe('POST');
  });
});

describe('provisionProjectDatabase', () => {
  it('returns provision result', async () => {
    mockFetch({ ok: true, database: 'mydb' });
    const { provisionProjectDatabase } = await loadClient();
    const result = await provisionProjectDatabase('p1');
    expect(result.ok).toBe(true);
  });
});

describe('getInlineEditQuota', () => {
  it('returns quota info', async () => {
    mockFetch({ allowed: true, remaining: 10 });
    const { getInlineEditQuota } = await loadClient();
    const result = await getInlineEditQuota('p1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });
});

describe('recordInlineEdit', () => {
  it('sends POST and returns result', async () => {
    mockFetch({ ok: true, remaining: 9 });
    const { recordInlineEdit } = await loadClient();
    const result = await recordInlineEdit('p1', 'src/App.tsx');
    expect(result.ok).toBe(true);
  });
});

describe('getGithubStatus', () => {
  it('returns github status', async () => {
    mockFetch({ connected: true, repo: 'user/repo' });
    const { getGithubStatus } = await loadClient();
    const result = await getGithubStatus('p1');
    expect(result.connected).toBe(true);
    expect(result.repo).toBe('user/repo');
  });
});

describe('connectGithub', () => {
  it('sends POST to connect endpoint', async () => {
    mockFetch({ authMethod: 'app' });
    const { connectGithub } = await loadClient();
    const result = await connectGithub('p1', 'user/repo');
    expect(result.authMethod).toBe('app');
  });
});

describe('completeGithubInstall', () => {
  it('sends POST with installation info', async () => {
    mockFetch({ projectId: 'p1', repo: 'user/repo' });
    const { completeGithubInstall } = await loadClient();
    const result = await completeGithubInstall(123, 'state-token');
    expect(result.projectId).toBe('p1');
  });
});

describe('pushGithub', () => {
  it('sends POST to push endpoint', async () => {
    mockFetch({});
    const { pushGithub } = await loadClient();
    await pushGithub('p1', { message: 'feat: init' });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain('/github/push');
  });
});
