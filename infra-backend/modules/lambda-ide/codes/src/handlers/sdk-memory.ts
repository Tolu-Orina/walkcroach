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
  diffProjectMemory,
  exportProjectMemory,
  importProjectMemory,
  ImportFormatError,
  listProjectMemoryEntries,
  recallProjectMemory,
  recallProjectMemoryAsOf,
  RetentionWindowError,
  writeMemoryEntryDetailed,
  type MemoryKind,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { hasScope, type ApiKeyScope } from '../api-keys.js';
import { jsonResponse } from '../http.js';
import { isUuid, metricLog, parseJsonBody } from '../util.js';
import { assertOwnsProject } from './me.js';

const ALLOWED_KINDS = new Set<MemoryKind>([
  'decision',
  'preference',
  'convention',
  'summary',
  'capture',
  'qa',
]);

/** Free-form, but bounded — this lands in an indexed column and in metrics. */
const SURFACE_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

/**
 * Cosine distance → a 0–1 similarity score.
 *
 * The raw `<=>` distance is deliberately not exposed. It is an index
 * implementation detail, and migrations 028/029 already had to change the
 * opclass once — publishing the distance would make that a breaking API change
 * next time. `<=>` yields 0–2 for cosine, so `1 - d/2` maps exact match to 1
 * and opposite to 0.
 *
 * `undefined` distance only occurs on the exact-scan fallback for a row with no
 * embedding; recall already filters those out, so this returns null rather than
 * inventing a score.
 */
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
  // assertOwnsProject returns 404 rather than 403 for a project owned by someone
  // else, so a caller cannot probe for the existence of other tenants' projects.
  if (!owned.ok) return owned;
  return { ok: true, projectId };
}

/**
 * POST /v1/memory/entries
 * Body: { projectId, text, kind?, surface? }
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

  const db = createDbClient();
  try {
    const { id, supersededId } = await writeMemoryEntryDetailed({
      db,
      projectId: project.projectId,
      sourceSurface: surface,
      kind,
      text,
    });
    metricLog('sdk.memory.remember', { superseded: supersededId !== null, surface });
    // supersededId is returned, always. A caller that retires someone's earlier
    // note should be able to say so — see the plan's §4.5 on why this is a trust
    // feature rather than an implementation detail.
    return jsonResponse(200, {
      id,
      supersededId,
      projectId: project.projectId,
      kind,
      surface,
    });
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
    return jsonResponse(200, {
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
    });
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
    const entries = await listProjectMemoryEntries({
      db,
      projectId: project.projectId,
      limit,
      sourceSurfaces: surfaces,
    });
    return jsonResponse(200, {
      projectId: project.projectId,
      entries: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        text: e.text,
        surface: e.sourceSurface,
        createdAt: e.createdAt,
      })),
    });
  } finally {
    await db.close();
  }
}

/**
 * GET /v1/memory/export?projectId=&embeddings=false&superseded=false
 *
 * Reading everything you wrote is a read, so `memory:read` is the right scope.
 * Gating export behind a stronger scope than recall would be theatre — a caller
 * who can recall can already reconstruct the corpus one query at a time.
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
    const bundle = await exportProjectMemory({
      db,
      projectId: project.projectId,
      includeEmbeddings: query.embeddings !== 'false',
      includeSuperseded: query.superseded !== 'false',
    });
    metricLog('sdk.memory.export', { entries: bundle.entryCount });
    return jsonResponse(200, bundle);
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
    const result = await importProjectMemory({
      db,
      projectId: project.projectId,
      bundle: body.bundle,
      preserveSupersedes: body.preserveSupersedes,
    });
    metricLog('sdk.memory.import', {
      imported: result.imported,
      reEmbedded: result.reEmbedded,
    });
    return jsonResponse(200, result);
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
    return jsonResponse(200, diff);
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
