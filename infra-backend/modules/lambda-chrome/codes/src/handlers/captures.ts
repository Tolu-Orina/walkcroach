import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { embedText, formatVector } from './llm.js';
import { metricLog, parseJsonBody, truncateExtract } from '../util.js';
import {
  getLinkedProjectId,
  mirrorCaptureToProjectMemory,
  updateMirroredCaptureMemory,
  deleteMirroredCaptureMemory,
} from './link.js';

type CaptureRow = {
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

async function assertWorkspaceOwner(
  db: ReturnType<typeof createDbClient>,
  workspaceId: string,
  ownerId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM workspaces WHERE id = $1::uuid AND owner_id = $2`,
    [workspaceId, ownerId],
  );
  return Boolean(rows[0]);
}

export async function handleListCaptures(
  auth: AuthContext,
  workspaceId: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  if (!workspaceId) {
    return jsonResponse(400, { error: 'workspaceId query required' });
  }
  const db = createDbClient();
  try {
    if (!(await assertWorkspaceOwner(db, workspaceId, auth.ownerId))) {
      return jsonResponse(404, { error: 'workspace not found' });
    }
    const { rows } = await db.query<CaptureRow>(
      `SELECT id, workspace_id, url, title, extracted_text, capture_type,
              structured_fields, content_hash, captured_at
       FROM page_captures
       WHERE workspace_id = $1::uuid
         AND owner_id = $2
         AND superseded_by IS NULL
       ORDER BY captured_at DESC
       LIMIT 50`,
      [workspaceId, auth.ownerId],
    );
    return jsonResponse(200, { captures: rows });
  } finally {
    await db.close();
  }
}

export async function handleCreateCapture(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const body = parseJsonBody<{
    workspaceId?: string;
    url?: string;
    title?: string;
    extractedText?: string;
    contentHash?: string;
    captureType?: string;
    structuredFields?: Record<string, unknown>;
  }>(rawBody);
  if ('error' in body && body.error === 'invalid JSON body') {
    return jsonResponse(400, { error: body.error });
  }
  const b = body as {
    workspaceId?: string;
    url?: string;
    title?: string;
    extractedText?: string;
    contentHash?: string;
    captureType?: string;
    structuredFields?: Record<string, unknown>;
  };
  if (!b.workspaceId) return jsonResponse(400, { error: 'workspaceId required' });
  if (!b.url?.trim()) return jsonResponse(400, { error: 'url required' });
  const extracted = truncateExtract(b.extractedText ?? '');
  if (extracted.length < 10) {
    return jsonResponse(400, { error: 'extractedText too short' });
  }

  const db = createDbClient();
  try {
    if (!(await assertWorkspaceOwner(db, b.workspaceId, auth.ownerId))) {
      return jsonResponse(404, { error: 'workspace not found' });
    }

    const linkedProjectId = await getLinkedProjectId(
      db,
      b.workspaceId,
      auth.ownerId,
    );

    const embedding = await embedText(
      `${b.title ?? ''}\n${extracted}`.slice(0, 8000),
    );
    const vec = formatVector(embedding);
    const captureType = b.captureType?.trim() || 'general';
    const fields = JSON.stringify(b.structuredFields ?? {});

    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO page_captures (
         workspace_id, owner_id, project_id, url, title, extracted_text,
         embedding, capture_type, structured_fields, content_hash
       ) VALUES (
         $1::uuid, $2, $3::uuid, $4, $5, $6, $7::vector, $8, $9::jsonb, $10
       )
       RETURNING id`,
      [
        b.workspaceId,
        auth.ownerId,
        linkedProjectId,
        b.url.trim(),
        b.title?.trim() || null,
        extracted,
        vec,
        captureType,
        fields,
        b.contentHash ?? null,
      ],
    );

    await db.query(
      `UPDATE workspaces SET updated_at = now() WHERE id = $1::uuid`,
      [b.workspaceId],
    );

    if (linkedProjectId) {
      await mirrorCaptureToProjectMemory({
        db,
        projectId: linkedProjectId,
        captureId: rows[0]!.id,
        url: b.url.trim(),
        title: b.title?.trim() || null,
        extractedText: extracted,
        embedding: vec,
        captureType,
      });
    }

    metricLog('chrome.capture.save', {
      captureType,
      chars: extracted.length,
      linked: Boolean(linkedProjectId),
    });

    return jsonResponse(201, {
      captureId: rows[0]!.id,
      linkedProjectId,
      availableInWebProject: Boolean(linkedProjectId),
    });
  } finally {
    await db.close();
  }
}

