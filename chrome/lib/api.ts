declare const __WALKCROACH_API_BASE__: string;
declare const __WALKCROACH_PRIVACY_URL__: string;
declare const __WALKCROACH_WEB_URL__: string;

export const API_BASE =
  typeof __WALKCROACH_API_BASE__ !== 'undefined'
    ? __WALKCROACH_API_BASE__
    : 'http://localhost:3002';

/** Public privacy policy URL (must be HTTPS for CWS). */
export const PRIVACY_URL =
  typeof __WALKCROACH_PRIVACY_URL__ !== 'undefined'
    ? __WALKCROACH_PRIVACY_URL__
    : 'http://localhost:5173/chrome-privacy.html';

/** WalkCroach Web origin for /connect/chrome sign-in. */
export const WEB_APP_URL =
  typeof __WALKCROACH_WEB_URL__ !== 'undefined'
    ? __WALKCROACH_WEB_URL__
    : 'http://localhost:5173';

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

/**
 * A capture the recall answer was built from (Phase D5).
 *
 * Emitted before the prose so the panel can show its working: which saved pages
 * the answer came from, what kind they are, and whether they are also visible in
 * a linked WalkCroach Web project.
 */
export type RecallSource = {
  captureId: string;
  url: string;
  title: string | null;
  captureType: string;
  workspace: string | null;
  inWebProject: boolean;
  capturedAt: string;
  distance: number;
};

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'memory_recalled'; count: number; kinds?: string[] }
  | { type: 'recall_sources'; sources: RecallSource[] }
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
  webSearchEnabled?: boolean;
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

export type CreditBalance = {
  /** Credits left in the current period. */
  remaining: number;
  /** Period allowance, for the meter denominator. */
  allowance: number;
  /** ISO date the allowance resets, when the plan has one. */
  resetsAt?: string;
  plan?: string;
};

/**
 * Shared Web/Chrome credit ledger (master plan Part 1 §4).
 *
 * The endpoint does not exist yet. Returning `null` rather than throwing means
 * the meter simply does not render until the backend ships — and then lights up
 * with no client change. Deliberately never invents a number: a fabricated
 * balance in a trust-first product is worse than no balance.
 */
