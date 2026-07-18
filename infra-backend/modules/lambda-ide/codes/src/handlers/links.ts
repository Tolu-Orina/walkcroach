import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { normalizeLocalRepoKey } from '../repo-key.js';
import { isUuid, metricLog, parseJsonBody } from '../util.js';
import { assertOwnsProject } from './me.js';

type LinkRow = {
  id: string;
  project_id: string;
  local_repo_key: string;
  local_repo_display: string | null;
  created_at: string;
  updated_at: string;
  project_name: string | null;
};

function mapLink(row: LinkRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    localRepoKey: row.local_repo_key,
    localRepoDisplay: row.local_repo_display,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /ide/v1/links */
export async function handleListLinks(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  const db = createDbClient();
  try {
    const { rows } = await db.query<LinkRow>(
      `SELECT l.id, l.project_id, l.local_repo_key, l.local_repo_display,
              l.created_at, l.updated_at, p.name AS project_name
       FROM ide_project_links l
       LEFT JOIN projects p ON p.id = l.project_id
       WHERE l.owner_id = $1
       ORDER BY l.updated_at DESC
       LIMIT 100`,
      [auth.ownerId],
    );
    return jsonResponse(200, { links: rows.map(mapLink) });
  } finally {
    await db.close();
  }
}

/**
 * POST /ide/v1/links
 * Body: { projectId, gitRemoteUrl?, workspacePath?, localRepoDisplay? }
 */
export async function handleCreateLink(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{
    projectId?: string;
    gitRemoteUrl?: string;
    workspacePath?: string;
    localRepoDisplay?: string;
  }>(rawBody);
  if (!parsed.ok) {
    return jsonResponse(400, { error: parsed.error });
  }
  const body = parsed.data;

  const projectId = body.projectId?.trim();
  if (!projectId || !isUuid(projectId)) {
    return jsonResponse(400, { error: 'projectId (uuid) is required' });
  }

  const owned = await assertOwnsProject(auth.ownerId, projectId);
  if (!owned.ok) {
    return jsonResponse(owned.status, { error: owned.error });
  }

  let localRepoKey: string;
  try {
    // Always derive from git remote / workspace path — never trust client localRepoKey.
    localRepoKey = normalizeLocalRepoKey({
      gitRemoteUrl: body.gitRemoteUrl,
      workspacePath: body.workspacePath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(400, { error: message });
  }

  const display =
    body.localRepoDisplay?.trim() ||
    (body.gitRemoteUrl
      ? normalizeLocalRepoKey({ gitRemoteUrl: body.gitRemoteUrl }).replace(
          /^git:/,
          '',
        )
      : undefined) ||
    body.workspacePath?.trim() ||
    localRepoKey;

  const db = createDbClient();
  try {
    const { rows } = await db.query<LinkRow>(
      `INSERT INTO ide_project_links (
         owner_id, project_id, local_repo_key, local_repo_display, updated_at
       ) VALUES ($1, $2::uuid, $3, $4, now())
       ON CONFLICT (owner_id, local_repo_key) DO UPDATE SET
         project_id = EXCLUDED.project_id,
         local_repo_display = EXCLUDED.local_repo_display,
         updated_at = now()
       RETURNING id, project_id, local_repo_key, local_repo_display,
                 created_at, updated_at`,
      [auth.ownerId, projectId, localRepoKey, display],
    );
    const row = rows[0]!;
    metricLog('ide.link.create', { ok: true });
    return jsonResponse(200, {
      ok: true,
      link: {
        ...mapLink({ ...row, project_name: owned.name }),
        projectName: owned.name,
      },
      message: `Linked to WalkCroach project “${owned.name}”.`,
    });
  } finally {
    await db.close();
  }
}

/** DELETE /ide/v1/links/:id */
export async function handleDeleteLink(
  auth: AuthContext,
  linkId: string,
): Promise<ReturnType<typeof jsonResponse>> {
  if (!isUuid(linkId)) {
    return jsonResponse(400, { error: 'invalid link id' });
  }
  const db = createDbClient();
  try {
    const result = await db.query(
      `DELETE FROM ide_project_links
       WHERE id = $1::uuid AND owner_id = $2`,
      [linkId, auth.ownerId],
    );
    if (!result.rowCount) {
      return jsonResponse(404, { error: 'link not found' });
    }
    metricLog('ide.link.delete', { ok: true });
    return jsonResponse(200, { ok: true });
  } finally {
    await db.close();
  }
}
