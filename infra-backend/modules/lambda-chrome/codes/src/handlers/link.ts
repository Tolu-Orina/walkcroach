import {
  formatVector,
  type MemoryKind,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

type Db = ReturnType<typeof createDbClient>;

/** List Web projects owned by the signed-in Cognito user (PC.1). */
export async function handleListMyProjects(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(200, {
      projects: [],
      hint: 'Sign in with WalkCroach (Cognito) to link a Web project',
    });
  }

  const db = createDbClient();
  try {
    const { rows } = await db.query<ProjectSummary>(
      `SELECT id, name, status, updated_at
       FROM projects
       WHERE owner_id = $1
         AND deleted_at IS NULL
         AND archived_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 100`,
      [auth.ownerId],
    );
    return jsonResponse(200, { projects: rows });
  } finally {
    await db.close();
  }
}

/**
 * Link a Chrome workspace to a Web project (PC.2).
 * Backfills existing captures into memory_entries (PC.3).
 */
export async function handleLinkWorkspace(
  auth: AuthContext,
  workspaceId: string,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  if (auth.isAnonymous || auth.source === 'device') {
    return jsonResponse(401, {
      error: 'Cognito sign-in required to link a Web project',
    });
  }

  const body = parseJsonBody<{ projectId?: string | null }>(rawBody);
  if ('error' in body && body.error === 'invalid JSON body') {
    return jsonResponse(400, { error: body.error });
  }
  const projectId = (body as { projectId?: string | null }).projectId;

  const db = createDbClient();
  try {
    const ws = await db.query<{ id: string; linked_project_id: string | null }>(
      `SELECT id, linked_project_id FROM workspaces
       WHERE id = $1::uuid AND owner_id = $2`,
      [workspaceId, auth.ownerId],
    );
    if (!ws.rows[0]) {
      return jsonResponse(404, { error: 'workspace not found' });
    }

    // Unlink
    if (projectId === null || projectId === undefined || projectId === '') {
      const caps = await db.query<{ id: string }>(
        `SELECT id FROM page_captures WHERE workspace_id = $1::uuid`,
        [workspaceId],
      );
      const prevProjectId = ws.rows[0]!.linked_project_id;
      if (prevProjectId) {
        for (const cap of caps.rows) {
          await deleteMirroredCaptureMemory(db, cap.id, prevProjectId);
        }
      }
      await db.query(
        `UPDATE workspaces
         SET linked_project_id = NULL, updated_at = now()
         WHERE id = $1::uuid AND owner_id = $2`,
        [workspaceId, auth.ownerId],
      );
      await db.query(
        `UPDATE page_captures SET project_id = NULL
         WHERE workspace_id = $1::uuid AND owner_id = $2`,
        [workspaceId, auth.ownerId],
      );
      metricLog('chrome.workspace.unlink', { ok: true });
      return jsonResponse(200, { ok: true, linkedProjectId: null });
    }

    const linkProjectId = projectId;

    const proj = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM projects
       WHERE id = $1::uuid
         AND owner_id = $2
         AND deleted_at IS NULL`,
      [linkProjectId, auth.ownerId],
    );
    if (!proj.rows[0]) {
      return jsonResponse(404, { error: 'project not found or not owned' });
    }

    await db.query(
      `UPDATE workspaces
       SET linked_project_id = $3::uuid, updated_at = now()
       WHERE id = $1::uuid AND owner_id = $2`,
      [workspaceId, auth.ownerId, linkProjectId],
    );
    await db.query(
      `UPDATE page_captures
       SET project_id = $3::uuid
       WHERE workspace_id = $1::uuid AND owner_id = $2`,
      [workspaceId, auth.ownerId, linkProjectId],
    );

    const backfilled = await backfillWorkspaceCapturesToMemory(
      db,
      workspaceId,
      linkProjectId,
    );

    metricLog('chrome.workspace.link_project', {
      backfilled,
    });

    return jsonResponse(200, {
      ok: true,
      linkedProjectId: linkProjectId,
      projectName: proj.rows[0].name,
      backfilled,
      message: `Also available in your WalkCroach project “${proj.rows[0].name}”.`,
    });
  } finally {
    await db.close();
  }
}

function captureMemoryText(params: {
  captureId: string;
  url: string;
  title: string | null;
  extractedText: string;
  captureType?: string;
}): string {
  const marker = `[chrome-capture:${params.captureId}]`;
  return [
    marker,
    params.title || 'Untitled',
    params.url,
    params.captureType ? `type: ${params.captureType}` : '',
    params.extractedText,
  ]
    .filter(Boolean)
    .join('\n');
}

function toVec(embedding: number[] | string): string {
  return typeof embedding === 'string' ? embedding : formatVector(embedding);
}

export async function mirrorCaptureToProjectMemory(params: {
  db: Db;
  projectId: string;
  captureId: string;
  url: string;
  title: string | null;
  extractedText: string;
  embedding: number[] | string;
  captureType?: string;
}): Promise<string | null> {
  const marker = `[chrome-capture:${params.captureId}]`;
  const existing = await params.db.query(
    `SELECT 1 FROM memory_entries
     WHERE project_id = $1::uuid
       AND text LIKE $2
       AND superseded_by IS NULL
     LIMIT 1`,
    [params.projectId, `${marker}%`],
  );
  if (existing.rows[0]) return null;

  const kind: MemoryKind = 'capture';
  const text = captureMemoryText(params);
  const vec = toVec(params.embedding);

  const { rows } = await params.db.query<{ id: string }>(
    `INSERT INTO memory_entries (project_id, source_surface, kind, text, embedding)
     VALUES ($1::uuid, 'chrome', $2, $3, $4::vector)
     RETURNING id`,
    [params.projectId, kind, text, vec],
  );
  return rows[0]?.id ?? null;
}

/** Refresh mirrored memory after a price-track append / capture edit. */
export async function updateMirroredCaptureMemory(params: {
  db: Db;
  projectId: string;
  captureId: string;
  url: string;
  title: string | null;
  extractedText: string;
  embedding: number[] | string;
  captureType?: string;
}): Promise<void> {
  const marker = `[chrome-capture:${params.captureId}]`;
  const text = captureMemoryText(params);
  const vec = toVec(params.embedding);
  const updated = await params.db.query(
    `UPDATE memory_entries
     SET text = $3, embedding = $4::vector
     WHERE project_id = $1::uuid
       AND text LIKE $2
       AND superseded_by IS NULL`,
    [params.projectId, `${marker}%`, text, vec],
  );
  if (!updated.rowCount) {
    await mirrorCaptureToProjectMemory(params);
  }
}

async function backfillWorkspaceCapturesToMemory(
  db: Db,
  workspaceId: string,
  projectId: string,
): Promise<number> {
  const { rows } = await db.query<{
    id: string;
    url: string;
    title: string | null;
    extracted_text: string | null;
    embedding: string | null;
    capture_type: string;
  }>(
    `SELECT id, url, title, extracted_text, embedding::text AS embedding, capture_type
     FROM page_captures
     WHERE workspace_id = $1::uuid
       AND superseded_by IS NULL
       AND embedding IS NOT NULL
     ORDER BY captured_at ASC
     LIMIT 200`,
    [workspaceId],
  );

  let count = 0;
  for (const row of rows) {
    if (!row.embedding || !row.extracted_text) continue;
    const id = await mirrorCaptureToProjectMemory({
      db,
      projectId,
      captureId: row.id,
      url: row.url,
      title: row.title,
      extractedText: row.extracted_text,
      embedding: row.embedding,
      captureType: row.capture_type,
    });
    if (id) count += 1;
  }
  return count;
}

/** Resolve linked project for a workspace owned by auth. */
export async function getLinkedProjectId(
  db: Db,
  workspaceId: string,
  ownerId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ linked_project_id: string | null }>(
    `SELECT linked_project_id FROM workspaces
     WHERE id = $1::uuid AND owner_id = $2`,
    [workspaceId, ownerId],
  );
  return rows[0]?.linked_project_id ?? null;
}

export async function deleteMirroredCaptureMemory(
  db: Db,
  captureId: string,
  projectId?: string | null,
): Promise<void> {
  const marker = `[chrome-capture:${captureId}]%`;
  if (projectId) {
    await db.query(
      `DELETE FROM memory_entries
       WHERE project_id = $1::uuid AND text LIKE $2`,
      [projectId, marker],
    );
    return;
  }
  await db.query(`DELETE FROM memory_entries WHERE text LIKE $1`, [marker]);
}

export async function deleteMirroredMemoriesForCaptures(
  db: Db,
  captureIds: string[],
): Promise<void> {
  for (const id of captureIds) {
    await deleteMirroredCaptureMemory(db, id);
  }
}
