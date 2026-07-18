import {
  listProjectMemoryEntries,
  recallProjectMemory,
  updateMemoryEntryText,
  writeMemoryEntry,
  type MemoryKind,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
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

/**
 * POST /ide/v1/memory/mirror
 * Body: { projectId, text, kind? }
 */
export async function handleMemoryMirror(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    projectId?: string;
    text?: string;
    kind?: string;
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

  const db = createDbClient();
  try {
    const id = await writeMemoryEntry({
      db,
      projectId: project.projectId,
      sourceSurface: 'ide',
      kind: kindRaw,
      text,
    });
    metricLog('ide.memory.mirror', { ok: true });
    return jsonResponse(200, {
      ok: true,
      id,
      projectId: project.projectId,
      sourceSurface: 'ide',
      kind: kindRaw,
    });
  } finally {
    await db.close();
  }
}

/**
 * POST /ide/v1/memory/recall
 * Body: { projectId, query, limit?, sourceSurfaces? }
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
    const hits = await recallProjectMemory({
      db,
      projectId: project.projectId,
      query,
      limit,
      sourceSurfaces: surfaces,
    });
    metricLog('ide.memory.recall', { count: hits.length });
    return jsonResponse(200, {
      projectId: project.projectId,
      hits: hits.map((h) => ({
        id: h.id,
        kind: h.kind,
        text: h.text,
        distance: h.distance,
        sourceSurface: h.sourceSurface,
      })),
    });
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
