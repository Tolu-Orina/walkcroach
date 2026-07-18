import type { AgentEvent } from '@walkcroach/agent-harness';
import { requireAuth, type AuthContext } from '../auth.js';
import { handleDeviceSession } from './device-session.js';
import {
  handleCreateWorkspace,
  handleDeleteWorkspace,
  handleListWorkspaces,
  handlePatchWorkspace,
} from './workspaces.js';
import {
  handleCreateCapture,
  handleDeleteCapture,
  handleListCaptures,
  handlePatchCapture,
} from './captures.js';
import { handlePriceTrack } from './price-track.js';
import { handleUpgradeAuth } from './upgrade.js';
import {
  handleLinkWorkspace,
  handleListMyProjects,
} from './link.js';
import { handleTelemetry } from './telemetry.js';
import { jsonResponse, CORS_HEADERS } from '../http.js';
import type { HttpRequest } from '../event.js';
import { isUuid, parseJsonBody } from '../util.js';
import {
  streamAsk,
  streamDraft,
  streamSummarize,
} from './llm.js';
import { streamRecall } from './recall.js';
import { streamPropose, type ProposeBody, type ProposalEvent } from './propose.js';

export type ChromeStreamEvent = AgentEvent | ProposalEvent;

export function normalizeChromePath(path: string): string {
  return path.replace(/^\/v1(?=\/)/, '');
}

export function matchStreamRoute(
  method: string,
  path: string,
): 'summarize' | 'ask' | 'draft' | 'recall' | 'propose' | null {
  if (method !== 'POST') return null;
  const p = normalizeChromePath(path);
  if (/\/chrome\/v1\/summarize\/?$/.test(p)) return 'summarize';
  if (/\/chrome\/v1\/ask\/?$/.test(p)) return 'ask';
  if (/\/chrome\/v1\/draft\/?$/.test(p)) return 'draft';
  if (/\/chrome\/v1\/recall\/?$/.test(p)) return 'recall';
  if (/\/chrome\/v1\/extract\/propose\/?$/.test(p)) return 'propose';
  return null;
}

/** Auth for stream routes — callers must return 401 when this fails. */
export async function requireStreamAuth(
  req: HttpRequest,
): Promise<AuthContext | { error: string; status: number }> {
  return requireAuth(req.headers);
}

export async function* handleChromeStream(
  req: HttpRequest,
  route: 'summarize' | 'ask' | 'draft' | 'recall' | 'propose',
  auth: AuthContext,
): AsyncGenerator<ChromeStreamEvent> {
  if (route === 'recall') {
    yield* streamRecall(auth, req.body);
    return;
  }

  const body = parseJsonBody<ProposeBody>(req.body);
  if ('error' in body && body.error === 'invalid JSON body') {
    yield { type: 'error', message: 'invalid JSON body' };
    return;
  }
  const page = body as ProposeBody;

  if (route === 'summarize') yield* streamSummarize(auth, page);
  else if (route === 'ask') yield* streamAsk(auth, page);
  else if (route === 'draft') yield* streamDraft(auth, page);
  else if (route === 'propose') yield* streamPropose(auth, page);
}

export async function handleChromeRest(
  req: HttpRequest,
): Promise<ReturnType<typeof jsonResponse>> {
  const path = normalizeChromePath(req.path);

  if (req.method === 'GET' && /\/chrome\/v1\/health\/?$/.test(path)) {
    return jsonResponse(200, {
      ok: true,
      service: 'walkcroach-chrome',
      version: '0.1.0',
    });
  }

  if (
    req.method === 'POST' &&
    /\/chrome\/v1\/device\/session\/?$/.test(path)
  ) {
    return handleDeviceSession(req.body);
  }

  const auth = await requireAuth(req.headers);
  if ('error' in auth) {
    return jsonResponse(auth.status, { error: auth.error });
  }

  if (req.method === 'GET' && /\/chrome\/v1\/me\/projects\/?$/.test(path)) {
    return handleListMyProjects(auth);
  }

  if (req.method === 'GET' && /\/chrome\/v1\/workspaces\/?$/.test(path)) {
    return handleListWorkspaces(auth);
  }
  if (req.method === 'POST' && /\/chrome\/v1\/workspaces\/?$/.test(path)) {
    return handleCreateWorkspace(auth, req.body);
  }

  const wsLink = path.match(
    /\/chrome\/v1\/workspaces\/([^/]+)\/link-project\/?$/,
  );
  if (req.method === 'POST' && wsLink) {
    if (!isUuid(wsLink[1])) return jsonResponse(400, { error: 'invalid id' });
    return handleLinkWorkspace(auth, wsLink[1]!, req.body);
  }

  const wsPatch = path.match(/\/chrome\/v1\/workspaces\/([^/]+)\/?$/);
  if (req.method === 'PATCH' && wsPatch) {
    if (!isUuid(wsPatch[1])) return jsonResponse(400, { error: 'invalid id' });
    return handlePatchWorkspace(auth, wsPatch[1]!, req.body);
  }
  if (req.method === 'DELETE' && wsPatch) {
    if (!isUuid(wsPatch[1])) return jsonResponse(400, { error: 'invalid id' });
    return handleDeleteWorkspace(auth, wsPatch[1]!);
  }

  if (
    req.method === 'POST' &&
    /\/chrome\/v1\/captures\/price-track\/?$/.test(path)
  ) {
    return handlePriceTrack(auth, req.body);
  }

  if (req.method === 'GET' && /\/chrome\/v1\/captures\/?$/.test(path)) {
    const workspaceId =
      req.queryStringParameters.workspaceId ??
      extractQueryFromPath(req.path, 'workspaceId');
    if (workspaceId && !isUuid(workspaceId)) {
      return jsonResponse(400, { error: 'invalid workspaceId' });
    }
    return handleListCaptures(auth, workspaceId);
  }
  if (req.method === 'POST' && /\/chrome\/v1\/captures\/?$/.test(path)) {
    return handleCreateCapture(auth, req.body);
  }

  const capMatch = path.match(/\/chrome\/v1\/captures\/([^/]+)\/?$/);
  if (req.method === 'PATCH' && capMatch) {
    if (!isUuid(capMatch[1])) return jsonResponse(400, { error: 'invalid id' });
    return handlePatchCapture(auth, capMatch[1]!, req.body);
  }
  if (req.method === 'DELETE' && capMatch) {
    if (!isUuid(capMatch[1])) return jsonResponse(400, { error: 'invalid id' });
    return handleDeleteCapture(auth, capMatch[1]!);
  }

  if (
    req.method === 'POST' &&
    /\/chrome\/v1\/auth\/upgrade\/?$/.test(path)
  ) {
    return handleUpgradeAuth(auth, req.body);
  }

  if (
    req.method === 'POST' &&
    /\/chrome\/v1\/telemetry\/?$/.test(path)
  ) {
    return handleTelemetry(auth, req.body);
  }

  return jsonResponse(404, { error: 'not found', path: req.path });
}

function extractQueryFromPath(path: string, key: string): string | undefined {
  const qIdx = path.indexOf('?');
  if (qIdx < 0) return undefined;
  return new URLSearchParams(path.slice(qIdx + 1)).get(key) ?? undefined;
}

export { CORS_HEADERS };
