/**
 * Local semantic ranking over the in-process SkillsRegistry catalog.
 * Uses Titan embeddings (same 1024-d space as CRDB / semantic_search) with an
 * optional on-disk cache under `.walkcroach/index/skills-vectors.json`.
 *
 * Deliberately a *nudge*: never auto-loads skill bodies into context — the
 * model still calls load_skill. Ranking failures are best-effort (caller catches).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cosineSimilarity, INDEX_REL_DIR, type EmbedFn } from './local-index.js';
import type { SkillFull, SkillMeta } from './skills.js';
import { getTitanEmbedModelId } from './bedrock.js';

export const SKILLS_VECTORS_REL_PATH = `${INDEX_REL_DIR}/skills-vectors.json`;

export const DEFAULT_SKILL_RANK_TOP_K = 5;
/** Cosine floor — below this, omit from the nudge (noise). */
export const DEFAULT_SKILL_RANK_MIN_SCORE = 0.28;
/** Blend weight for embedding vs keyword hit (embedding dominates). */
export const SKILL_RANK_EMBED_WEIGHT = 0.8;

export type SkillRankCandidate = SkillMeta & {
  /** Optional body slice improves embedding quality when available. */
  body?: string;
};

export type SkillRankHit = {
  name: string;
  description: string;
  source: SkillMeta['source'];
  score: number;
  /** True when keyword match() also hit this name. */
  keywordBoost?: boolean;
};

type CacheFile = {
  model: string;
  entries: Record<string, { hash: string; embedding: number[] }>;
};

export function skillEmbedText(skill: SkillRankCandidate): string {
  const body = (skill.body ?? '').trim().slice(0, 1500);
  return [`# ${skill.name}`, skill.description.trim(), body]
    .filter(Boolean)
    .join('\n\n');
}

export function skillContentHash(skill: SkillRankCandidate): string {
  return createHash('sha1')
    .update(skillEmbedText(skill), 'utf8')
    .digest('hex');
}

function cachePath(workspaceRoot: string): string {
  return join(workspaceRoot, SKILLS_VECTORS_REL_PATH);
}

async function readCache(workspaceRoot: string | undefined): Promise<CacheFile> {
  if (!workspaceRoot) {
    return { model: getTitanEmbedModelId(), entries: {} };
  }
  try {
    const raw = await readFile(cachePath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.entries) {
      return { model: getTitanEmbedModelId(), entries: {} };
    }
    return {
      model: parsed.model || getTitanEmbedModelId(),
      entries: parsed.entries,
    };
  } catch {
    return { model: getTitanEmbedModelId(), entries: {} };
  }
}

async function writeCache(
  workspaceRoot: string | undefined,
  cache: CacheFile,
): Promise<void> {
  if (!workspaceRoot) return;
  const path = cachePath(workspaceRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache), 'utf8');
}

/**
 * Rank catalog skills against a user query via Titan cosine + light keyword blend.
 */
export async function rankSkills(params: {
  query: string;
  skills: SkillRankCandidate[];
  embed: EmbedFn;
  /** Names that keyword match() already surfaced (boost). */
  keywordNames?: Iterable<string>;
  topK?: number;
  minScore?: number;
  workspaceRoot?: string;
}): Promise<SkillRankHit[]> {
  const query = params.query.trim();
  if (!query || params.skills.length === 0) return [];

  const topK = params.topK ?? DEFAULT_SKILL_RANK_TOP_K;
  const minScore = params.minScore ?? DEFAULT_SKILL_RANK_MIN_SCORE;
  const keywordSet = new Set(
    [...(params.keywordNames ?? [])].map((n) => n.toLowerCase()),
  );

  const cache = await readCache(params.workspaceRoot);
  const model = getTitanEmbedModelId();
  if (cache.model !== model) {
    cache.model = model;
    cache.entries = {};
  }

  let cacheDirty = false;
  const embeddings = new Map<string, number[]>();

  for (const skill of params.skills) {
    const hash = skillContentHash(skill);
    const cached = cache.entries[skill.name];
    if (cached && cached.hash === hash && cached.embedding?.length) {
      embeddings.set(skill.name, cached.embedding);
      continue;
    }
    const vec = await params.embed(skillEmbedText(skill));
    embeddings.set(skill.name, vec);
    cache.entries[skill.name] = { hash, embedding: vec };
    cacheDirty = true;
  }

  if (cacheDirty) {
    await writeCache(params.workspaceRoot, cache).catch(() => {
      /* cache write is best-effort */
    });
  }

  const queryVec = await params.embed(query);
  const hits: SkillRankHit[] = [];

  for (const skill of params.skills) {
    const vec = embeddings.get(skill.name);
    if (!vec) continue;
    const cosine = cosineSimilarity(queryVec, vec);
    const keywordBoost = keywordSet.has(skill.name.toLowerCase());
    const keywordScore = keywordBoost ? 1 : 0;
    const score =
      SKILL_RANK_EMBED_WEIGHT * cosine +
      (1 - SKILL_RANK_EMBED_WEIGHT) * keywordScore;
    if (score < minScore) continue;
    hits.push({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      score,
      keywordBoost: keywordBoost || undefined,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, topK);
}

/** Build candidates from registry meta + optional full bodies. */
export function candidatesFromRegistry(
  metas: SkillMeta[],
  load: (name: string) => SkillFull | null,
): SkillRankCandidate[] {
  return metas.map((m) => {
    const full = load(m.name);
    return {
      ...m,
      body: full?.body,
    };
  });
}

/**
 * Merge remote CRDB hits into a local ranking list (by name).
 * Remote distance is cosine distance (<=>); convert to similarity ≈ 1 - d.
 */
export function mergeRemoteSkillHits(params: {
  local: SkillRankHit[];
  remote: Array<{
    name: string;
    description: string;
    source?: SkillMeta['source'];
    distance: number;
  }>;
  topK?: number;
  minScore?: number;
}): SkillRankHit[] {
  const topK = params.topK ?? DEFAULT_SKILL_RANK_TOP_K;
  const minScore = params.minScore ?? DEFAULT_SKILL_RANK_MIN_SCORE;
  const byName = new Map<string, SkillRankHit>();

  for (const h of params.local) {
    byName.set(h.name, { ...h });
  }

  for (const r of params.remote) {
    const sim = Math.max(0, 1 - r.distance);
    if (sim < minScore) continue;
    const existing = byName.get(r.name);
    if (existing) {
      existing.score = Math.max(existing.score, sim);
    } else {
      byName.set(r.name, {
        name: r.name,
        description: r.description,
        source: r.source ?? 'shared',
        score: sim,
      });
    }
  }

  return [...byName.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, topK);
}

/** System-prompt block — progressive disclosure still requires load_skill. */
export function formatSkillRankNudge(hits: SkillRankHit[]): string {
  if (!hits.length) return '';
  const lines = hits.map(
    (h) =>
      `- ${h.name} [${h.source}] (score ${h.score.toFixed(2)}): ${h.description}`,
  );
  return [
    '# Likely relevant skills for this turn',
    'Ranked by local Titan embedding similarity (plus keyword boost). Metadata only — call load_skill before following a procedure.',
    '',
    ...lines,
  ].join('\n');
}
