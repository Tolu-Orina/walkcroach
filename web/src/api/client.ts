import type {
  ActivityEvent,
  AgentEvent,
  AgentMode,
  CheckpointSummary,
  PlanDecision,
  ProjectDetail,
  ProjectDocument,
  ProjectMemoryEntry,
  ProjectSession,
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
      const parsed = JSON.parse(raw) as {
        token?: string;
        cognito?: { idToken?: string };
      };
      const bearer = parsed.cognito?.idToken ?? parsed.token;
      if (bearer) {
        headers.authorization = `Bearer ${bearer}`;
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

/** Like parseJson but preserves API error payloads for confirm flows (402/429). */
async function parseJsonSoft<T extends { ok?: boolean; error?: string }>(
  res: Response,
): Promise<T> {
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { error: text || `${res.status} ${res.statusText}` };
  }
  if (!res.ok) {
    return {
      ...body,
      ok: false,
      error:
        typeof body.error === 'string'
          ? body.error
          : `${res.status} ${res.statusText}`,
    } as T;
  }
  return body as T;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(`${API_URL}/projects`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ projects: ProjectSummary[] }>(res);
  return data.projects ?? [];
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
  opts?: { kind?: 'app' | 'general' },
): Promise<{ id: string; templateId?: string; kind?: string }> {
  const res = await fetch(`${API_URL}/projects`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      name,
      templateId,
      kind: opts?.kind ?? 'app',
    }),
  });
  return parseJson(res);
}

