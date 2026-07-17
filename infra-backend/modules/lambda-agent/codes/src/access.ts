import { createDbClient } from '@walkcroach/db';
import { getSession } from '@walkcroach/agent-harness';
import { requireAuth, type AuthContext } from './auth.js';

export async function assertSessionAccess(
  sessionId: string,
  projectId: string,
  headers: Record<string, string | undefined>,
): Promise<{ ok: true; auth: AuthContext } | { ok: false; status: number; error: string }> {
  const authResult = await requireAuth(headers);
  if ('error' in authResult) {
    return { ok: false, status: authResult.status, error: authResult.error };
  }

  const db = createDbClient();
  try {
    const session = await getSession(db, sessionId);
    if (!session || session.project_id !== projectId) {
      return { ok: false, status: 404, error: 'session not found' };
    }

    const { rows } = await db.query<{ owner_id: string }>(
      `SELECT owner_id FROM projects
       WHERE id = $1::uuid AND deleted_at IS NULL`,
      [session.project_id],
    );
    const project = rows[0];
    if (!project || project.owner_id !== authResult.ownerId) {
      return { ok: false, status: 404, error: 'session not found' };
    }

    return { ok: true, auth: authResult };
  } finally {
    await db.close();
  }
}
