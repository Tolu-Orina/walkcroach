/**
 * Public `/v1/memory/*` handlers for @walkcroach/sdk and @walkcroach/sdk-mcp.
 *
 * Separate from `memory.ts` (the `/ide/v1` surface) on purpose. The IDE routes are
 * published and pinned by `walkcroach-ide@0.2.0` and `@walkcroach/cli@0.3.0`; a
 * refactor to share route handling would put those at risk two weeks before the
 * deadline for no benefit. Both files call the same `@walkcroach/agent-harness`
 * functions, which is where the behaviour actually lives.
 *
 * Two differences from the IDE surface, both deliberate:
 *   * `sourceSurface` is free-form here. An SDK caller is a surface we have never
 *     heard of — that is the entire point — so it is recorded, not whitelisted.
 *   * scopes are enforced. See `requireScope`.
 */
import {
  appendMemoryAudit,
  diffProjectMemory,
  eraseMemoryEntries,
  exportProjectMemory,
  importProjectMemory,
  ImportFormatError,
  listMemoryAudit,
  listProjectMemoryEntries,
  recallProjectMemory,
  recallProjectMemoryAsOf,
  RetentionWindowError,
  writeMemoryEntryDetailed,
  MEMORY_KINDS,
  type MemoryKind,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import { debitCredits } from '@walkcroach/ledger';
import type { AuthContext } from '../auth.js';
import { hasScope, type ApiKeyScope } from '../api-keys.js';
import { creditHeaders, jsonResponse } from '../http.js';
import { isUuid, metricLog, parseJsonBody } from '../util.js';
import { assertOwnsProject } from './me.js';

/** Single source: `@walkcroach/memory-contracts` via harness re-export (P1). */
const ALLOWED_KINDS = new Set<MemoryKind>(MEMORY_KINDS);

/** Free-form, but bounded — this lands in an indexed column and in metrics. */
const SURFACE_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

const QUOTA_RETRY_AFTER_SECONDS = 3600;

type SdkMeterAction =
  | 'memory_remember'
  | 'memory_recall'
  | 'memory_import'
  | 'memory_list'
  | 'memory_export'
  | 'memory_diff'
  | 'memory_erase'
  | 'memory_audit';

type ChargeOutcome =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: ReturnType<typeof jsonResponse> };

function toRelevance(distance: number | undefined): number | null {
  if (distance === undefined || !Number.isFinite(distance)) return null;
  const clamped = Math.min(Math.max(distance, 0), 2);
  return Number((1 - clamped / 2).toFixed(4));
}

export function requireScope(
  auth: AuthContext,
  scope: ApiKeyScope,
): { error: string; status: number } | null {
  if (hasScope(auth.scopes, scope)) return null;
  return { status: 403, error: `this key is missing the '${scope}' scope` };
}

/**
 * Pass if the credential has **any** of the listed scopes (Cognito = all).
 * Used for run poll/cancel so a `content:run` key can wait on its own publishes
 * without also holding `memory:read`.
 */
export function requireAnyScope(
  auth: AuthContext,
  scopes: readonly ApiKeyScope[],
): { error: string; status: number } | null {
  if (scopes.length === 0) {
    return { status: 403, error: 'no acceptable scopes configured' };
  }
  for (const scope of scopes) {
    if (hasScope(auth.scopes, scope)) return null;
  }
  const listed = scopes.map((s) => `'${s}'`).join(' or ');
  return {
    status: 403,
    error: `this key needs one of: ${listed}`,
  };
}

async function resolveProject(
  auth: AuthContext,
  projectId: string | undefined,
): Promise<
  { ok: true; projectId: string } | { ok: false; status: number; error: string }
> {
  if (!projectId || !isUuid(projectId)) {
    return { ok: false, status: 400, error: 'projectId (uuid) is required' };
  }
  const owned = await assertOwnsProject(auth.ownerId, projectId);
  if (!owned.ok) return owned;
  return { ok: true, projectId };
}

function requestIdFrom(auth: AuthContext, bodyEventId?: string): string | null {
  if (bodyEventId && bodyEventId.length <= 128) return bodyEventId;
  return null;
}

