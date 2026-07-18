import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { isUuid } from '../util.js';

type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

type LinkRow = {
  id: string;
  project_id: string;
  local_repo_key: string;
  local_repo_display: string | null;
  created_at: string;
  updated_at: string;
  project_name: string | null;
};

/** GET /ide/v1/me — identity + optional link for a local_repo_key query. */
export async function handleMe(
  auth: AuthContext,
  query: Record<string, string | undefined>,
): Promise<ReturnType<typeof jsonResponse>> {
  const localRepoKey = query.local_repo_key?.trim();
  const db = createDbClient();
  try {
    let link: LinkRow | null = null;
    if (localRepoKey) {
      const { rows } = await db.query<LinkRow>(
        `SELECT l.id, l.project_id, l.local_repo_key, l.local_repo_display,
                l.created_at, l.updated_at, p.name AS project_name
         FROM ide_project_links l
         LEFT JOIN projects p ON p.id = l.project_id
         WHERE l.owner_id = $1 AND l.local_repo_key = $2
         LIMIT 1`,
        [auth.ownerId, localRepoKey],
      );
      link = rows[0] ?? null;
    }

    const count = await db.query<{ n: string }>(
      `SELECT count(*)::INT::STRING AS n FROM ide_project_links WHERE owner_id = $1`,
      [auth.ownerId],
    );

    return jsonResponse(200, {
      ownerId: auth.ownerId,
      authSource: auth.source,
      linkCount: Number(count.rows[0]?.n ?? 0),
      link: link
        ? {
            id: link.id,
            projectId: link.project_id,
            projectName: link.project_name,
            localRepoKey: link.local_repo_key,
            localRepoDisplay: link.local_repo_display,
            createdAt: link.created_at,
            updatedAt: link.updated_at,
          }
        : null,
    });
  } finally {
    await db.close();
  }
}

/** GET /ide/v1/me/projects — owner-scoped Web projects. */
export async function handleListMyProjects(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
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

export async function assertOwnsProject(
  ownerId: string,
  projectId: string,
): Promise<{ ok: true; name: string } | { ok: false; status: number; error: string }> {
  if (!isUuid(projectId)) {
    return { ok: false, status: 400, error: 'invalid projectId' };
  }
  const db = createDbClient();
  try {
    const { rows } = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM projects
       WHERE id = $1::uuid
         AND owner_id = $2
         AND deleted_at IS NULL`,
      [projectId, ownerId],
    );
    if (!rows[0]) {
      return { ok: false, status: 404, error: 'project not found or not owned' };
    }
    return { ok: true, name: rows[0].name };
  } finally {
    await db.close();
  }
}
