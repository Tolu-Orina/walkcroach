import type { DbClient } from '@walkcroach/db';
import { embedText } from './bedrock.js';
import { formatVector } from './memory.js';

export type SharedSkillRecord = {
  id: string;
  name: string;
  description: string;
  body: string;
  sourceSurface: string;
  createdAt: string;
  updatedAt: string;
};

export type SharedSkillSearchHit = SharedSkillRecord & {
  /** Cosine distance from `<=>` (0 = identical; lower is closer). */
  distance: number;
};

/** Upsert a shared skill for an owner — same name re-mirrors as an update, not a new row. */
export async function writeSharedSkill(params: {
  db: DbClient;
  ownerId: string;
  name: string;
  description: string;
  body: string;
  sourceSurface: string;
}): Promise<string> {
  const embedding = await embedText(
    `${params.description}\n\n${params.body.slice(0, 2000)}`,
  );
  const vec = formatVector(embedding);
  const { rows } = await params.db.query<{ id: string }>(
    `INSERT INTO shared_skills (owner_id, name, description, body, source_surface, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::vector)
     ON CONFLICT (owner_id, name) DO UPDATE
       SET description = excluded.description,
           body = excluded.body,
           source_surface = excluded.source_surface,
           embedding = excluded.embedding,
           updated_at = now()
     RETURNING id`,
    [
      params.ownerId,
      params.name,
      params.description,
      params.body,
      params.sourceSurface,
      vec,
    ],
  );
  return rows[0]!.id;
}

/** List all shared skills owned by a user, most recently updated first. */
export async function listSharedSkills(params: {
  db: DbClient;
  ownerId: string;
  limit?: number;
}): Promise<SharedSkillRecord[]> {
  const limit = params.limit ?? 100;
  const { rows } = await params.db.query<{
    id: string;
    name: string;
    description: string;
    body: string;
    source_surface: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, name, description, body, source_surface, created_at, updated_at
     FROM shared_skills
     WHERE owner_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [params.ownerId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    body: r.body,
    sourceSurface: r.source_surface,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Semantic recall over the owner's shared skills.
 * Pins owner_id so shared_skills_owner_embedding_idx (044) stays eligible —
 * do not add unconstrained filters here.
 */
export async function searchSharedSkills(params: {
  db: DbClient;
  ownerId: string;
  query: string;
  limit?: number;
}): Promise<SharedSkillSearchHit[]> {
  const q = params.query.trim();
  if (!q) return [];
  const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
  const embedding = await embedText(q);
  const vec = formatVector(embedding);
  const { rows } = await params.db.query<{
    id: string;
    name: string;
    description: string;
    body: string;
    source_surface: string;
    created_at: string;
    updated_at: string;
    distance: string | number;
  }>(
    `SELECT id, name, description, body, source_surface, created_at, updated_at,
            embedding <=> $2::vector AS distance
       FROM shared_skills
      WHERE owner_id = $1
      ORDER BY embedding <=> $2::vector
      LIMIT $3`,
    [params.ownerId, vec, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    body: r.body,
    sourceSurface: r.source_surface,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    distance: Number(r.distance),
  }));
}