async function chargeOr429(
  db: ReturnType<typeof createDbClient>,
  auth: AuthContext,
  action: SdkMeterAction,
  projectId: string,
): Promise<ChargeOutcome> {
  const result = await debitCredits(db, auth.ownerId, action, projectId, {
    keyId: auth.keyId ?? null,
    source: auth.source,
  });
  const headers = creditHeaders({
    remaining: result.remaining,
    limit: result.limit,
    cost: result.ok ? result.credits : 0,
  });
  if (result.ok) return { ok: true, headers };
  return {
    ok: false,
    response: jsonResponse(
      429,
      {
        error: 'quota exceeded',
        code: 'QUOTA_EXCEEDED',
        remaining: result.remaining,
        action,
      },
      {
        'retry-after': String(QUOTA_RETRY_AFTER_SECONDS),
        ...headers,
      },
    ),
  };
}

/**
 * POST /v1/memory/entries
 * Body: { projectId, text, kind?, surface?, sourceEventId? }
 */
export async function handleSdkRemember(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:write');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const parsed = parseJsonBody<{
    projectId?: string;
    text?: string;
    kind?: string;
    surface?: string;
    sourceEventId?: string;
  }>(rawBody);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
  const body = parsed.data;

  const project = await resolveProject(auth, body.projectId);
  if (!project.ok) return jsonResponse(project.status, { error: project.error });

  const text = body.text?.trim();
  if (!text) return jsonResponse(400, { error: 'text is required' });
  if (text.length > 20_000) {
    return jsonResponse(400, { error: 'text exceeds 20000 characters' });
  }

  const kind = (body.kind ?? 'decision').toLowerCase() as MemoryKind;
  if (!ALLOWED_KINDS.has(kind)) {
    return jsonResponse(400, {
      error: `kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`,
    });
  }

  const surface = (body.surface ?? 'sdk').toLowerCase();
  if (!SURFACE_RE.test(surface)) {
    return jsonResponse(400, {
      error: 'surface must be 1–63 chars of [a-z0-9._-]',
    });
  }

  const sourceEventId = requestIdFrom(auth, body.sourceEventId);

  const db = createDbClient();
  try {
    const charged = await chargeOr429(db, auth, 'memory_remember', project.projectId);
    if (!charged.ok) return charged.response;

    const { id, supersededId } = await writeMemoryEntryDetailed({
      db,
      projectId: project.projectId,
      sourceSurface: surface,
      kind,
      text,
      actorOwnerId: auth.ownerId,
      actorKeyId: auth.keyId ?? null,
      sourceEventId,
    });

    await appendMemoryAudit({
      db,
      projectId: project.projectId,
      ownerId: auth.ownerId,
      action: 'remember',
      actorKeyId: auth.keyId,
      entryId: id,
      requestId: sourceEventId,
      detail: { kind, surface, supersededId },
    });
    if (supersededId) {
      await appendMemoryAudit({
        db,
        projectId: project.projectId,
        ownerId: auth.ownerId,
        action: 'supersede',
        actorKeyId: auth.keyId,
        entryId: supersededId,
        requestId: sourceEventId,
        detail: { replacedBy: id },
      });
    }

    metricLog('sdk.memory.remember', { superseded: supersededId !== null, surface });
    return jsonResponse(
      200,
      {
        id,
        supersededId,
        projectId: project.projectId,
        kind,
        surface,
      },
      charged.headers,
    );
  } finally {
    await db.close();
  }
}

/**
 * POST /v1/memory/recall
 * Body: { projectId, query, limit?, kinds?, surfaces?, asOf? }
 */
