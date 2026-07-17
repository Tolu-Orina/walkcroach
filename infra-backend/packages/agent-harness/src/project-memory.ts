import type { DbClient } from '@walkcroach/db';

const SUMMARY_MAX = 280;

/**
 * FR-32: Cache top-3 preference/decision memories as a dashboard card blurb.
 */
export async function refreshProjectMemorySummary(
  db: DbClient,
  projectId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ kind: string; text: string }>(
    `SELECT kind, text
     FROM memory_entries
     WHERE project_id = $1::uuid
       AND superseded_by IS NULL
       AND kind IN ('preference', 'decision')
     ORDER BY created_at DESC
     LIMIT 3`,
    [projectId],
  );

  if (rows.length === 0) {
    await db.query(
      `UPDATE projects SET memory_summary = NULL, updated_at = now()
       WHERE id = $1::uuid`,
      [projectId],
    );
    return null;
  }

  let summary = rows.map((r) => `[${r.kind}] ${r.text}`).join(' · ');
  if (summary.length > SUMMARY_MAX) {
    summary = `${summary.slice(0, SUMMARY_MAX - 3)}...`;
  }

  await db.query(
    `UPDATE projects SET memory_summary = $2, updated_at = now()
     WHERE id = $1::uuid`,
    [projectId, summary],
  );
  return summary;
}
