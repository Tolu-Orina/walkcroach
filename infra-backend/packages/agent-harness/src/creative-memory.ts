/**
 * Creative Studio memory — Titan embeddings + “like last time” recall (Phase E1).
 */
import type { DbClient } from '@walkcroach/db';
import { embedText } from './bedrock.js';
import { formatVector } from './memory.js';

export type CreativeRecallHit = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  downloadName: string | null;
  distance: number;
  createdAt: string;
};

/** Text used for embedding a creative brief / artefact. */
export function creativeEmbedText(params: {
  kind: string;
  brief: Record<string, unknown>;
  altText?: string | null;
  downloadName?: string | null;
}): string {
  const b = params.brief;
  const parts = [
    `kind:${params.kind}`,
    typeof b.title === 'string' ? b.title : '',
    typeof b.headline === 'string' ? b.headline : '',
    typeof b.subtitle === 'string' ? b.subtitle : '',
    typeof b.support === 'string' ? b.support : '',
    typeof b.brand === 'string' ? `brand:${b.brand}` : '',
    Array.isArray(b.palette) ? `palette:${b.palette.join(',')}` : '',
    typeof b.template === 'string' ? `template:${b.template}` : '',
    params.altText ? `alt:${params.altText}` : '',
    params.downloadName ? `file:${params.downloadName}` : '',
  ];
  if (Array.isArray(b.slides)) {
    for (const s of b.slides.slice(0, 8)) {
      if (s && typeof s === 'object') {
        const row = s as Record<string, unknown>;
        parts.push(String(row.title ?? ''));
        if (Array.isArray(row.bullets)) {
          parts.push(row.bullets.map(String).join('; '));
        }
      }
    }
  }
  if (typeof b.reelPrompt === 'string') parts.push(b.reelPrompt);
  if (typeof b.voiceoverScript === 'string') parts.push(b.voiceoverScript);
  return parts.filter(Boolean).join('\n').slice(0, 8000);
}

export async function embedAndStoreCreativeAsset(params: {
  db: DbClient;
  assetId: string;
  kind: string;
  brief: Record<string, unknown>;
  altText?: string | null;
  downloadName?: string | null;
}): Promise<void> {
  const text = creativeEmbedText(params);
  const embedding = await embedText(text);
  const vec = formatVector(embedding);
  await params.db.query(
    `UPDATE creative_assets
     SET embedding = $2::vector,
         alt_text = COALESCE($3, alt_text),
         updated_at = now()
     WHERE id = $1::uuid`,
    [params.assetId, vec, params.altText ?? null],
  );
}

export async function embedAndStoreVideoJob(params: {
  db: DbClient;
  jobId: string;
  title?: string;
  reelPrompt?: string;
  voiceoverScript?: string | null;
  brand?: string;
}): Promise<void> {
  const text = [
    'kind:video',
    params.title ?? '',
    params.brand ? `brand:${params.brand}` : '',
    params.reelPrompt ?? '',
    params.voiceoverScript ?? '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000);
  const embedding = await embedText(text);
  const vec = formatVector(embedding);
  await params.db.query(
    `UPDATE video_jobs SET embedding = $2::vector, updated_at = now() WHERE id = $1::uuid`,
    [params.jobId, vec],
  );
}

/**
 * Semantic recall over this owner's ready creatives (“like the bakery deck”).
 * Chat has no project — owner_id is the primary key.
 */
export async function recallCreativeAssets(params: {
  db: DbClient;
  ownerId: string;
  query: string;
  limit?: number;
  kinds?: string[];
}): Promise<CreativeRecallHit[]> {
  const limit = Math.min(10, Math.max(1, params.limit ?? 5));
  const embedding = await embedText(params.query);
  const vec = formatVector(embedding);
  const kinds = params.kinds?.filter(Boolean) ?? [];

  const { rows } = await params.db.query<{
    id: string;
    kind: string;
    brief: Record<string, unknown>;
    download_name: string | null;
    distance: number;
    created_at: Date;
  }>(
    kinds.length > 0
      ? `SELECT id, kind, brief, download_name,
                embedding <=> $2::vector AS distance,
                created_at
         FROM creative_assets
         WHERE owner_id = $1
           AND status = 'ready'
           AND embedding IS NOT NULL
           AND superseded_by IS NULL
           AND kind = ANY($4::string[])
         ORDER BY embedding <=> $2::vector
         LIMIT $3`
      : `SELECT id, kind, brief, download_name,
                embedding <=> $2::vector AS distance,
                created_at
         FROM creative_assets
         WHERE owner_id = $1
           AND status = 'ready'
           AND embedding IS NOT NULL
           AND superseded_by IS NULL
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
    kinds.length > 0
      ? [params.ownerId, vec, limit, kinds]
      : [params.ownerId, vec, limit],
  );

  return rows.map((r) => {
    const title =
      (typeof r.brief?.title === 'string' && r.brief.title) ||
      (typeof r.brief?.headline === 'string' && r.brief.headline) ||
      r.download_name ||
      r.kind;
    const summary = creativeEmbedText({
      kind: r.kind,
      brief: r.brief ?? {},
      downloadName: r.download_name,
    }).slice(0, 400);
    return {
      id: r.id,
      kind: r.kind,
      title,
      summary,
      downloadName: r.download_name,
      distance: Number(r.distance),
      createdAt: r.created_at.toISOString(),
    };
  });
}

/** Persist a short memory_entries note pointing at a creative (project-scoped). */
export async function saveCreativeToProjectMemory(params: {
  db: DbClient;
  projectId: string;
  assetId: string;
  kind: string;
  title: string;
  note?: string;
}): Promise<string> {
  const { writeMemoryEntry } = await import('./memory.js');
  const text = [
    params.note?.trim() ||
      `Saved creative: ${params.kind} “${params.title}” (asset ${params.assetId}).`,
    `Reuse style/palette when the user asks for another like this.`,
  ].join(' ');
  return writeMemoryEntry({
    db: params.db,
    projectId: params.projectId,
    sourceSurface: 'web',
    kind: 'capture',
    text,
  });
}
