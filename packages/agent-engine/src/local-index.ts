/**
 * Local semantic index — embedding-based retrieval over the workspace,
 * complementary to the exact/regex `search`/`glob` tools (host.search/host.glob).
 *
 * v1 is deliberately the smallest viable version, not gold-plated:
 * - Storage is flat files under `.walkcroach/index/`, no ANN library — brute-force
 *   cosine similarity over all chunk vectors at query time. Fine at single-repo scale.
 * - Chunking is naive line-window, language-agnostic — no AST/tree-sitter dependency.
 * - Indexing is lazy (triggered by each semantic_search call) and incremental via a
 *   two-tier check per file: mtime match → skip entirely; mtime differs but content
 *   hash matches → refresh mtime only; otherwise → re-chunk and re-embed. Trade-off:
 *   two writes to the same file within one mtime tick (filesystem-dependent, often
 *   ~1ms+) are indistinguishable from the fast path's perspective and the second
 *   write won't be picked up until something else changes that file's mtime.
 * - Embedding calls run sequentially, one chunk at a time, and errors propagate
 *   immediately (fail fast) rather than being swallowed per-chunk — so a missing
 *   Bedrock credential surfaces as one clear error, not silent empty results after
 *   retrying every chunk.
 *
 * Fast-follows intentionally deferred, not required for v1:
 * - Proactive re-indexing via a `vscode.workspace.createFileSystemWatcher`-driven
 *   updater in VsCodeHostAdapter (no file watcher exists anywhere in ide/src today).
 * - Parallel/batched embedding calls (sequential is simpler and avoids rate limits).
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { WALK_CROACH_DIR } from './session-fs.js';
import { truncateText } from './truncate.js';

export const INDEX_REL_DIR = `${WALK_CROACH_DIR}/index`;
export const MANIFEST_REL_PATH = `${INDEX_REL_DIR}/manifest.json`;
export const VECTORS_REL_PATH = `${INDEX_REL_DIR}/vectors.jsonl`;

export const DEFAULT_CHUNK_WINDOW_LINES = 150;
export const DEFAULT_CHUNK_OVERLAP_LINES = 20;
export const DEFAULT_MAX_INDEX_FILES = 2000;
/** Files larger than this (bytes) are skipped entirely rather than indexed partially. */
export const MAX_INDEXABLE_FILE_BYTES = 300_000;
export const DEFAULT_SEMANTIC_SEARCH_TOP_K = 8;

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  // Never index our own bookkeeping (sessions, checkpoints, the index itself, etc.).
  WALK_CROACH_DIR,
]);

const BINARY_EXT_BLOCKLIST = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.mov', '.avi', '.wav',
  '.wasm', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.lock',
]);

export type EmbedFn = (text: string) => Promise<number[]>;

export type IndexChunkRecord = {
  path: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  embedding: number[];
  contentHash: string;
};

export type SemanticSearchHit = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
};

type ManifestEntry = { contentHash: string; mtimeMs: number };
type IndexManifest = Record<string, ManifestEntry>;

/** Line-window chunking: ~150-line windows, 20-line overlap. Language-agnostic. */
export function chunkLines(
  content: string,
  opts?: { windowLines?: number; overlapLines?: number },
): Array<{ startLine: number; endLine: number; text: string }> {
  const windowLines = opts?.windowLines ?? DEFAULT_CHUNK_WINDOW_LINES;
  const overlapLines = opts?.overlapLines ?? DEFAULT_CHUNK_OVERLAP_LINES;
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];

  const chunks: Array<{ startLine: number; endLine: number; text: string }> = [];
  const step = Math.max(1, windowLines - overlapLines);
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(lines.length, start + windowLines);
    chunks.push({
      startLine: start + 1,
      endLine: end,
      text: lines.slice(start, end).join('\n'),
    });
    if (end >= lines.length) break;
    start += step;
  }
  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

function manifestPath(workspaceRoot: string): string {
  return join(workspaceRoot, MANIFEST_REL_PATH);
}

function vectorsPath(workspaceRoot: string): string {
  return join(workspaceRoot, VECTORS_REL_PATH);
}

async function readManifest(workspaceRoot: string): Promise<IndexManifest> {
  try {
    const raw = await readFile(manifestPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as IndexManifest)
      : {};
  } catch {
    return {};
  }
}

async function writeManifest(
  workspaceRoot: string,
  manifest: IndexManifest,
): Promise<void> {
  await mkdir(join(workspaceRoot, INDEX_REL_DIR), { recursive: true });
  await writeFile(
    manifestPath(workspaceRoot),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

async function readVectorRows(
  workspaceRoot: string,
): Promise<IndexChunkRecord[]> {
  let raw: string;
  try {
    raw = await readFile(vectorsPath(workspaceRoot), 'utf8');
  } catch {
    return [];
  }
  const rows: IndexChunkRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as IndexChunkRecord);
    } catch {
      /* skip corrupt line */
    }
  }
  return rows;
}

