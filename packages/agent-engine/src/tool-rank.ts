/**
 * P4 — Within-phase tool retrieval (Act schema prune).
 *
 * Titan-rank optional Act tools (same 1024-d space as skill-rank). Core keep-always
 * tools are never dropped. Ranking failures are best-effort (caller falls back to
 * the full phase allowlist).
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cosineSimilarity, INDEX_REL_DIR, type EmbedFn } from './local-index.js';
import { getTitanEmbedModelId } from './bedrock.js';
import { getToolDef, type ToolDef } from './tools/defs.js';

export const TOOLS_VECTORS_REL_PATH = `${INDEX_REL_DIR}/tools-vectors.json`;

export const DEFAULT_TOOL_RANK_TOP_K = 3;
export const DEFAULT_TOOL_RANK_MIN_SCORE = 0.22;
export const TOOL_RANK_EMBED_WEIGHT = 0.75;

/**
 * Always offered in Act when tool-rank is on.
 * Sized so keep + topK ≤ 12 (exit criterion with MCP configured).
 */
export const ACT_TOOL_KEEP_ALWAYS = [
  'read_file',
  'search',
  'write_file',
  'edit_file',
  'apply_patch',
  'run_terminal',
  'verify',
  'ask_user',
  'load_skill',
] as const;

export type ToolRankCandidate = {
  name: string;
  description: string;
};

export type ToolRankHit = {
  name: string;
  description: string;
  score: number;
  keywordBoost?: boolean;
};

type CacheFile = {
  model: string;
  entries: Record<string, { hash: string; embedding: number[] }>;
};

export function toolEmbedText(tool: ToolRankCandidate): string {
  return [`# ${tool.name}`, tool.description.trim()].filter(Boolean).join('\n\n');
}

export function toolContentHash(tool: ToolRankCandidate): string {
  return createHash('sha1')
    .update(toolEmbedText(tool), 'utf8')
    .digest('hex');
}

export function candidatesFromToolNames(
  names: readonly string[],
): ToolRankCandidate[] {
  const out: ToolRankCandidate[] = [];
  for (const name of names) {
    const def: ToolDef | undefined = getToolDef(name);
    if (!def) continue;
    out.push({ name: def.name, description: def.description });
  }
  return out;
}