export async function handleSdkRecall(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:read');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const parsed = parseJsonBody<{
    projectId?: string;
    query?: string;
    limit?: number;
    kinds?: string[];
    surfaces?: string[];
    asOf?: string;
  }>(rawBody);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
  const body = parsed.data;

  const project = await resolveProject(auth, body.projectId);
  if (!project.ok) return jsonResponse(project.status, { error: project.error });

  const query = body.query?.trim();
  if (!query) return jsonResponse(400, { error: 'query is required' });

  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 20);
  const surfaces = Array.isArray(body.surfaces)
    ? body.surfaces.map((s) => String(s).toLowerCase()).filter(Boolean)
    : undefined;
  const kindSet =
    Array.isArray(body.kinds) && body.kinds.length > 0
      ? new Set(body.kinds.map((k) => String(k).toLowerCase()))
      : null;

  const db = createDbClient();
  try {
    const charged = await chargeOr429(db, auth, 'memory_recall', project.projectId);
    if (!charged.ok) return charged.response;

    const hits = body.asOf
      ? await recallProjectMemoryAsOf({
          db,
          projectId: project.projectId,
          query,
          at: body.asOf,
          limit,
          sourceSurfaces: surfaces,
        })
      : await recallProjectMemory({
          db,
          projectId: project.projectId,
          query,
          limit,
          sourceSurfaces: surfaces,
        });

    metricLog('sdk.memory.recall', { count: hits.length, asOf: Boolean(body.asOf) });
    return jsonResponse(
      200,
      {
        projectId: project.projectId,
        asOf: body.asOf ?? null,
        hits: hits
          .filter((h) => !kindSet || kindSet.has(h.kind))
          .map((h) => ({
            id: h.id,
            kind: h.kind,
            text: h.text,
            surface: h.sourceSurface ?? 'unknown',
            relevance: toRelevance(h.distance),
          })),
      },
      charged.headers,
    );
  } catch (err) {
    if (err instanceof RetentionWindowError) {
      return jsonResponse(400, { error: err.message, code: err.code });
    }
    if (err instanceof TypeError || err instanceof RangeError) {
      return jsonResponse(400, { error: err.message });
    }
    throw err;
  } finally {
    await db.close();
  }
}

/** GET /v1/memory/entries?projectId=&limit=&surfaces= */
export async function handleSdkList(
  auth: AuthContext,
  query: Record<string, string | undefined>,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:read');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const project = await resolveProject(auth, query.projectId);
  if (!project.ok) return jsonResponse(project.status, { error: project.error });

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const surfaces = query.surfaces
    ? query.surfaces.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : undefined;

  const db = createDbClient();
  try {
    const charged = await chargeOr429(db, auth, 'memory_list', project.projectId);
    if (!charged.ok) return charged.response;

    const entries = await listProjectMemoryEntries({
      db,
      projectId: project.projectId,
      limit,
      sourceSurfaces: surfaces,
    });
    return jsonResponse(
      200,
      {
        projectId: project.projectId,
        entries: entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          text: e.text,
          surface: e.sourceSurface,
          createdAt: e.createdAt,
        })),
      },
      charged.headers,
    );
  } finally {
    await db.close();
  }
}

/**
 * GET /v1/memory/export?projectId=&embeddings=false&superseded=false
 */
export async function handleSdkExport(
  auth: AuthContext,
  query: Record<string, string | undefined>,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:read');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const project = await resolveProject(auth, query.projectId);
  if (!project.ok) return jsonResponse(project.status, { error: project.error });

  const db = createDbClient();
  try {
    const charged = await chargeOr429(db, auth, 'memory_export', project.projectId);
    if (!charged.ok) return charged.response;

    const bundle = await exportProjectMemory({
      db,
      projectId: project.projectId,
      includeEmbeddings: query.embeddings !== 'false',
      includeSuperseded: query.superseded !== 'false',
    });
    await appendMemoryAudit({
      db,
      projectId: project.projectId,
      ownerId: auth.ownerId,
      action: 'export',
      actorKeyId: auth.keyId,
      detail: { entries: bundle.entryCount },
    });
    metricLog('sdk.memory.export', { entries: bundle.entryCount });
    return jsonResponse(200, bundle, charged.headers);
  } finally {
    await db.close();
  }
}

/**
 * POST /v1/memory/import
 * Body: { projectId, bundle, preserveSupersedes? }
 */
export async function handleSdkImport(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:write');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const parsed = parseJsonBody<{
    projectId?: string;
    bundle?: unknown;
    preserveSupersedes?: boolean;
  }>(rawBody);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
  const body = parsed.data;

  const project = await resolveProject(auth, body.projectId);
  if (!project.ok) return jsonResponse(project.status, { error: project.error });

  const db = createDbClient();
  try {
    const charged = await chargeOr429(db, auth, 'memory_import', project.projectId);
    if (!charged.ok) return charged.response;

    const result = await importProjectMemory({
      db,
      projectId: project.projectId,
      bundle: body.bundle,
      preserveSupersedes: body.preserveSupersedes,
    });
    await appendMemoryAudit({
      db,
      projectId: project.projectId,
      ownerId: auth.ownerId,
      action: 'import',
      actorKeyId: auth.keyId,
      detail: result,
    });
    metricLog('sdk.memory.import', {
      imported: result.imported,
      reEmbedded: result.reEmbedded,
    });
    return jsonResponse(200, result, charged.headers);
  } catch (err) {
    if (err instanceof ImportFormatError) {
      return jsonResponse(400, { error: err.message, code: err.code });
    }
    throw err;
  } finally {
    await db.close();
  }
}

