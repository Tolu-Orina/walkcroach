/**
 * Public SDK surface: `/v1/*` (and APIGW stage-relative `/keys`, `/memory`, …).
 *
 * Dispatched ahead of the `/ide/v1/*` routes, which are untouched — `walkcroach-ide`
 * and `@walkcroach/cli` are published against those and must not move.
 *
 * Path matching tolerates an optional API Gateway stage prefix. `normalizeIdePath`
 * only strips `/v1` when it is followed by `/ide`, so a bare `/v1/memory/recall`
 * arrives intact; behind a `v1` stage the same call can also appear as
 * `/v1/v1/memory/recall`. Both are accepted rather than depending on deployment
 * shape, because getting this wrong fails only in the deployed environment.
 *
 * On the shared API Gateway, `/health` is the *agent* smoke endpoint. SDK
 * capability health is also exposed as `/sdk-health` so it does not collide.
 */
import { requireAuth } from '../auth.js';
import type { HttpRequest } from '../event.js';
import { CORS_HEADERS, jsonResponse } from '../http.js';
import {
  MEMORY_ASOF_RETENTION_SECONDS,
  SDK_CAPABILITIES,
  SDK_PROTOCOL_VERSION,
  SDK_ROOT_SEGMENTS,
} from '../sdk-contract.js';
import { handleContentPublish } from './content.js';
import { handleGraphsCatalog, handleGraphsRun, handleGraphsValidate } from './graphs.js';
import { handleCancelRun, handleGetRun, handleResumeRun } from './runs.js';
import {
  handleApiKeyUsage,
  handleCreateApiKey,
  handleListApiKeys,
  handleRevokeApiKey,
} from './keys.js';
import {
  handleSdkAuditList,
  handleSdkDiff,
  handleSdkErase,
  handleSdkExport,
  handleSdkImport,
  handleSdkList,
  handleSdkRecall,
  handleSdkRemember,
} from './sdk-memory.js';
import { handleEnsureProject } from './sdk-projects.js';

/** Strip any number of leading `/v1` segments, leaving the SDK-relative path. */
export function normalizeSdkPath(path: string): string {
  let p = path || '/';
  while (/^\/v1(\/|$)/.test(p)) p = p.slice(3) || '/';
  return p;
}

/** True when this request belongs to the SDK surface rather than `/ide/v1`. */
export function isSdkPath(path: string): boolean {
  const p = normalizeSdkPath(path);
  const root = p.replace(/^\//, '').split('/')[0] ?? '';
  return (SDK_ROOT_SEGMENTS as readonly string[]).includes(root);
}

function sdkHealthBody() {
  return {
    ok: true,
    surface: 'sdk' as const,
    version: SDK_PROTOCOL_VERSION,
    capabilities: [...SDK_CAPABILITIES],
    retention: {
      asOfSeconds: MEMORY_ASOF_RETENTION_SECONDS,
      asOfHuman: `${MEMORY_ASOF_RETENTION_SECONDS / 3600}h`,
      mechanism: 'cockroachdb_mvcc_gc_ttl' as const,
      note:
        'Point-in-time recall (asOf/diff) cannot read past this MVCC window; older versions are garbage-collected. Long-lived governance uses memory_audit + erase tombstones (ADR-0001/0002), not multi-year asOf.',
      governance: {
        asOf: 'cockroachdb_mvcc_gc_ttl',
        audit: 'memory_audit',
        erase: 'tombstone_redact',
      },
    },
  };
}

export async function handleSdkRest(req: HttpRequest) {
  const path = normalizeSdkPath(req.path);
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Unauthenticated: lets a client verify reachability and protocol version
  // before it has credentials to try.
  // `/sdk-health` is the APIGW-safe alias when `/health` is owned by the agent.
  if (
    method === 'GET' &&
    (/^\/health\/?$/.test(path) || /^\/sdk-health\/?$/.test(path))
  ) {
    return jsonResponse(200, sdkHealthBody());
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
  if (method === 'POST' && /^\/memory\/erase\/?$/.test(path)) {
    return handleSdkErase(auth, req.body);
  }
  if (method === 'GET' && /^\/memory\/audit\/?$/.test(path)) {
    return handleSdkAuditList(auth, req.queryStringParameters);
  }
  // ── content ─────────────────────────────────────────────────────────────
  if (method === 'POST' && /^\/content\/ensure-project\/?$/.test(path)) {
    return handleEnsureProject(auth, req.body);
  }
  if (method === 'POST' && /^\/content\/publish\/?$/.test(path)) {
    return handleContentPublish(auth, req.body);
  }

  // ── graphs (Phase 6b) ───────────────────────────────────────────────────
  if (method === 'GET' && /^\/graphs\/catalog\/?$/.test(path)) {
    return handleGraphsCatalog(auth);
  }
  if (method === 'POST' && /^\/graphs\/validate\/?$/.test(path)) {
    return handleGraphsValidate(auth, req.body);
  }
  if (method === 'POST' && /^\/graphs\/run\/?$/.test(path)) {
    return handleGraphsRun(auth, req.body);
  }

  // Legacy alias — never relied on for APIGW (root `/projects` is the agent
  // Cognito route). Kept so local ide servers that mount the full SDK router
  // still accept the older path during the cutover.
  if (method === 'POST' && /^\/projects\/ensure\/?$/.test(path)) {
    return handleEnsureProject(auth, req.body);
  }

  // ── runs ────────────────────────────────────────────────────────────────
  const runResumeMatch = path.match(/^\/runs\/([^/]+)\/resume\/?$/);
  if (method === 'POST' && runResumeMatch) {
    return handleResumeRun(auth, runResumeMatch[1]!, req.body);
  }
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
  if (method === 'GET' && /^\/keys\/usage\/?$/.test(path)) {
    return handleApiKeyUsage(auth);
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
