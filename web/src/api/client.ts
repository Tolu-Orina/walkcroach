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

/**
 * IDE / public SDK BFF (keys, /v1/memory, …). Local default is ide-api on :3003
 * (`npm run dev:ide` in infra-backend). When unset in production, fall back to
 * API_URL — same host once `/keys` (etc.) are routed to the IDE Lambda.
 */
const IDE_API_URL = (
  import.meta.env.VITE_IDE_API_URL ??
  import.meta.env.VITE_API_URL ??
  'http://localhost:3003'
).replace(/\/$/, '');

/** Resolve SDK paths whether base already ends in `/v1` (API Gateway stage) or not. */
function sdkUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (/\/v1$/i.test(IDE_API_URL)) return `${IDE_API_URL}${p}`;
  return `${IDE_API_URL}/v1${p}`;
}

export function getSdkApiBaseUrl(): string {
  return /\/v1$/i.test(IDE_API_URL) ? IDE_API_URL.replace(/\/v1$/i, '') : IDE_API_URL;
}

/**
 * Chrome BFF base for oauth session-code + chat handoff.
 * Local: `npm run dev:chrome` → :3002. Prod: same shared GW as agent (VITE_API_URL).
 */
const CHROME_API_URL = (
  import.meta.env.VITE_CHROME_API_URL ??
  import.meta.env.VITE_API_URL ??
  'http://localhost:3002'
).replace(/\/$/, '');

export function getChromeApiBaseUrl(): string {
  return CHROME_API_URL;
}

/** Agent harness API base (projects, sessions, billing, sandbox). */
export function getAgentApiBaseUrl(): string {
  return API_URL;
}

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
  // Public memory contract via `@walkcroach/sdk` → `/v1/memory/entries`
  // (not the harness `GET /projects/:id/memory`). Agent-turn recall stays on
  // the harness stream.
  const { createWalkCroachClient } = await import('./sdkClient.js');
  const wc = createWalkCroachClient();
  const entries = await wc.memory.list({ projectId, limit: 100 });
  return {
    summary: null,
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      text: e.text,
      sourceSurface: e.surface,
      createdAt: e.createdAt,
    })),
  };
}

/** User-authored remember via SDK (surface = web). */
export async function rememberProjectMemory(opts: {
  projectId: string;
  kind: string;
  text: string;
}): Promise<{ id: string; supersededId: string | null }> {
  const { createWalkCroachClient } = await import('./sdkClient.js');
  const wc = createWalkCroachClient();
  const result = await wc.memory.remember({
    projectId: opts.projectId,
    kind: opts.kind as never,
    text: opts.text,
    surface: 'web',
  });
  return { id: result.id, supersededId: result.supersededId ?? null };
}

