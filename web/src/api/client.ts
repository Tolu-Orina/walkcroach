import type {
  ActivityEvent,
  AgentEvent,
  AgentMode,
  CheckpointSummary,
  PlanDecision,
  ProjectDetail,
  ProjectSummary,
} from './types';

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  try {
    const raw = localStorage.getItem('walkcroach.auth.v1');
    if (raw) {
      const parsed = JSON.parse(raw) as { token?: string };
      if (parsed.token) {
        headers.authorization = `Bearer ${parsed.token}`;
      }
    }
  } catch {
    // ignore
  }
  return headers;
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(`${API_URL}/projects`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ projects: ProjectSummary[] }>(res);
  return data.projects;
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  const res = await fetch(`${API_URL}/projects/${projectId}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createProject(
  name: string,
  templateId?: string,
): Promise<{ id: string; templateId?: string }> {
  const res = await fetch(`${API_URL}/projects`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, templateId }),
  });
  return parseJson(res);
}

export async function archiveProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${projectId}/archive`, {
    method: 'POST',
    headers: authHeaders(),
  });
  await parseJson(res);
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${projectId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await parseJson(res);
}

export async function getLatestSession(
  projectId: string,
): Promise<{ sessionId: string; projectId: string }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sessions/latest`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createSession(
  projectId: string,
): Promise<{ id: string; projectId: string }> {
  const res = await fetch(`${API_URL}/sessions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ projectId }),
  });
  return parseJson(res);
}

export type SessionDetail = {
  id: string;
  projectId: string;
  status: string;
  pendingTool: {
    toolCallId: string;
    tool: string;
    args: Record<string, unknown>;
    files?: Array<{ path: string; reason: string }>;
  } | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
  }>;
};

export async function getSession(sessionId: string): Promise<SessionDetail> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function getSessionActivity(sessionId: string): Promise<ActivityEvent[]> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/activity`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ events: ActivityEvent[] }>(res);
  return data.events;
}

export async function* streamPlanDecision(
  sessionId: string,
  body: {
    projectId: string;
    planId: string;
    decision: PlanDecision;
    adjustment?: string;
  },
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/plan-decision`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
  });
  yield* readNdjson(res);
}

export async function syncProjectFiles(
  projectId: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${projectId}/files/sync`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ files }),
  });
  await parseJson(res);
}

export async function listCheckpoints(
  projectId: string,
): Promise<CheckpointSummary[]> {
  const res = await fetch(`${API_URL}/projects/${projectId}/checkpoints`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ checkpoints: CheckpointSummary[] }>(res);
  return data.checkpoints;
}

export async function createCheckpoint(
  projectId: string,
  body: {
    name?: string;
    summary?: string;
    sessionId?: string;
    auto?: boolean;
    files?: Array<{ path: string; content: string }>;
  },
): Promise<{ checkpointId: string; summary: string }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/checkpoints`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function revertCheckpoint(
  checkpointId: string,
): Promise<{ files: Array<{ path: string; content: string }> }> {
  const res = await fetch(`${API_URL}/checkpoints/${checkpointId}/revert`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  return parseJson(res);
}

export async function exportProject(
  projectId: string,
): Promise<{ url: string; fileCount: number }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/export`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type ToolResultBody = {
  projectId: string;
  toolCallId: string;
  ok: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  output?: string;
};

async function* readNdjson(res: Response): AsyncGenerator<AgentEvent> {
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      yield JSON.parse(trimmed) as AgentEvent;
    }
  }

  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as AgentEvent;
}

export async function* streamPrompt(
  sessionId: string,
  body: { message: string; projectId: string; mode: AgentMode },
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/prompt`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
  });
  yield* readNdjson(res);
}

export async function* streamToolResult(
  sessionId: string,
  body: ToolResultBody,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/tool-result`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
  });
  yield* readNdjson(res);
}

export function getApiUrl(): string {
  return API_URL;
}

export type ProjectResources = {
  database: {
    name: string;
    provisionedAt: string;
    proxySqlPath: string;
  } | null;
  secrets: Array<{ key: string; masked: string }>;
};

export async function getProjectResources(
  projectId: string,
): Promise<ProjectResources> {
  const res = await fetch(`${API_URL}/projects/${projectId}/resources`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function getProjectSecrets(
  projectId: string,
): Promise<{ secrets: Array<{ key: string; masked: string }> }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/secrets`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function putProjectSecret(
  projectId: string,
  key: string,
  value: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${projectId}/secrets`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ key, value }),
  });
  await parseJson(res);
}

export async function provisionProjectDatabase(
  projectId: string,
): Promise<{
  ok: boolean;
  database: string;
  alreadyProvisioned?: boolean;
  scaffold?: Record<string, string>;
}> {
  const res = await fetch(`${API_URL}/projects/${projectId}/provision-database`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  return parseJson(res);
}

export async function getInlineEditQuota(
  projectId: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/inline-edit/quota`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function recordInlineEdit(
  projectId: string,
  path: string,
): Promise<{ ok: boolean; remaining: number }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/inline-edit`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ path }),
  });
  return parseJson(res);
}

export type UsageSummary = {
  monthlyCredits: number;
  used: number;
  remaining: number;
  costs: Record<string, number>;
};

export async function getUsage(): Promise<UsageSummary> {
  const res = await fetch(`${API_URL}/me/usage`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type DeploymentSummary = {
  id: string;
  target: string;
  url: string | null;
  status: string;
  buildId: string | null;
  errorMessage: string | null;
  deployedAt: string;
};

export async function getDeployments(
  projectId: string,
): Promise<DeploymentSummary[]> {
  const res = await fetch(`${API_URL}/projects/${projectId}/deployments`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ deployments: DeploymentSummary[] }>(res);
  return data.deployments;
}

export async function triggerDeploy(
  projectId: string,
  body: {
    projectName?: string;
    files?: Array<{ path: string; content: string }>;
  },
): Promise<{
  deploymentId: string;
  slug: string;
  url: string;
  status: string;
  remainingCredits: number;
}> {
  const res = await fetch(`${API_URL}/projects/${projectId}/deploy`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function getGithubStatus(
  projectId: string,
): Promise<{
  connected: boolean;
  repo: string | null;
  authMethod?: 'app' | 'pat' | null;
  appEnabled?: boolean;
  patAllowed?: boolean;
}> {
  const res = await fetch(`${API_URL}/projects/${projectId}/github`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function connectGithub(
  projectId: string,
  repo: string,
  token?: string,
): Promise<{ installUrl?: string; authMethod?: string }> {
  const body: { repo: string; token?: string } = { repo };
  if (token) body.token = token;
  const res = await fetch(`${API_URL}/projects/${projectId}/github/connect`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function completeGithubInstall(
  installationId: number,
  state: string,
): Promise<{ projectId: string; repo: string }> {
  const res = await fetch(`${API_URL}/github/callback`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ installation_id: installationId, state }),
  });
  return parseJson(res);
}

export async function pushGithub(
  projectId: string,
  body: {
    message?: string;
    files?: Array<{ path: string; content: string }>;
  },
): Promise<void> {
  const res = await fetch(`${API_URL}/projects/${projectId}/github/push`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  await parseJson(res);
}