/**
 * POST /v1/memory/diff
 * Body: { projectId, from, to? }
 */
export async function handleSdkDiff(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:read');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const parsed = parseJsonBody<{ projectId?: string; from?: string; to?: string }>(
    rawBody,
  );
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
  const body = parsed.data;

  const project = await resolveProject(auth, body.projectId);
  if (!project.ok) return jsonResponse(project.status, { error: project.error });

  if (!body.from) return jsonResponse(400, { error: 'from (ISO timestamp) is required' });

  const db = createDbClient();
  try {
    const charged = await chargeOr429(db, auth, 'memory_diff', project.projectId);
    if (!charged.ok) return charged.response;

    const diff = await diffProjectMemory({
      db,
      projectId: project.projectId,
      from: body.from,
      to: body.to ?? 'now',
    });
    metricLog('sdk.memory.diff', {
      added: diff.added.length,
      retired: diff.retired.length,
    });
    return jsonResponse(200, diff, charged.headers);
  } catch (err) {
    if (err instanceof RetentionWindowError) {
      return jsonResponse(400, { error: err.message, code: err.code });
    }
    if (err instanceof TypeError || err instanceof RangeError) {
      return jsonResponse(400, { error: err.message });
    }
    throw err;
  } finally {
    await db.close();
  }
}

/**
 * POST /v1/memory/erase — ADR-0002 tombstone erase (memory:write).
 * Body: { projectId, reason, entryIds?, exportFirst? }
 */
export async function handleSdkErase(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:write');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const parsed = parseJsonBody<{
    projectId?: string;
    reason?: string;
    entryIds?: string[];
    exportFirst?: boolean;
  }>(rawBody);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
  const body = parsed.data;

  const project = await resolveProject(auth, body.projectId);
  if (!project.ok) return jsonResponse(project.status, { error: project.error });

  const reason = body.reason?.trim();
  if (!reason) return jsonResponse(400, { error: 'reason is required' });

  if (Array.isArray(body.entryIds)) {
    for (const id of body.entryIds) {
      if (!isUuid(id)) {
        return jsonResponse(400, { error: 'entryIds must be uuids' });
      }
    }
  }

  const db = createDbClient();
  try {
    const charged = await chargeOr429(db, auth, 'memory_erase', project.projectId);
    if (!charged.ok) return charged.response;

    const result = await eraseMemoryEntries({
      db,
      projectId: project.projectId,
      ownerId: auth.ownerId,
      reason,
      entryIds: body.entryIds,
      actorKeyId: auth.keyId,
      exportFirst: body.exportFirst === true,
    });
    metricLog('sdk.memory.erase', { erased: result.erased });
    return jsonResponse(
      200,
      {
        projectId: project.projectId,
        erased: result.erased,
        entryIds: result.entryIds,
        export: result.exportBundle,
      },
      charged.headers,
    );
  } catch (err) {
    if (err instanceof TypeError) {
      return jsonResponse(400, { error: err.message });
    }
    throw err;
  } finally {
    await db.close();
  }
}

/** GET /v1/memory/audit?projectId=&limit= */
export async function handleSdkAuditList(
  auth: AuthContext,
  query: Record<string, string | undefined>,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'memory:read');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const project = await resolveProject(auth, query.projectId);
  if (!project.ok) return jsonResponse(project.status, { error: project.error });

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const db = createDbClient();
  try {
    const charged = await chargeOr429(db, auth, 'memory_audit', project.projectId);
    if (!charged.ok) return charged.response;

    const events = await listMemoryAudit({
      db,
      projectId: project.projectId,
      limit,
    });
    return jsonResponse(
      200,
      { projectId: project.projectId, events },
      charged.headers,
    );
  } finally {
    await db.close();
  }
}
