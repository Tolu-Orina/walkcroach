/**
 * Cross-project Apps hub (Phase E AP-10).
 */
import type { DbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export async function handleListMyApps(
  db: DbClient,
  auth: AuthContext,
): Promise<RestResult> {
  const { rows } = await db.query<{
    id: string;
    project_id: string;
    project_name: string;
    target: string;
    url: string | null;
    status: string;
    build_id: string | null;
    error_message: string | null;
    deployed_at: Date;
  }>(
    `SELECT d.id, d.project_id, p.name AS project_name, d.target, d.url, d.status,
            d.build_id, d.error_message, d.deployed_at
     FROM deployments d
     INNER JOIN projects p ON p.id = d.project_id
     WHERE p.owner_id = $1 AND p.deleted_at IS NULL
     ORDER BY d.deployed_at DESC
     LIMIT 100`,
    [auth.ownerId],
  );

  return jsonResponse(200, {
    apps: rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      target: row.target,
      url: row.url,
      status: row.status,
      buildId: row.build_id,
      errorMessage: row.error_message,
      deployedAt: row.deployed_at.toISOString(),
    })),
  });
}