/** Export project memory bundle via SDK. */
export async function exportProjectMemory(projectId: string) {
  const { createWalkCroachClient } = await import('./sdkClient.js');
  const wc = createWalkCroachClient();
  return wc.memory.export({ projectId });
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

export type PlanId = 'free' | 'starter' | 'pro';

export type PlanFeatures = {
  creatives: boolean;
  video: boolean;
  connectorWrites: boolean;
};

export type BillingPlanCatalogItem = {
  id: PlanId;
  name: string;
  priceLabel: string;
  priceCents: number;
  monthlyCredits: number;
  features: PlanFeatures;
  paid: boolean;
  blurb: string;
  highlights: string[];
  checkoutAvailable: boolean;
};

export type UsageSummary = {
  monthlyCredits: number;
  used: number;
  remaining: number;
  costs: Record<string, number>;
  plan?: PlanId | 'paid';
  sharedPool?: boolean;
};

export async function getUsage(): Promise<UsageSummary> {
  const res = await fetch(`${API_URL}/me/usage`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type BillingStatus = {
  plan: PlanId;
  planName: string;
  priceLabel: string;
  monthlyCredits: number;
  features: PlanFeatures;
  checkoutEnabled: boolean;
  catalog: BillingPlanCatalogItem[];
  upgrades: BillingPlanCatalogItem[];
  stripeCustomerId?: string | null;
};

export async function getBillingStatus(): Promise<BillingStatus> {
  const res = await fetch(`${API_URL}/billing/status`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function startBillingCheckout(
  planId: 'starter' | 'pro' = 'pro',
): Promise<{ url?: string; planId?: string; changed?: boolean; ok?: boolean }> {
  const res = await fetch(`${API_URL}/billing/checkout`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ planId }),
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

/** Apply Checkout session entitlements immediately after Stripe redirect. */
export async function confirmBillingCheckout(sessionId: string): Promise<{
  ok: boolean;
  plan: PlanId;
  planName: string;
  monthlyCredits: number;
}> {
  const res = await fetch(`${API_URL}/billing/confirm`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sessionId }),
  });
  return parseJson(res);
}

export type AccountEraseSummary = {
  projects: number;
  apiKeysActive: number;
  connectorsConnected: number;
  hasStripeCustomer: boolean;
  plan: string;
};

export type AccountEraseProposeResult = {
  proposalId: string;
  confirmPhrase: string;
  expiresAt: string;
  summary: AccountEraseSummary;
  message: string;
};

export type AccountEraseConfirmResult = {
  ok: boolean;
  proposalId: string;
  apiKeysRevoked: number;
  connectorsRevoked: number;
  memoryErased: number;
  messagesRedacted: number;
  projectsSoftDeleted: number;
  s3ObjectsDeleted: number;
  stripeCancelled: boolean;
  stripeCustomerDeleted: boolean;
  cognitoDeleted: boolean;
  cognitoSkipped?: string;
  message: string;
};

/** Phase C — propose account erase (typed confirm follows). */
export async function proposeAccountErase(
  email: string,
): Promise<AccountEraseProposeResult> {
  const res = await fetch(`${API_URL}/me/account/erase/propose`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  return parseJson(res);
}

/** Phase C — confirm + execute account erase. */
export async function confirmAccountErase(input: {
  proposalId: string;
  email: string;
  confirmPhrase: string;
}): Promise<AccountEraseConfirmResult> {
  const res = await fetch(`${API_URL}/me/account/erase/confirm`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export type CreativeQuota = {
  plan: PlanId | 'paid';
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
    `${CHROME_API_URL}/chrome/v1/chat-handoff/${encodeURIComponent(code)}`,
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

// ── Developer portal / public SDK API keys (Cognito only) ─────────────────

export type ApiKeyScope = 'memory:read' | 'memory:write' | 'content:run';

export type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKeySummary & {
  key: string;
  warning: string;
};

export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const res = await fetch(sdkUrl('/keys'), {
    headers: authHeaders(),
  });
  const data = await parseJson<{ keys: ApiKeySummary[] }>(res);
  return data.keys ?? [];
}

export type ApiKeyUsageRow = {
  keyId: string;
  remember: number;
  recall: number;
  import: number;
  contentPublish: number;
  credits: number;
};

/** Per-key ledger aggregates for the current billing month (P2.5). */
export async function listApiKeyUsage(): Promise<{
  period: string;
  keys: ApiKeyUsageRow[];
}> {
  const res = await fetch(sdkUrl('/keys/usage'), {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createApiKey(opts: {
  name: string;
  scopes?: ApiKeyScope[];
  expiresInDays?: number;
}): Promise<CreatedApiKey> {
  const res = await fetch(sdkUrl('/keys'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(opts),
  });
  return parseJson(res);
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(sdkUrl(`/keys/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type SdkHealthResponse = {
  ok: boolean;
  version: string;
  capabilities: string[];
  surface?: string;
  retention?: {
    asOfSeconds: number;
    asOfHuman: string;
    mechanism: string;
    note: string;
  };
};

function isSdkHealthBody(body: unknown): body is SdkHealthResponse {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    b.surface === 'sdk' ||
    (Array.isArray(b.capabilities) && typeof b.version === 'string')
  );
}

export async function getSdkHealth(): Promise<SdkHealthResponse> {
  // Prefer APIGW-safe `/sdk-health` first. Ide-local also serves `/health` as
  // an alias; on the shared gateway `/health` is the *agent* smoke endpoint.
  try {
    const preferred = await fetch(sdkUrl('/sdk-health'));
    if (preferred.ok) {
      const body: unknown = await preferred.json();
      if (isSdkHealthBody(body)) return body;
    }
  } catch {
    /* try alias */
  }
  const res = await fetch(sdkUrl('/health'));
  return parseJson(res);
}