function cachePath(workspaceRoot: string): string {
  return join(workspaceRoot, TOOLS_VECTORS_REL_PATH);
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

/** Light keyword / domain boosts so Cockroach paths are not pruned away. */
export function toolKeywordBoost(
  query: string,
  toolName: string,
  description: string,
): boolean {
  const q = query.toLowerCase();
  const name = toolName.toLowerCase();
  const desc = description.toLowerCase();

  if (name === 'cockroach_mcp') {
    if (
      /\b(cockroach|crdb|sql|schema|explain|select|database)\b/i.test(q)
    ) {
      return true;
    }
  }
  if (name === 'ccloud') {
    if (
      /\b(ccloud|cluster|provision|cockroach\s*cloud|serverless)\b/i.test(q)
    ) {
      return true;
    }
  }
  if (name === 'mcp_call' && /\b(mcp|connector|tool server)\b/i.test(q)) {
    return true;
  }
  if (
    (name === 'enter_worktree' || name === 'exit_worktree') &&
    /\b(worktree|isolated branch|parallel edit)\b/i.test(q)
  ) {
    return true;
  }
  if (
    name === 'terminal_session' &&
    /\b(repl|tui|interactive|pty|session)\b/i.test(q)
  ) {
    return true;
  }
  if (name === 'semantic_search' && /\b(semantic|embedding|similar)\b/i.test(q)) {
    return true;
  }
  if (name === 'spawn_subagent' && /\b(subagent|fan[- ]?out|parallel explore)\b/i.test(q)) {
    return true;
  }
  if (name === 'todo_write' && /\b(todo|checklist|track steps)\b/i.test(q)) {
    return true;
  }
  if (name === 'present_plan' && /\b(plan|present_plan|approve)\b/i.test(q)) {
    return true;
  }

  // Generic: tool name token appears in query.
  const token = name.replace(/_/g, ' ');
  if (token.length >= 4 && q.includes(token)) return true;
  if (name.includes('_') && q.includes(name.split('_')[0]!)) {
    // weak — require desc keyword overlap
    const words = desc.split(/\W+/).filter((w) => w.length > 4).slice(0, 8);
    if (words.some((w) => q.includes(w))) return true;
  }
  return false;
}

/**
 * Rank optional tools against the user query via Titan cosine + keyword blend.
 */
export async function rankTools(params: {
  query: string;
  tools: ToolRankCandidate[];
  embed: EmbedFn;
  topK?: number;
  minScore?: number;
  workspaceRoot?: string;
}): Promise<ToolRankHit[]> {
  const query = params.query.trim();
  if (!query || params.tools.length === 0) return [];

  const topK = params.topK ?? DEFAULT_TOOL_RANK_TOP_K;
  const minScore = params.minScore ?? DEFAULT_TOOL_RANK_MIN_SCORE;

  const cache = await readCache(params.workspaceRoot);
  const model = getTitanEmbedModelId();
  if (cache.model !== model) {
    cache.model = model;
    cache.entries = {};
  }

  let cacheDirty = false;
  const embeddings = new Map<string, number[]>();

  for (const tool of params.tools) {
    const hash = toolContentHash(tool);
    const cached = cache.entries[tool.name];
    if (cached && cached.hash === hash && cached.embedding?.length) {
      embeddings.set(tool.name, cached.embedding);
      continue;
    }
    const vec = await params.embed(toolEmbedText(tool));
    embeddings.set(tool.name, vec);
    cache.entries[tool.name] = { hash, embedding: vec };
    cacheDirty = true;
  }

  if (cacheDirty) {
    await writeCache(params.workspaceRoot, cache).catch(() => {
      /* best-effort */
    });
  }

  const queryVec = await params.embed(query);
  const hits: ToolRankHit[] = [];

  for (const tool of params.tools) {
    const vec = embeddings.get(tool.name);
    if (!vec) continue;
    const cosine = cosineSimilarity(queryVec, vec);
    const keywordBoost = toolKeywordBoost(query, tool.name, tool.description);
    const keywordScore = keywordBoost ? 1 : 0;
    const score =
      TOOL_RANK_EMBED_WEIGHT * cosine +
      (1 - TOOL_RANK_EMBED_WEIGHT) * keywordScore;
    if (score < minScore && !keywordBoost) continue;
    hits.push({
      name: tool.name,
      description: tool.description,
      score: keywordBoost ? Math.max(score, minScore) : score,
      keywordBoost: keywordBoost || undefined,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, topK);
}

/**
 * Split a resolved Act allowlist into keep-always vs optional candidates.
 * Only names present in the full allowlist (flag-gated) are considered.
 */
export function splitActAllowlistForRank(
  fullAllowlist: readonly string[],
  keepAlways: readonly string[] = ACT_TOOL_KEEP_ALWAYS,
): { keep: string[]; optional: string[] } {
  const full = new Set(fullAllowlist);
  const keep = keepAlways.filter((n) => full.has(n));
  const keepSet = new Set(keep);
  const optional = fullAllowlist.filter((n) => !keepSet.has(n));
  return { keep, optional };
}

/**
 * Merge keep-always + ranked extras in stable full-allowlist order.
 * Caps total at keep.length + maxExtras (default topK).
 */
export function mergeActAllowlistWithRank(params: {
  fullAllowlist: readonly string[];
  rankedOptionalNames: readonly string[];
  keepAlways?: readonly string[];
  maxExtras?: number;
}): string[] {
  const maxExtras = params.maxExtras ?? DEFAULT_TOOL_RANK_TOP_K;
  const { keep, optional } = splitActAllowlistForRank(
    params.fullAllowlist,
    params.keepAlways,
  );
  const optionalSet = new Set(optional);
  const extras: string[] = [];
  for (const name of params.rankedOptionalNames) {
    if (!optionalSet.has(name)) continue;
    if (extras.includes(name)) continue;
    extras.push(name);
    if (extras.length >= maxExtras) break;
  }
  const selected = new Set([...keep, ...extras]);
  return params.fullAllowlist.filter((n) => selected.has(n));
}

/** Hard budget used by fitness / exit criterion. */
export const ACT_TOOL_RANK_BUDGET = 12;

export function assertActToolBudget(names: readonly string[]): void {
  if (names.length > ACT_TOOL_RANK_BUDGET) {
    throw new Error(
      `tool_rank budget: Act offered ${names.length} tools (max ${ACT_TOOL_RANK_BUDGET})`,
    );
  }
  for (const k of ACT_TOOL_KEEP_ALWAYS) {
    if (!names.includes(k)) {
      throw new Error(`tool_rank invariant: missing keep-always tool ${k}`);
    }
  }
}
