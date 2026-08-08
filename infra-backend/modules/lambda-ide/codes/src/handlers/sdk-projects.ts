/**
 * Public SDK project helpers — get-or-create a default project so an API key
 * alone is enough to start (no hand-copied UUID from Web).
 *
 * Routed as POST /v1/content/ensure-project (under the existing `content`
 * API Gateway proxy). A bare `/v1/projects/*` path collides with the agent
 * Cognito `/projects` resource and never reaches this Lambda.
 */
import { createDbClient } from '@walkcroach/db';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { metricLog, parseJsonBody } from '../util.js';

/** Reserved name — mirrors `__walkcroach_chat__` for the Web chat workspace. */
export const SDK_DEFAULT_PROJECT_NAME = '__walkcroach_sdk__';

export type EnsuredProject = {
  id: string;
  name: string;
  kind: string;
  surfaceOrigin: string;
  created: boolean;
};

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  // Cockroach / Postgres unique_violation
  return code === '23505';
}

/**
 * Resolve the caller's default SDK project, creating it when missing.
 * Idempotent under concurrency via partial unique index
 * `projects_sdk_default_alive_uidx` (migration 039).
 */
export async function ensureSdkDefaultProject(
  ownerId: string,
  preferredName?: string,
): Promise<EnsuredProject> {
  const name = (preferredName?.trim() || SDK_DEFAULT_PROJECT_NAME).slice(0, 120);
  const db = createDbClient();
  try {
    const existing = await db.query<{
      id: string;
      name: string;
      kind: string | null;
      surface_origin: string | null;
    }>(
      `SELECT id, name, kind, surface_origin FROM projects
       WHERE owner_id = $1 AND deleted_at IS NULL AND name = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [ownerId, name],
    );
    const row = existing.rows[0];
    if (row) {
      return {
        id: row.id,
        name: row.name,
        kind: row.kind ?? 'general',
        surfaceOrigin: row.surface_origin ?? 'sdk',
        created: false,
      };
    }

    try {
      const inserted = await db.query<{
        id: string;
        name: string;
        kind: string | null;
        surface_origin: string | null;
      }>(
        `INSERT INTO projects (owner_id, name, template_id, kind, status, surface_origin)
         VALUES ($1, $2, NULL, 'general', 'ready', 'sdk')
         RETURNING id, name, kind, surface_origin`,
        [ownerId, name],
      );
      const created = inserted.rows[0];
      if (!created) {
        throw new Error('project was not created');
      }
      metricLog('sdk.projects.ensure', { created: true });
      return {
        id: created.id,
        name: created.name,
        kind: created.kind ?? 'general',
        surfaceOrigin: created.surface_origin ?? 'sdk',
        created: true,
      };
    } catch (err) {
      if (!isUniqueViolation(err) || name !== SDK_DEFAULT_PROJECT_NAME) {
        throw err;
      }
      // Lost the insert race — re-read the winner.
      const again = await db.query<{
        id: string;
        name: string;
        kind: string | null;
        surface_origin: string | null;
      }>(
        `SELECT id, name, kind, surface_origin FROM projects
         WHERE owner_id = $1 AND deleted_at IS NULL AND name = $2
         ORDER BY created_at ASC
         LIMIT 1`,
        [ownerId, name],
      );
      const winner = again.rows[0];
      if (!winner) throw err;
      return {
        id: winner.id,
        name: winner.name,
        kind: winner.kind ?? 'general',
        surfaceOrigin: winner.surface_origin ?? 'sdk',
        created: false,
      };
    }
  } finally {
    await db.close();
  }
}

/** POST /v1/content/ensure-project — body `{ name? }`. */
export async function handleEnsureProject(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const parsed = parseJsonBody<{ name?: string }>(rawBody ?? '{}');
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });

  try {
    const project = await ensureSdkDefaultProject(auth.ownerId, parsed.data.name);
    return jsonResponse(project.created ? 201 : 200, project);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'ensure failed';
    return jsonResponse(500, { error: message });
  }
}
