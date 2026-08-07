/**
 * Legal erase via tombstone (Phase P1.4 / ADR-0002).
 *
 * Never silent hard DELETE. Redacts text, nulls embedding, sets erased_at.
 * Live recall continues to pin only vector-index prefix columns; erased rows are
 * filtered in application code (see memory.ts) so we do not break C-SPANN use.
 */
import type { DbClient } from '@walkcroach/db';
import { appendMemoryAudit } from './memory-audit.js';
import { exportProjectMemory, type MemoryExport } from './memory-portability.js';

export const ERASED_TEXT_PLACEHOLDER = '[erased]';

export async function eraseMemoryEntries(params: {
  db: DbClient;
  projectId: string;
  ownerId: string;
  reason: string;
  entryIds?: string[];
  actorKeyId?: string | null;
  requestId?: string | null;
  /** When true, export non-erased rows before tombstoning them. */
  exportFirst?: boolean;
}): Promise<{
  erased: number;
  entryIds: string[];
  exportBundle: MemoryExport | null;
}> {
  const reason = params.reason.trim();
  if (!reason) {
    throw new TypeError('erase reason is required');
  }
  if (reason.length > 500) {
    throw new TypeError('erase reason exceeds 500 characters');
  }

  let exportBundle: MemoryExport | null = null;
  if (params.exportFirst) {
    exportBundle = await exportProjectMemory({
      db: params.db,
      projectId: params.projectId,
      includeEmbeddings: true,
      includeSuperseded: true,
      includeErased: false,
    });
    await appendMemoryAudit({
      db: params.db,
      projectId: params.projectId,
      ownerId: params.ownerId,
      action: 'erase_export',
      actorKeyId: params.actorKeyId,
      requestId: params.requestId,
      detail: { entryCount: exportBundle.entryCount, reason },
    });
  }

  const ids = params.entryIds?.filter(Boolean);
  const { rows } = ids && ids.length > 0
    ? await params.db.query<{ id: string }>(
        `UPDATE memory_entries
            SET erased_at = now(),
                erase_reason = $3,
                text = $4,
                embedding = NULL
          WHERE project_id = $1::uuid
            AND erased_at IS NULL
            AND id = ANY($2::uuid[])
        RETURNING id`,
        [params.projectId, ids, reason, ERASED_TEXT_PLACEHOLDER],
      )
    : await params.db.query<{ id: string }>(
        `UPDATE memory_entries
            SET erased_at = now(),
                erase_reason = $2,
                text = $3,
                embedding = NULL
          WHERE project_id = $1::uuid
            AND erased_at IS NULL
        RETURNING id`,
        [params.projectId, reason, ERASED_TEXT_PLACEHOLDER],
      );

  const entryIds = rows.map((r) => r.id);
  await appendMemoryAudit({
    db: params.db,
    projectId: params.projectId,
    ownerId: params.ownerId,
    action: 'erase',
    actorKeyId: params.actorKeyId,
    requestId: params.requestId,
    detail: { erased: entryIds.length, reason, entryIds },
  });

  return { erased: entryIds.length, entryIds, exportBundle };
}
