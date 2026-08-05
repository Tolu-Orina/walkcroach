/**
 * Public SDK surface: `/v1/*`.
 *
 * Dispatched ahead of the `/ide/v1/*` routes, which are untouched — `walkcroach-ide`
 * and `@walkcroach/cli` are published against those and must not move.
 *
 * Path matching tolerates an optional API Gateway stage prefix. `normalizeIdePath`
 * only strips `/v1` when it is followed by `/ide`, so a bare `/v1/memory/recall`
 * arrives intact; behind a `v1` stage the same call can also appear as
 * `/v1/v1/memory/recall`. Both are accepted rather than depending on deployment
 * shape, because getting this wrong fails only in the deployed environment.
 */
import { requireAuth } from '../auth.js';
import type { HttpRequest } from '../event.js';
import { CORS_HEADERS, jsonResponse } from '../http.js';
import { handleContentPublish } from './content.js';
import { handleCancelRun, handleGetRun } from './runs.js';
import {
  handleCreateApiKey,
  handleListApiKeys,
  handleRevokeApiKey,
} from './keys.js';
import {
  handleSdkDiff,
  handleSdkExport,
  handleSdkImport,
  handleSdkList,
  handleSdkRecall,
  handleSdkRemember,
} from './sdk-memory.js';

/** Strip any number of leading `/v1` segments, leaving the SDK-relative path. */
export function normalizeSdkPath(path: string): string {
  let p = path || '/';
  while (/^\/v1(\/|$)/.test(p)) p = p.slice(3) || '/';
  return p;
}

/** True when this request belongs to the SDK surface rather than `/ide/v1`. */
export function isSdkPath(path: string): boolean {
  const p = normalizeSdkPath(path);
  return /^\/(memory|keys|health|content|runs)(\/|$)/.test(p);
}

export async function handleSdkRest(req: HttpRequest) {
  const path = normalizeSdkPath(req.path);
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Unauthenticated: lets a client verify reachability and protocol version
  // before it has credentials to try.
  if (method === 'GET' && /^\/health\/?$/.test(path)) {
    return jsonResponse(200, {
      ok: true,
      surface: 'sdk',
      version: 'v1',
      capabilities: ['memory:read', 'memory:write', 'memory:asOf', 'memory:diff'],
    });
  }

  const auth = await requireAuth(req.headers);
  if ('error' in auth) {
    return jsonResponse(auth.status, { error: auth.error });
  }

  // ── memory ──────────────────────────────────────────────────────────────
  if (method === 'POST' && /^\/memory\/entries\/?$/.test(path)) {
    return handleSdkRemember(auth, req.body);
  }
  if (method === 'GET' && /^\/memory\/entries\/?$/.test(path)) {
    return handleSdkList(auth, req.queryStringParameters);
  }
  if (method === 'POST' && /^\/memory\/recall\/?$/.test(path)) {
    return handleSdkRecall(auth, req.body);
  }
  if (method === 'POST' && /^\/memory\/diff\/?$/.test(path)) {
    return handleSdkDiff(auth, req.body);
  }
  // ── content ─────────────────────────────────────────────────────────────
  if (method === 'POST' && /^\/content\/publish\/?$/.test(path)) {
    return handleContentPublish(auth, req.body);
  }

  // ── runs ────────────────────────────────────────────────────────────────
  const runMatch = path.match(/^\/runs\/([^/]+)\/?$/);
  if (method === 'GET' && runMatch) {
    return handleGetRun(auth, runMatch[1]!, req.queryStringParameters);
  }
  if (method === 'DELETE' && runMatch) {
    return handleCancelRun(auth, runMatch[1]!);
  }

  if (method === 'GET' && /^\/memory\/export\/?$/.test(path)) {
    return handleSdkExport(auth, req.queryStringParameters);
  }
  if (method === 'POST' && /^\/memory\/import\/?$/.test(path)) {
    return handleSdkImport(auth, req.body);
  }

  // ── keys (Cognito-only; see keys.ts) ────────────────────────────────────
  if (method === 'POST' && /^\/keys\/?$/.test(path)) {
    return handleCreateApiKey(auth, req.body);
  }
  if (method === 'GET' && /^\/keys\/?$/.test(path)) {
    return handleListApiKeys(auth);
  }
  const revoke = path.match(/^\/keys\/([^/]+)\/?$/);
  if (method === 'DELETE' && revoke) {
    return handleRevokeApiKey(auth, revoke[1]!);
  }

  return jsonResponse(404, { error: 'not found', path });
}