/** Personal Chat workspace (kind=general) — one per user. */
export async function ensureChatWorkspace(): Promise<{ id: string }> {
  const res = await fetch(`${API_URL}/me/chat-workspace`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  return parseJson(res);
}

export async function listChatSessions(
  workspaceId: string,
): Promise<Array<{ id: string; title: string }>> {
  const res = await fetch(
    `${API_URL}/projects/${workspaceId}/sessions?mode=chat&limit=20`,
    { headers: authHeaders() },
  );
  const data = await parseJson<{
    sessions: Array<{
      id: string;
      title: string | null;
      mode?: string;
      createdAt?: string;
    }>;
  }>(res);
  // Server filters mode=chat; keep a soft guard for older backends.
  return (data.sessions ?? [])
    .filter((s) => (s.mode ?? 'chat') === 'chat')
    .map((s) => ({
      id: s.id,
      title: s.title?.trim() || `Chat ${s.id.slice(0, 8)}`,
    }));
}

export async function listProjectSessions(
  projectId: string,
): Promise<ProjectSession[]> {
  const res = await fetch(`${API_URL}/projects/${projectId}/sessions`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ sessions: ProjectSession[] }>(res);
  return data.sessions ?? [];
}

export async function patchProject(
  projectId: string,
  patch: {
    name?: string;
    description?: string | null;
    instructions?: string | null;
    templateId?: string;
  },
): Promise<ProjectDetail> {
  const res = await fetch(`${API_URL}/projects/${projectId}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  return parseJson(res);
}

export async function listProjectDocuments(
  projectId: string,
): Promise<ProjectDocument[]> {
  const res = await fetch(`${API_URL}/projects/${projectId}/documents`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ documents: ProjectDocument[] }>(res);
  return data.documents ?? [];
}

export async function createProjectDocument(
  projectId: string,
  input: { name: string; mime?: string; textContent: string },
): Promise<ProjectDocument> {
  const res = await fetch(`${API_URL}/projects/${projectId}/documents`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function deleteProjectDocument(
  projectId: string,
  documentId: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/projects/${projectId}/documents/${documentId}`,
    {
      method: 'DELETE',
      headers: authHeaders(),
    },
  );
  await parseJson(res);
}

export async function listProjectMemory(
  projectId: string,
): Promise<{ summary: string | null; entries: ProjectMemoryEntry[] }> {
  const res = await fetch(`${API_URL}/projects/${projectId}/memory`, {
    headers: authHeaders(),
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
  mode: 'chat' | 'builder' = 'builder',
): Promise<{ id: string; projectId: string }> {
  const res = await fetch(`${API_URL}/sessions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ projectId, mode }),
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
    attachments?: Array<{
      name: string;
      mime: string;
      textPreview: string;
      byteSize?: number;
    }> | null;
    citations?: Array<{ title: string; url: string }> | null;
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
  return data.events ?? [];
}

export async function* streamPlanDecision(
  sessionId: string,
  body: {
    projectId: string;
    planId: string;
    decision: PlanDecision;
    adjustment?: string;
  },
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/plan-decision`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
    signal,
  });
  yield* readNdjson(res, signal);
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
  return data.checkpoints ?? [];
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
  cancelRemaining?: boolean;
};

async function* readNdjson(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        break;
      }
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

    if (!signal?.aborted) {
      const tail = buffer.trim();
      if (tail) yield JSON.parse(tail) as AgentEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamPrompt(
  sessionId: string,
  body: {
    message: string;
    projectId: string;
    mode: AgentMode;
    webSearchEnabled?: boolean;
    attachments?: Array<{
      name: string;
      mime: string;
      textPreview: string;
      byteSize?: number;
      contentText?: string;
      contentBase64?: string;
    }>;
  },
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/prompt`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
    signal,
  });
  yield* readNdjson(res, signal);
}

export async function* streamToolResult(
  sessionId: string,
  body: ToolResultBody,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}/tool-result`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
    signal,
  });
  yield* readNdjson(res, signal);
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
  plan?: 'free' | 'paid';
  sharedPool?: boolean;
};

export async function getUsage(): Promise<UsageSummary> {
  const res = await fetch(`${API_URL}/me/usage`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function getBillingStatus(): Promise<{
  plan: 'free' | 'paid';
  checkoutEnabled: boolean;
  priceLabel: string;
}> {
  const res = await fetch(`${API_URL}/billing/status`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function startBillingCheckout(): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/billing/checkout`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function openBillingPortal(): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/billing/portal`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type CreativeQuota = {
  plan: 'free' | 'paid';
  image: { used: number; limit: number; remaining: number; resetAt: string; unit: string };
  video: {
    used: number;
    limit: number;
    remaining: number;
    resetAt: string;
    label: string;
    interval: string;
    unit: string;
  };
};

export async function getCreativeQuota(): Promise<CreativeQuota> {
  const res = await fetch(`${API_URL}/me/creative-quota`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type CreativeConfirmResult = {
  ok: boolean;
  assetId: string;
  status: string;
  kind?: string;
  downloadName?: string;
  slideCount?: number;
  downloadUrl?: string | null;
  previewUrl?: string | null;
  previewDataUrl?: string | null;
  remainingCredits?: number;
  alreadyReady?: boolean;
  alreadyStarted?: boolean;
  error?: string;
};

export async function confirmCreativeRender(
  assetId: string,
): Promise<CreativeConfirmResult> {
  const res = await fetch(`${API_URL}/creative-assets/${assetId}/confirm`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  return parseJsonSoft(res);
}

export type VideoJobStatus = {
  id: string;
  status: string;
  durationSec: number;
  aspect: string;
  creditsCharged: number;
  imagesConsumed: number;
  downloadUrl: string | null;
  s3Key: string | null;
  error: unknown;
  createdAt: string;
  updatedAt: string;
};

export type VideoConfirmResult = {
  ok: boolean;
  jobId: string;
  status: string;
  creditsCharged?: number;
  remainingCredits?: number;
  remainingVideo?: number;
  alreadyReady?: boolean;
  alreadyStarted?: boolean;
  error?: string;
  resetAt?: string;
};

export async function confirmVideoJob(jobId: string): Promise<VideoConfirmResult> {
  const res = await fetch(`${API_URL}/video-jobs/${jobId}/confirm`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({}),
  });
  return parseJsonSoft(res);
}

export async function getVideoJob(jobId: string): Promise<VideoJobStatus> {
  const res = await fetch(`${API_URL}/video-jobs/${jobId}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function getCreativeDownloadUrl(
  assetId: string,
): Promise<{ url: string; downloadName: string }> {
  const res = await fetch(`${API_URL}/creative-assets/${assetId}/download`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function rememberCreative(
  assetId: string,
  body: { projectId: string; note?: string },
): Promise<{ ok: boolean; memoryId: string; assetId: string }> {
  const res = await fetch(`${API_URL}/creative-assets/${assetId}/remember`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
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
  return data.deployments ?? [];
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

export async function pullGithub(
  projectId: string,
): Promise<{
  ok: boolean;
  repo: string;
  fileCount: number;
  files: Array<{ path: string; content: string }>;
  truncated?: boolean;
  omittedCount?: number;
}> {
  const res = await fetch(`${API_URL}/projects/${projectId}/github/pull`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseJson(res);
}

/* —— Phase E: Code library + Apps hub —— */

export type CodeArtefactSummary = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  sessionId: string | null;
  path: string;
  language: string | null;
  contentHash: string | null;
  byteSize: number | null;
  createdAt: string;
  updatedAt: string;
  source: 'chat' | 'builder' | string;
};

export type CodeArtefactDetail = CodeArtefactSummary & {
  content: string | null;
  s3Key: string | null;
};

export async function listCodeArtefacts(): Promise<CodeArtefactSummary[]> {
  const res = await fetch(`${API_URL}/code-artefacts`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ artefacts: CodeArtefactSummary[] }>(res);
  return data.artefacts ?? [];
}

export async function getCodeArtefact(
  artefactId: string,
): Promise<CodeArtefactDetail> {
  const res = await fetch(`${API_URL}/code-artefacts/${artefactId}`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ artefact: CodeArtefactDetail }>(res);
  return data.artefact;
}

export async function createCodeArtefact(body: {
  path?: string;
  content: string;
  language?: string;
  projectId?: string | null;
  sessionId?: string | null;
}): Promise<CodeArtefactDetail> {
  const res = await fetch(`${API_URL}/code-artefacts`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ artefact: CodeArtefactDetail }>(res);
  return data.artefact;
}

export type MyAppDeployment = {
  id: string;
  projectId: string;
  projectName: string;
  target: string;
  url: string | null;
  status: string;
  buildId: string | null;
  errorMessage: string | null;
  deployedAt: string;
};

export async function listMyApps(): Promise<MyAppDeployment[]> {
  const res = await fetch(`${API_URL}/apps/mine`, {
    headers: authHeaders(),
  });
  const data = await parseJson<{ apps: MyAppDeployment[] }>(res);
  return data.apps ?? [];
}

/** Authenticated one-time Chrome → Chat handoff (owner-bound). */
export async function fetchChromeChatHandoff(code: string): Promise<{
  title?: string | null;
  url?: string | null;
  extractedText: string;
  question?: string | null;
}> {
  const res = await fetch(
    `${API_URL}/chrome/v1/chat-handoff/${encodeURIComponent(code)}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

/* ── Phase F connectors ──────────────────────────────────────────── */

export type ConnectorProviderView = {
  id: string;
  label: string;
  tier: number;
  disclosure: string;
  scopes: string[];
  /**
   * False for a provider we have announced but not shipped. Distinct from a
   * provider with no credentials, which the API omits entirely — see
   * `listableProviders` in @walkcroach/connectors.
   *
   * Optional because a Lambda older than this field simply will not send it;
   * defaulting to connectable keeps those responses behaving as before.
   */
  connectable?: boolean;
  /** Why it cannot be connected yet. Null/absent when it can. */
  comingSoon?: string | null;
  connection: {
    id: string;
    provider: string;
    status: string;
    accountLabel: string | null;
    lastError: string | null;
    connectedAt: string;
  } | null;
};

export async function listConnectors(): Promise<{
  providers: ConnectorProviderView[];
  connectUrl: string;
}> {
  const res = await fetch(`${API_URL}/connectors`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function startConnectorOauth(
  provider: string,
  surface: 'web' | 'chrome' = 'web',
): Promise<{ authorizeUrl: string; state: string; redirectUri: string }> {
  const res = await fetch(
    `${API_URL}/connectors/${encodeURIComponent(provider)}/oauth/start`,
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ surface }),
    },
  );
  return parseJson(res);
}

export async function completeConnectorOauth(body: {
  code: string;
  state: string;
}): Promise<{ ok: boolean; provider: string }> {
  const res = await fetch(`${API_URL}/connectors/oauth/callback`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function disconnectConnector(provider: string): Promise<void> {
  const res = await fetch(
    `${API_URL}/connectors/${encodeURIComponent(provider)}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  await parseJson(res);
}

export async function executeConnectorRun(
  runId: string,
): Promise<{ ok: boolean; result: Record<string, unknown>; creditsCharged?: number }> {
  const res = await fetch(
    `${API_URL}/connectors/runs/${encodeURIComponent(runId)}/execute`,
    { method: 'POST', headers: authHeaders() },
  );
  return parseJson(res);
}

export async function declineConnectorRun(runId: string): Promise<void> {
  const res = await fetch(
    `${API_URL}/connectors/runs/${encodeURIComponent(runId)}/decline`,
    { method: 'POST', headers: authHeaders() },
  );
  await parseJson(res);
}
