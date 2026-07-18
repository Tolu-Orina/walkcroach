declare const __WALKCROACH_API_BASE__: string;
declare const __WALKCROACH_PRIVACY_URL__: string;

export const API_BASE =
  typeof __WALKCROACH_API_BASE__ !== 'undefined'
    ? __WALKCROACH_API_BASE__
    : 'http://localhost:3002';

/** Public privacy policy URL (must be HTTPS for CWS). */
export const PRIVACY_URL =
  typeof __WALKCROACH_PRIVACY_URL__ !== 'undefined'
    ? __WALKCROACH_PRIVACY_URL__
    : 'http://localhost:5173/chrome-privacy.html';

export type DeviceSessionResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  ownerId: string;
  deviceKey?: string;
};

export type HealthResponse = {
  ok: boolean;
  service: string;
  version: string;
};

export type Workspace = {
  id: string;
  name: string;
  linked_project_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Capture = {
  id: string;
  workspace_id: string | null;
  url: string;
  title: string | null;
  extracted_text: string | null;
  capture_type: string;
  structured_fields: unknown;
  content_hash: string | null;
  captured_at: string;
};

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'memory_recalled'; count: number; kinds?: string[] }
  | {
      type: 'proposal';
      captureType: string;
      actionId: string;
      fields: Record<string, unknown>;
      summary: string;
    };

export type PagePayload = {
  url: string;
  title: string;
  extractedText: string;
  contentHash: string;
  workspaceId?: string | null;
  question?: string;
  instruction?: string;
  tone?: string;
  actionId?: string;
  captureType?: string;
  fields?: string[];
  label?: string;
};

function chromePath(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  return `${base}/chrome/v1${path}`;
}

function authHeaders(token: string): HeadersInit {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(chromePath('/health'));
  if (!res.ok) throw new Error(`health failed: ${res.status}`);
  return (await res.json()) as HealthResponse;
}

export async function createDeviceSession(
  deviceKey?: string,
): Promise<DeviceSessionResponse> {
  const res = await fetch(chromePath('/device/session'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(deviceKey ? { deviceKey } : {}),
  });
  if (!res.ok) {
    throw new Error(`device session failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as DeviceSessionResponse;
}

async function* readNdjson(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  if (!res.ok || !res.body) {
    throw new Error((await res.text()) || `${res.status}`);
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
        try {
          yield JSON.parse(trimmed) as AgentEvent;
        } catch {
          yield { type: 'error', message: 'malformed stream chunk' };
        }
      }
    }
    const tail = buffer.trim();
    if (tail && !signal?.aborted) {
      try {
        yield JSON.parse(tail) as AgentEvent;
      } catch {
        yield { type: 'error', message: 'malformed stream chunk' };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* streamRoute(
  path: string,
  token: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const res = await fetch(chromePath(path), {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
    signal,
  });
  yield* readNdjson(res, signal);
}

export function streamSummarize(
  token: string,
  body: PagePayload,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  return streamRoute('/summarize', token, body, signal);
}

export function streamAsk(
  token: string,
  body: PagePayload & { question: string },
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  return streamRoute('/ask', token, body, signal);
}

export function streamDraft(
  token: string,
  body: PagePayload & { instruction?: string; tone?: string },
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  return streamRoute('/draft', token, body, signal);
}

export function streamPropose(
  token: string,
  body: PagePayload,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  return streamRoute('/extract/propose', token, body, signal);
}

export function streamRecall(
  token: string,
  body: {
    question: string;
    workspaceId?: string | null;
    scope?: 'workspace' | 'all';
  },
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  return streamRoute('/recall', token, body, signal);
}

export async function listWorkspaces(token: string): Promise<Workspace[]> {
  const res = await fetch(chromePath('/workspaces'), {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { workspaces: Workspace[] };
  return data.workspaces;
}

export async function createWorkspace(
  token: string,
  name: string,
): Promise<Workspace> {
  const res = await fetch(chromePath('/workspaces'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { workspace: Workspace };
  return data.workspace;
}

export async function renameWorkspace(
  token: string,
  id: string,
  name: string,
): Promise<Workspace> {
  const res = await fetch(chromePath(`/workspaces/${id}`), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { workspace: Workspace };
  return data.workspace;
}

export async function deleteWorkspace(token: string, id: string): Promise<void> {
  const res = await fetch(chromePath(`/workspaces/${id}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}

export type WebProject = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

export async function listMyProjects(
  token: string,
): Promise<{ projects: WebProject[]; hint?: string }> {
  const res = await fetch(chromePath('/me/projects'), {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { projects: WebProject[]; hint?: string };
}

export async function linkWorkspaceProject(
  token: string,
  workspaceId: string,
  projectId: string | null,
): Promise<{
  ok: boolean;
  linkedProjectId: string | null;
  projectName?: string;
  backfilled?: number;
  message?: string;
}> {
  const res = await fetch(
    chromePath(`/workspaces/${workspaceId}/link-project`),
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ projectId }),
    },
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    ok: boolean;
    linkedProjectId: string | null;
    projectName?: string;
    backfilled?: number;
    message?: string;
  };
}

export async function listCaptures(
  token: string,
  workspaceId: string,
): Promise<Capture[]> {
  const res = await fetch(
    chromePath(`/captures?workspaceId=${encodeURIComponent(workspaceId)}`),
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { captures: Capture[] };
  return data.captures;
}

export async function saveCapture(
  token: string,
  body: {
    workspaceId: string;
    url: string;
    title: string;
    extractedText: string;
    contentHash: string;
    captureType?: string;
    structuredFields?: Record<string, unknown>;
  },
): Promise<{
  captureId: string;
  linkedProjectId: string | null;
  availableInWebProject: boolean;
}> {
  const res = await fetch(chromePath('/captures'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    captureId: string;
    linkedProjectId: string | null;
    availableInWebProject: boolean;
  };
}

export async function trackPrice(
  token: string,
  body: {
    workspaceId: string;
    url: string;
    title: string;
    extractedText: string;
    contentHash: string;
    price?: number | string;
    currency?: string;
    productName?: string;
    structuredFields?: Record<string, unknown>;
  },
): Promise<{
  captureId: string;
  appended: boolean;
  structuredFields: Record<string, unknown>;
  linkedProjectId?: string | null;
  availableInWebProject?: boolean;
}> {
  const res = await fetch(chromePath('/captures/price-track'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    captureId: string;
    appended: boolean;
    structuredFields: Record<string, unknown>;
    linkedProjectId?: string | null;
    availableInWebProject?: boolean;
  };
}

export async function deleteCapture(token: string, id: string): Promise<void> {
  const res = await fetch(chromePath(`/captures/${id}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function upgradeAuth(
  cognitoAccessToken: string,
  anonOwnerId: string,
  deviceKey: string,
): Promise<{ ok: boolean; merged: boolean; ownerId?: string }> {
  const res = await fetch(chromePath('/auth/upgrade'), {
    method: 'POST',
    headers: authHeaders(cognitoAccessToken),
    body: JSON.stringify({ anonOwnerId, deviceKey }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    ok: boolean;
    merged: boolean;
    ownerId?: string;
  };
}