async function writeVectorRows(
  workspaceRoot: string,
  rows: IndexChunkRecord[],
): Promise<void> {
  await mkdir(join(workspaceRoot, INDEX_REL_DIR), { recursive: true });
  const body =
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  await writeFile(vectorsPath(workspaceRoot), body, 'utf8');
}

/** Recursively lists indexable relative file paths, sorted, capped at maxFiles. */
async function discoverFiles(
  workspaceRoot: string,
  maxFiles: number,
): Promise<string[]> {
  const found: string[] = [];

  async function walk(dirAbs: string, dirRel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(e.name)) continue;
        await walk(join(dirAbs, e.name), dirRel ? `${dirRel}/${e.name}` : e.name);
      } else if (e.isFile()) {
        if (BINARY_EXT_BLOCKLIST.has(extname(e.name).toLowerCase())) continue;
        found.push(dirRel ? `${dirRel}/${e.name}` : e.name);
      }
    }
  }

  await walk(workspaceRoot, '');
  found.sort((a, b) => a.localeCompare(b));
  return found.slice(0, maxFiles);
}

export type UpdateIndexResult = {
  reindexedFiles: number;
  unchangedFiles: number;
  totalChunks: number;
};

/**
 * Incrementally (re)builds the local index. Cheap to call on every
 * semantic_search — unchanged files are skipped via a two-tier mtime/hash
 * check; files no longer discoverable (deleted, newly excluded) are dropped.
 */
export async function updateIndex(
  workspaceRoot: string,
  embed: EmbedFn,
  opts?: { maxFiles?: number },
): Promise<UpdateIndexResult> {
  const maxFiles = opts?.maxFiles ?? DEFAULT_MAX_INDEX_FILES;
  const manifest = await readManifest(workspaceRoot);
  const candidates = await discoverFiles(workspaceRoot, maxFiles);

  const existingRows = await readVectorRows(workspaceRoot);
  const rowsByPath = new Map<string, IndexChunkRecord[]>();
  for (const row of existingRows) {
    const list = rowsByPath.get(row.path);
    if (list) list.push(row);
    else rowsByPath.set(row.path, [row]);
  }

  const nextManifest: IndexManifest = {};
  const nextRows: IndexChunkRecord[] = [];
  let reindexedFiles = 0;
  let unchangedFiles = 0;

  for (const relPath of candidates) {
    const abs = join(workspaceRoot, relPath);
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue; // vanished mid-scan
    }
    if (st.size > MAX_INDEXABLE_FILE_BYTES) continue;

    const prior = manifest[relPath];
    if (prior && prior.mtimeMs === st.mtimeMs) {
      nextManifest[relPath] = prior;
      nextRows.push(...(rowsByPath.get(relPath) ?? []));
      unchangedFiles++;
      continue;
    }

    let content: string;
    try {
      content = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const contentHash = sha1(content);

    if (prior && prior.contentHash === contentHash) {
      // mtime touched but content unchanged (e.g. checkout) — refresh mtime only.
      nextManifest[relPath] = { contentHash, mtimeMs: st.mtimeMs };
      nextRows.push(...(rowsByPath.get(relPath) ?? []));
      unchangedFiles++;
      continue;
    }

    const chunks = chunkLines(content).filter((c) => c.text.trim());
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const embedding = await embed(chunk.text);
      nextRows.push({
        path: relPath,
        chunkIndex: i,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        embedding,
        contentHash,
      });
    }
    nextManifest[relPath] = { contentHash, mtimeMs: st.mtimeMs };
    reindexedFiles++;
  }

  await writeManifest(workspaceRoot, nextManifest);
  await writeVectorRows(workspaceRoot, nextRows);

  return { reindexedFiles, unchangedFiles, totalChunks: nextRows.length };
}

async function readSnippet(
  workspaceRoot: string,
  relPath: string,
  startLine: number,
  endLine: number,
): Promise<string> {
  try {
    const content = await readFile(join(workspaceRoot, relPath), 'utf8');
    const lines = content.split(/\r?\n/);
    const snippet = lines.slice(startLine - 1, endLine).join('\n');
    return truncateText(snippet, 4_000).text;
  } catch {
    return '(source no longer available)';
  }
}

/** Brute-force cosine search over all indexed chunks. Call updateIndex first. */
export async function semanticSearch(
  workspaceRoot: string,
  embed: EmbedFn,
  query: string,
  opts?: { topK?: number },
): Promise<SemanticSearchHit[]> {
  const topK = opts?.topK ?? DEFAULT_SEMANTIC_SEARCH_TOP_K;
  const rows = await readVectorRows(workspaceRoot);
  if (!rows.length) return [];

  const queryEmbedding = await embed(query);
  const scored = rows
    .map((row) => ({ row, score: cosineSimilarity(queryEmbedding, row.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, topK));

  const hits: SemanticSearchHit[] = [];
  for (const { row, score } of scored) {
    const snippet = await readSnippet(
      workspaceRoot,
      row.path,
      row.startLine,
      row.endLine,
    );
    hits.push({ path: row.path, startLine: row.startLine, endLine: row.endLine, score, snippet });
  }
  return hits;
}
