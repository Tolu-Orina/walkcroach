import {
  listProjectMemoryEntries,
  recallProjectMemory,
  recallProjectMemoryAsOf,
  diffProjectMemory,
  updateMemoryEntryText,
  writeMemoryEntryDetailed,
  RetentionWindowError,
  MEMORY_KINDS,
  type MemoryKind,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { isUuid, metricLog, parseJsonBody } from '../util.js';
import { assertOwnsProject } from './me.js';

/** Single source: `@walkcroach/memory-contracts` via harness re-export (P1). */
const ALLOWED_KINDS = new Set<MemoryKind>(MEMORY_KINDS);

async function resolveLinkedProject(
  auth: AuthContext,
  projectId: string | undefined,
): Promise<
  | { ok: true; projectId: string; name: string }
  | { ok: false; status: number; error: string }
> {
  if (!projectId || !isUuid(projectId)) {
    return { ok: false, status: 400, error: 'projectId (uuid) is required' };
  }
  const owned = await assertOwnsProject(auth.ownerId, projectId);
  if (!owned.ok) return owned;
  return { ok: true, projectId, name: owned.name };
}

/** Surfaces allowed to write via /ide memory mirror (extension + Desktop). */
const MIRROR_SURFACES = new Set(['ide', 'desktop']);

/**
 * POST /ide/v1/memory/mirror
 * Body: { projectId, text, kind?, sourceSurface?: 'ide' | 'desktop' }
 * Default sourceSurface remains `ide` for extension clients; Desktop sends `desktop`.
 */
export async function handleMemoryMirror(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    projectId?: string;
    text?: string;
    kind?: string;
    sourceSurface?: string;
  }>(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;

  const project = await resolveLinkedProject(auth, body.projectId);
  if (!project.ok) {
    return jsonResponse(project.status, { error: project.error });
  }

  const text = body.text?.trim();
  if (!text) {
    return jsonResponse(400, { error: 'text is required' });
  }
  if (text.length > 20_000) {
    return jsonResponse(400, { error: 'text exceeds 20000 characters' });
  }

  const kindRaw = (body.kind ?? 'decision').toLowerCase() as MemoryKind;
  if (!ALLOWED_KINDS.has(kindRaw)) {
    return jsonResponse(400, {
      error: `kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`,
    });
  }

  const surfaceRaw = (body.sourceSurface ?? 'ide').toLowerCase();
  if (!MIRROR_SURFACES.has(surfaceRaw)) {
    return jsonResponse(400, {
      error: `sourceSurface must be one of: ${[...MIRROR_SURFACES].join(', ')}`,
    });
  }

  const db = createDbClient();
  try {
    const { id, supersededId } = await writeMemoryEntryDetailed({
      db,
      projectId: project.projectId,
      sourceSurface: surfaceRaw,
      kind: kindRaw,
      text,
      actorOwnerId: auth.ownerId,
      actorKeyId: auth.keyId ?? null,
    });
    metricLog('ide.memory.mirror', { ok: true, sourceSurface: surfaceRaw });
    return jsonResponse(200, {
      ok: true,
      id,
      supersededId,
      projectId: project.projectId,
      sourceSurface: surfaceRaw,
      kind: kindRaw,
    });
  } finally {
    await db.close();
  }
}

/**
 * POST /ide/v1/memory/recall
 * Body: { projectId, query, limit?, sourceSurfaces?, asOf? }
 * `asOf` is an ISO timestamp — same harness as SDK `wc.memory.asOf`.
 */
export async function handleMemoryRecall(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    projectId?: string;
    query?: string;
    limit?: number;
    sourceSurfaces?: string[];
    asOf?: string;
  }>(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;

  const project = await resolveLinkedProject(auth, body.projectId);
  if (!project.ok) {
    return jsonResponse(project.status, { error: project.error });
  }

  const query = body.query?.trim();
  if (!query) {
    return jsonResponse(400, { error: 'query is required' });
  }

  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 20);
  const surfaces = Array.isArray(body.sourceSurfaces)
    ? body.sourceSurfaces.map((s) => String(s).toLowerCase()).filter(Boolean)
    : undefined;

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
    metricLog('ide.memory.recall', { count: hits.length, asOf: Boolean(body.asOf) });
    return jsonResponse(200, {
      projectId: project.projectId,
      asOf: body.asOf ?? null,
      hits: hits.map((h) => ({
        id: h.id,
        kind: h.kind,
        text: h.text,
        distance: h.distance,
        sourceSurface: h.sourceSurface,
        createdAt: h.createdAt,
      })),
    });
  } catch (err) {
    if (err instanceof RetentionWindowError) {
      return jsonResponse(400, { error: err.message, code: err.code });
    }
    throw err;
  } finally {
    await db.close();
  }
}