export async function fetchCredits(
  token: string,
): Promise<CreditBalance | null> {
  try {
    const res = await fetch(chromePath('/credits'), {
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<CreditBalance>;
    if (
      typeof data.remaining !== 'number' ||
      typeof data.allowance !== 'number' ||
      data.allowance <= 0
    ) {
      return null;
    }
    return {
      remaining: data.remaining,
      allowance: data.allowance,
      resetsAt: data.resetsAt,
      plan: data.plan,
    };
  } catch {
    return null;
  }
}

export type ScreenshotTarget =
  | { mode: 'put'; key: string; uploadUrl: string; contentType: string }
  | { mode: 'direct'; key: string; contentType: string };

/**
 * Attach a screenshot to a saved capture (Phase D4).
 *
 * Presigned PUT first, so a megabyte of JPEG goes straight to S3 and never
 * traverses the Lambda. Falls back to posting through the BFF when there is no
 * bucket (local dev) or when the cross-origin PUT is refused — which it will be
 * until the bucket's CORS rules name the published extension ID. Both paths end
 * with the same object key recorded against the capture.
 *
 * Returns false rather than throwing: a screenshot is an enhancement, and losing
 * it must never fail the capture the user already confirmed.
 */
export async function uploadScreenshot(
  token: string,
  captureId: string,
  base64: string,
): Promise<boolean> {
  let target: ScreenshotTarget | null = null;
  try {
    const res = await fetch(
      chromePath(`/captures/${captureId}/screenshot/presign`),
      { method: 'POST', headers: authHeaders(token) },
    );
    if (res.ok) target = (await res.json()) as ScreenshotTarget;
  } catch {
    // Fall through to the direct path.
  }

  if (target?.mode === 'put') {
    try {
      const bytes = base64ToBytes(base64);
      const put = await fetch(target.uploadUrl, {
        method: 'PUT',
        // Content-Type is bound into the signature, so it must match exactly.
        headers: { 'content-type': target.contentType },
        body: bytes,
      });
      if (put.ok) {
        const commit = await fetch(
          chromePath(`/captures/${captureId}/screenshot/commit`),
          { method: 'POST', headers: authHeaders(token) },
        );
        if (commit.ok) return true;
      }
    } catch {
      // CORS not yet configured, or the URL expired — use the fallback.
    }
  }

  try {
    const res = await fetch(chromePath(`/captures/${captureId}/screenshot`), {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ dataBase64: base64 }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Short-lived read URL for a stored screenshot, or null if there is none. */
export async function fetchScreenshotUrl(
  token: string,
  captureId: string,
): Promise<string | null> {
  try {
    const res = await fetch(chromePath(`/captures/${captureId}/screenshot`), {
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── Connectors (cross-surface platform, Phase E) ─────────────────── */

export type ConnectorConnection = {
  id: string;
  provider: string;
  status: 'connected' | 'revoked' | 'error';
  scopes: string[];
  accountLabel: string | null;
  lastError: string | null;
  connectedAt: string;
};

export type ConnectorProvider = {
  id: string;
  label: string;
  tier: number;
  disclosure: string;
  scopes: string[];
  connection: ConnectorConnection | null;
};

export type ConnectorsResponse = {
  requiresSignIn: boolean;
  providers: ConnectorProvider[];
  /** WalkCroach Web settings page — the single place accounts are connected. */
  connectUrl: string;
};

export async function listConnectors(
  token: string,
): Promise<ConnectorsResponse> {
  const res = await fetch(chromePath('/connectors'), {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as ConnectorsResponse;
}

export async function disconnectConnector(
  token: string,
  provider: string,
): Promise<void> {
  const res = await fetch(chromePath(`/connectors/${provider}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(await res.text());
}

/** A validated, recorded proposal — everything the confirm card needs. */
export type ConnectorProposal = {
  runId: string;
  action: string;
  title: string;
  consequence: string;
  write: boolean;
  /** Cannot be taken back once executed. A strict subset of `write`. */
  irreversible: boolean;
  weight: number;
  rows: Array<{ label: string; value: string }>;
};

export async function proposeConnectorAction(
  token: string,
  action: string,
  args: Record<string, unknown>,
): Promise<ConnectorProposal> {
  const res = await fetch(chromePath('/connectors/propose'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ action, args }),
  });
  const data = (await res.json()) as ConnectorProposal & {
    error?: string;
    needsConnection?: string;
  };
  if (!res.ok) throw new Error(data.error ?? 'could not prepare that action');
  return data;
}

/**
 * Confirm. Deliberately sends no arguments: the payload was fixed when the
 * proposal was recorded, so what executes is exactly what the card showed.
 */
export async function executeConnectorRun(
  token: string,
  runId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(chromePath(`/connectors/runs/${runId}/execute`), {
    method: 'POST',
    headers: authHeaders(token),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    result?: Record<string, unknown>;
    error?: string;
  };
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'action failed');
  return data.result ?? {};
}

export async function declineConnectorRun(
  token: string,
  runId: string,
): Promise<void> {
  await fetch(chromePath(`/connectors/runs/${runId}/decline`), {
    method: 'POST',
    headers: authHeaders(token),
  }).catch(() => undefined);
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
  /** False when this check found the same price as the previous one. */
  priceChanged?: boolean;
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
    priceChanged?: boolean;
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

export type OauthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
};

/** Public: exchange one-time Web→Chrome connect code for Cognito tokens. */
export async function exchangeOauthToken(body: {
  code: string;
  state: string;
  redirectUri: string;
}): Promise<OauthTokenResponse> {
  const res = await fetch(chromePath('/oauth/token'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `oauth token failed: ${res.status}`);
  }
  return (await res.json()) as OauthTokenResponse;
}

/** Public: refresh Cognito tokens via Chrome BFF (keeps Cognito session alive). */
export async function refreshCognitoSession(
  refreshToken: string,
): Promise<OauthTokenResponse> {
  const res = await fetch(chromePath('/oauth/refresh'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    throw new Error(
      (await res.text()) || `oauth refresh failed: ${res.status}`,
    );
  }
  return (await res.json()) as OauthTokenResponse;
}

/** Create a one-time handoff for Open in Web Chat (page extract stays off the URL). */
export async function createChatHandoff(
  token: string,
  body: {
    title: string;
    url: string;
    extractedText: string;
    question?: string;
  },
): Promise<{ code: string; expiresIn: number }> {
  const res = await fetch(chromePath('/chat-handoff'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as { code: string; expiresIn: number };
}
