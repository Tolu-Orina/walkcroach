/**
 * Append-only memory control-plane audit (Phase P1.3 / ADR-0001).
 *
 * Survives beyond the MVCC asOf window. Readers of belief use memory_entries;
 * readers of "who did what to memory" use this table.
 */
import type { DbClient } from '@walkcroach/db';

export type MemoryAuditAction =
  | 'remember'
  | 'supersede'
  | 'import'
  | 'export'
  | 'erase'
  | 'erase_export'
  | 'diff'
  | 'recall';

export async function appendMemoryAudit(params: {
  db: DbClient;
  projectId: string;
  ownerId: string;
  action: MemoryAuditAction;
  actorKeyId?: string | null;
  entryId?: string | null;
  requestId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await params.db.query(
    `INSERT INTO memory_audit
       (project_id, owner_id, actor_key_id, action, entry_id, request_id, detail)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6, $7::jsonb)`,
    [
      params.projectId,
      params.ownerId,
      params.actorKeyId ?? null,
      params.action,
      params.entryId ?? null,
      params.requestId ?? null,
      JSON.stringify(params.detail ?? {}),
    ],
  );
}

export async function listMemoryAudit(params: {
  db: DbClient;
  projectId: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    action: string;
    entryId: string | null;
    actorKeyId: string | null;
    requestId: string | null;
    detail: unknown;
    createdAt: string;
  }>
> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const { rows } = await params.db.query<{
    id: string;
    action: string;
    entry_id: string | null;
    actor_key_id: string | null;
    request_id: string | null;
    detail: unknown;
    created_at: Date;
  }>(
    `SELECT id, action, entry_id, actor_key_id, request_id, detail, created_at
       FROM memory_audit
      WHERE project_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT $2`,
    [params.projectId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entryId: r.entry_id,
    actorKeyId: r.actor_key_id,
    requestId: r.request_id,
    detail: r.detail,
    createdAt: r.created_at.toISOString(),
  }));
}
