/**
 * Thin IDE BFF client for CLI (same auth/link routes as the extension).
 * Project memory uses `@walkcroach/sdk` → `/v1/memory/*` (Phase P2).
 */
import type {
  ProjectMemoryBridge,
  SharedSkillsBridge,
} from '@walkcroach/agent-engine';
import { createHostMemoryBridge } from '@walkcroach/sdk';
import { resolveApiBaseUrl } from './config.js';
import { ApiError, NetworkError } from './exit-codes.js';

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

/**
 * Single entry point for "which API are we talking to" (C0.2/C0.3).
 *
 * This used to read env-then-config inline, which meant `--api-url` could not
 * reach it and nothing could report where the value came from. Precedence now
 * lives in one place: flag > env > project > user > default.
 */
async function baseUrl(): Promise<string> {
  return (await resolveApiBaseUrl()).value;
}

/**
 * `fetch` rejects with a bare `TypeError: fetch failed` and the real reason
 * buried in `cause` — useless in a terminal. Rewriting it for humans is
 * clig.dev's rule, and it is what makes exit code 4 mean something.
 */
async function request(url: URL | string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (err as Error).message;
    throw new NetworkError(`Cannot reach the WalkCroach API at ${url} (${detail})`);
  }
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
  return request(url, {
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
    throw new ApiError(
      `IDE API non-JSON (${res.status}): ${text.slice(0, 200)}`,
      res.status,
    );
  }
  if (!res.ok) {
    const err =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: string }).error)
        : `IDE API ${res.status}`;
    // Carrying the status lets exitCodeForError distinguish "sign in again"
    // (401/403 → 2) from "the service is down" (5xx → 4).
    throw new ApiError(err, res.status);
  }
  return data as T;
}

export async function ideHealth(): Promise<{ ok: boolean; surface?: string }> {
  const base = await baseUrl();
  const res = await request(`${base}/ide/v1/health`);
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

/** POST /ide/v1/projects — register a project scaffolded locally (C3.6). */
export async function createProject(
  token: string,
  body: {
    name: string;
    surfaceOrigin?: 'cli' | 'ide';
    stackConfig?: Record<string, unknown>;
  },
): Promise<IdeProject> {
  const res = await ideFetch('/ide/v1/projects', { method: 'POST', token, body });
  const data = await readJson<{ project: IdeProject }>(res);
  return data.project;
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
  return createHostMemoryBridge({
    getAccessToken: getToken,
    projectId,
    projectName,
    // Phase P2: was incorrectly tagged `desktop` — CLI is its own surface.
    surface: 'cli',
    getBaseUrl: () => baseUrl(),
  }) as ProjectMemoryBridge;
}

export type SharedSkillEntry = {
  name: string;
  description: string;
  body: string;
  sourceSurface: string;
  createdAt: string;
  updatedAt: string;
};

export async function listSharedSkills(
  token: string,
): Promise<SharedSkillEntry[]> {
  const res = await ideFetch('/ide/v1/skills', { token });
  const data = await readJson<{ skills: SharedSkillEntry[] }>(res);
  return data.skills ?? [];
}

/**
 * Account-scoped shared skills (same BFF as the extension).
 * CLI labels skill mirrors as `cli` by default.
 */
export function createSharedSkillsBridge(params: {
  getToken: () => Promise<string | undefined>;
  sourceSurface?: string;
}): SharedSkillsBridge {
  const { getToken, sourceSurface = 'cli' } = params;

  async function requireToken(): Promise<string> {
    const token = await getToken();
    if (!token) {
      throw new Error('Not signed in — shared skills require a Cognito token.');
    }
    return token;
  }

  return {
    async list() {
      const token = await requireToken();
      return listSharedSkills(token);
    },
    async mirror({ name, description, body, sourceSurface: surface }) {
      const token = await requireToken();
      const res = await ideFetch('/ide/v1/skills/mirror', {
        method: 'POST',
        token,
        body: {
          name,
          description,
          body,
          sourceSurface: surface ?? sourceSurface,
        },
      });
      const data = await readJson<{ id: string }>(res);
      return { id: data.id };
    },
  };
}
