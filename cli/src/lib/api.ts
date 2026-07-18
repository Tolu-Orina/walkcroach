/**
 * Thin IDE BFF client for CLI (same routes as the extension).
 */
import type { ProjectMemoryBridge } from '@walkcroach/agent-engine';
import { loadConfig } from './config.js';

export type IdeProject = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

export type IdeLink = {
  id: string;
  projectId: string;
  projectName?: string | null;
  localRepoKey: string;
  localRepoDisplay?: string | null;
};

async function baseUrl(): Promise<string> {
  const cfg = await loadConfig();
  return (process.env.WALKCROACH_API_BASE_URL ?? cfg.apiBaseUrl).replace(
    /\/$/,
    '',
  );
}

async function ideFetch(
  path: string,
  opts: {
    method?: string;
    token: string;
    body?: unknown;
    query?: Record<string, string | undefined>;
  },
): Promise<Response> {
  const base = await baseUrl();
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  return fetch(url, {
    method: opts.method ?? 'GET',
    headers: {
      authorization: `Bearer ${opts.token}`,
      accept: 'application/json',
      ...(opts.body !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`IDE API non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : `IDE API ${res.status}`;
    throw new Error(err);
  }
  return data as T;
}

export async function ideHealth(): Promise<{ ok: boolean; surface?: string }> {
  const base = await baseUrl();
  const res = await fetch(`${base}/ide/v1/health`);
  return readJson(res);
}

export async function ideMe(
  token: string,
  localRepoKey?: string,
): Promise<{ ownerId: string; link: IdeLink | null; linkCount: number }> {
  const res = await ideFetch('/ide/v1/me', {
    token,
    query: localRepoKey ? { local_repo_key: localRepoKey } : undefined,
  });
  return readJson(res);
}

export async function listMyProjects(token: string): Promise<IdeProject[]> {
  const res = await ideFetch('/ide/v1/me/projects', { token });
  const data = await readJson<{ projects: IdeProject[] }>(res);
  return data.projects ?? [];
}

export async function createLink(
  token: string,
  body: {
    projectId: string;
    gitRemoteUrl?: string;
    workspacePath?: string;
    localRepoDisplay?: string;
  },
): Promise<IdeLink> {
  const res = await ideFetch('/ide/v1/links', {
    method: 'POST',
    token,
    body,
  });
  const data = await readJson<{ link: IdeLink }>(res);
  return data.link;
}

export async function deleteLink(token: string, linkId: string): Promise<void> {
  const res = await ideFetch(`/ide/v1/links/${linkId}`, {
    method: 'DELETE',
    token,
  });
  await readJson(res);
}

export function createProjectMemoryBridge(params: {
  getToken: () => Promise<string | undefined>;
  projectId: string;
  projectName?: string;
}): ProjectMemoryBridge {
  const { getToken, projectId, projectName } = params;

  async function requireToken(): Promise<string> {
    const token = await getToken();
    if (!token) {
      throw new Error('Not signed in — project memory requires a Cognito token.');
    }
    return token;
  }

  return {
    projectId,
    projectName,
    async recall({ query, limit, sourceSurfaces }) {
      const token = await requireToken();
      const res = await ideFetch('/ide/v1/memory/recall', {
        method: 'POST',
        token,
        body: { projectId, query, limit, sourceSurfaces },
      });
      const data = await readJson<{
        hits: Array<{
          id: string;
          kind: string;
          text: string;
          distance?: number;
          sourceSurface?: string;
        }>;
      }>(res);
      return data.hits ?? [];
    },
    async mirror({ text, kind }) {
      const token = await requireToken();
      const res = await ideFetch('/ide/v1/memory/mirror', {
        method: 'POST',
        token,
        body: { projectId, text, kind: kind ?? 'decision' },
      });
      const data = await readJson<{ id: string }>(res);
      return { id: data.id };
    },
  };
}