export async function handlePatchCapture(
  auth: AuthContext,
  id: string,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const body = parseJsonBody<{
    title?: string;
    extractedText?: string;
    structuredFields?: Record<string, unknown>;
  }>(rawBody);
  if ('error' in body && body.error === 'invalid JSON body') {
    return jsonResponse(400, { error: body.error });
  }
  const b = body as {
    title?: string;
    extractedText?: string;
    structuredFields?: Record<string, unknown>;
  };

  const db = createDbClient();
  try {
    const existing = await db.query<{
      id: string;
      project_id: string | null;
      url: string;
      title: string | null;
      extracted_text: string | null;
      embedding: string | null;
      capture_type: string;
      workspace_id: string | null;
    }>(
      `SELECT id, project_id, url, title, extracted_text,
              embedding::text AS embedding, capture_type, workspace_id
       FROM page_captures
       WHERE id = $1::uuid AND owner_id = $2 AND superseded_by IS NULL`,
      [id, auth.ownerId],
    );
    if (!existing.rows[0]) return jsonResponse(404, { error: 'capture not found' });
    const row = existing.rows[0];

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 3;
    let nextTitle = row.title;
    let nextText = row.extracted_text;
    let nextEmbedding = row.embedding;
    if (b.title !== undefined) {
      sets.push(`title = $${i++}`);
      vals.push(b.title);
      nextTitle = b.title;
    }
    if (b.extractedText !== undefined) {
      const extracted = truncateExtract(b.extractedText);
      sets.push(`extracted_text = $${i++}`);
      vals.push(extracted);
      nextText = extracted;
      const embedding = await embedText(extracted.slice(0, 8000));
      const vec = formatVector(embedding);
      sets.push(`embedding = $${i++}::vector`);
      vals.push(vec);
      nextEmbedding = vec;
    }
    if (b.structuredFields !== undefined) {
      sets.push(`structured_fields = $${i++}::jsonb`);
      vals.push(JSON.stringify(b.structuredFields));
    }
    if (!sets.length) return jsonResponse(400, { error: 'no fields to update' });

    await db.query(
      `UPDATE page_captures SET ${sets.join(', ')}
       WHERE id = $1::uuid AND owner_id = $2`,
      [id, auth.ownerId, ...vals],
    );

    let projectId = row.project_id;
    if (!projectId && row.workspace_id) {
      projectId = await getLinkedProjectId(db, row.workspace_id, auth.ownerId);
    }
    if (projectId && nextText && nextEmbedding) {
      await updateMirroredCaptureMemory({
        db,
        projectId,
        captureId: row.id,
        url: row.url,
        title: nextTitle,
        extractedText: nextText,
        embedding: nextEmbedding,
        captureType: row.capture_type,
      });
    }

    return jsonResponse(200, { ok: true });
  } finally {
    await db.close();
  }
}

export async function handleDeleteCapture(
  auth: AuthContext,
  id: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const db = createDbClient();
  try {
    const existing = await db.query<{ id: string; project_id: string | null }>(
      `SELECT id, project_id FROM page_captures
       WHERE id = $1::uuid AND owner_id = $2`,
      [id, auth.ownerId],
    );
    if (!existing.rows[0]) return jsonResponse(404, { error: 'capture not found' });
    await deleteMirroredCaptureMemory(
      db,
      existing.rows[0].id,
      existing.rows[0].project_id,
    );
    await db.query(
      `DELETE FROM page_captures
       WHERE id = $1::uuid AND owner_id = $2`,
      [id, auth.ownerId],
    );
    return jsonResponse(200, { ok: true });
  } finally {
    await db.close();
  }
}
