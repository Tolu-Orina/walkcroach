import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { parseJsonBody } from '../util.js';
import { deleteMirroredMemoriesForCaptures } from './link.js';

type WorkspaceRow = {
  id: string;
  name: string;
  linked_project_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function handleListWorkspaces(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  const db = createDbClient();
  try {
    const { rows } = await db.query<WorkspaceRow>(
      `SELECT id, name, linked_project_id, created_at, updated_at
       FROM workspaces
       WHERE owner_id = $1
       ORDER BY updated_at DESC`,
      [auth.ownerId],
    );
    return jsonResponse(200, { workspaces: rows });
  } finally {
    await db.close();
  }
}

export async function handleCreateWorkspace(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const body = parseJsonBody<{ name?: string }>(rawBody);
  if ('error' in body && body.error === 'invalid JSON body') {
    return jsonResponse(400, { error: body.error });
  }
  const name = (body as { name?: string }).name?.trim();
  if (!name) return jsonResponse(400, { error: 'name required' });

  const db = createDbClient();
  try {
    const { rows } = await db.query<WorkspaceRow>(
      `INSERT INTO workspaces (owner_id, name)
       VALUES ($1, $2)
       RETURNING id, name, linked_project_id, created_at, updated_at`,
      [auth.ownerId, name],
    );
    return jsonResponse(201, { workspace: rows[0] });
  } finally {
    await db.close();
  }
}

export async function handlePatchWorkspace(
  auth: AuthContext,
  id: string,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const body = parseJsonBody<{ name?: string }>(rawBody);
  if ('error' in body && body.error === 'invalid JSON body') {
    return jsonResponse(400, { error: body.error });
  }
  const name = (body as { name?: string }).name?.trim();
  if (!name) return jsonResponse(400, { error: 'name required' });

  const db = createDbClient();
  try {
    const { rows } = await db.query<WorkspaceRow>(
      `UPDATE workspaces
       SET name = $3, updated_at = now()
       WHERE id = $1::uuid AND owner_id = $2
       RETURNING id, name, linked_project_id, created_at, updated_at`,
      [id, auth.ownerId, name],
    );
    if (!rows[0]) return jsonResponse(404, { error: 'workspace not found' });
    return jsonResponse(200, { workspace: rows[0] });
  } finally {
    await db.close();
  }
}

export async function handleDeleteWorkspace(
  auth: AuthContext,
  id: string,
): Promise<ReturnType<typeof jsonResponse>> {
  const db = createDbClient();
  try {
    const owned = await db.query(
      `SELECT 1 FROM workspaces WHERE id = $1::uuid AND owner_id = $2`,
      [id, auth.ownerId],
    );
    if (!owned.rows[0]) return jsonResponse(404, { error: 'workspace not found' });

    const caps = await db.query<{ id: string }>(
      `SELECT id FROM page_captures WHERE workspace_id = $1::uuid`,
      [id],
    );
    await deleteMirroredMemoriesForCaptures(
      db,
      caps.rows.map((r) => r.id),
    );
    await db.query(`DELETE FROM page_captures WHERE workspace_id = $1::uuid`, [
      id,
    ]);
    await db.query(
      `DELETE FROM workspaces WHERE id = $1::uuid AND owner_id = $2`,
      [id, auth.ownerId],
    );
    return jsonResponse(200, { ok: true });
  } finally {
    await db.close();
  }
}