/**
 * POST /ide/v1/memory/diff
 * Body: { projectId, from, to? } — same contract as SDK `wc.memory.diff`.
 */
export async function handleMemoryDiff(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{ projectId?: string; from?: string; to?: string }>(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;

  const project = await resolveLinkedProject(auth, body.projectId);
  if (!project.ok) {
    return jsonResponse(project.status, { error: project.error });
  }
  if (!body.from) {
    return jsonResponse(400, { error: 'from (ISO timestamp) is required' });
  }

  const db = createDbClient();
  try {
    const diff = await diffProjectMemory({
      db,
      projectId: project.projectId,
      from: body.from,
      to: body.to ?? 'now',
    });
    metricLog('ide.memory.diff', {
      added: diff.added.length,
      retired: diff.retired.length,
    });
    return jsonResponse(200, {
      projectId: project.projectId,
      from: diff.from,
      to: diff.to,
      unchanged: diff.unchanged,
      added: diff.added.map((e) => ({
        id: e.id,
        kind: e.kind,
        text: e.text,
        sourceSurface: e.sourceSurface,
      })),
      retired: diff.retired.map((e) => ({
        id: e.id,
        kind: e.kind,
        text: e.text,
        sourceSurface: e.sourceSurface,
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

/** GET /ide/v1/memory/entries?projectId=&sourceSurface=ide&limit= */
export async function handleListMemoryEntries(
  auth: AuthContext,
  query: Record<string, string | undefined>,
): Promise<ReturnType<typeof jsonResponse>> {
  const project = await resolveLinkedProject(auth, query.projectId);
  if (!project.ok) {
    return jsonResponse(project.status, { error: project.error });
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
  const surfaces = query.sourceSurface
    ? [query.sourceSurface.toLowerCase()]
    : query.sourceSurfaces
      ? query.sourceSurfaces.split(',').map((s) => s.trim().toLowerCase())
      : undefined;

  const db = createDbClient();
  try {
    const entries = await listProjectMemoryEntries({
      db,
      projectId: project.projectId,
      limit,
      sourceSurfaces: surfaces,
    });
    return jsonResponse(200, { projectId: project.projectId, entries });
  } finally {
    await db.close();
  }
}

/**
 * PATCH /ide/v1/memory/entries/:id
 * Body: { projectId, text }
 *
 * @deprecated Dual-funnel P1 — **internal IDE-only** until 2026-10-11.
 * Not on the public OpenAPI `/v1` contract. First-party list UX uses `/v1`;
 * prefer remember/supersede for edits. See `docs/memory-contract-p1.md`.
 */
export async function handleUpdateMemoryEntry(
  auth: AuthContext,
  entryId: string,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  if (!isUuid(entryId)) {
    return jsonResponse(400, { error: 'invalid entry id' });
  }
  const parsed = parseJsonBody<{ projectId?: string; text?: string }>(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;

  const project = await resolveLinkedProject(auth, body.projectId);
  if (!project.ok) {
    return jsonResponse(project.status, { error: project.error });
  }

  const text = body.text?.trim();
  if (!text) {
    return jsonResponse(400, { error: 'text is required' });
  }

  const db = createDbClient();
  try {
    const ok = await updateMemoryEntryText({
      db,
      entryId,
      projectId: project.projectId,
      text,
      sourceSurface: 'ide',
    });
    if (!ok) {
      return jsonResponse(404, {
        error:
          'memory entry not found (or not an IDE-sourced entry — only source_surface=ide may be patched)',
      });
    }
    metricLog('ide.memory.update', { ok: true });
    return jsonResponse(200, { ok: true, id: entryId });
  } finally {
    await db.close();
  }
}
