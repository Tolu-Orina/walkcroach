/**
 * Deterministic sliding-window text chunker for CockroachDB RAG ingest.
 *
 * - Window: CHUNK_TARGET_CHARS (default 1200)
 * - Overlap: CHUNK_OVERLAP_CHARS (default 200)
 * - Soft break: sentence / whitespace when possible
 * - Cap: MAX_CHUNKS_PER_DOCUMENT (default 80)
 * - Hard ceiling per chunk: CHUNK_HARD_MAX_CHARS (Titan-safe)
 */

export const CHUNK_TARGET_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 200;
export const MAX_CHUNKS_PER_DOCUMENT = 80;
export const CHUNK_HARD_MAX_CHARS = 6000;

export type TextChunk = {
  index: number;
  content: string;
  charCount: number;
};

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Prefer a sentence end, then whitespace, inside [minBreak, limit].
 * Returns exclusive end index into `text` starting at `start`.
 */
function chooseEnd(text: string, start: number, limit: number): number {
  const maxEnd = Math.min(start + limit, text.length);
  if (maxEnd >= text.length) return text.length;

  const window = text.slice(start, maxEnd);
  const minRel = Math.floor(window.length * 0.45);

  let best = -1;
  for (const token of ['. ', '? ', '! ', '.\n', '?\n', '!\n', '\n\n']) {
    let from = minRel;
    for (;;) {
      const at = window.indexOf(token, from);
      if (at < 0) break;
      best = Math.max(best, at + token.length);
      from = at + 1;
    }
  }
  if (best >= minRel) return start + best;

  const space = window.lastIndexOf(' ');
  if (space >= minRel) return start + space + 1;

  const nl = window.lastIndexOf('\n');
  if (nl >= minRel) return start + nl + 1;

  return maxEnd;
}

/**
 * Chunk `raw` into overlapping windows suitable for Titan embed + CRDB VECTOR.
 */
export function chunkText(
  raw: string,
  opts?: {
    targetChars?: number;
    overlapChars?: number;
    maxChunks?: number;
    hardMaxChars?: number;
  },
): TextChunk[] {
  const target = Math.max(
    64,
    Math.min(opts?.targetChars ?? CHUNK_TARGET_CHARS, opts?.hardMaxChars ?? CHUNK_HARD_MAX_CHARS),
  );
  const hardMax = opts?.hardMaxChars ?? CHUNK_HARD_MAX_CHARS;
  const overlap = Math.min(
    Math.max(0, opts?.overlapChars ?? CHUNK_OVERLAP_CHARS),
    target - 1,
  );
  const maxChunks = Math.max(1, opts?.maxChunks ?? MAX_CHUNKS_PER_DOCUMENT);

  const text = normalizeText(raw);
  if (!text) return [];

  if (text.length <= target) {
    const content = text.slice(0, hardMax);
    return [{ index: 0, content, charCount: content.length }];
  }

  const out: TextChunk[] = [];
  let start = 0;

  while (start < text.length && out.length < maxChunks) {
    const end = chooseEnd(text, start, Math.min(target, hardMax));
    const content = text.slice(start, end).trim();
    if (content.length > 0) {
      out.push({
        index: out.length,
        content: content.slice(0, hardMax),
        charCount: Math.min(content.length, hardMax),
      });
    }

    if (end >= text.length) break;

    const next = end - overlap;
    // Always advance to avoid infinite loops on zero-width progress
    start = next <= start ? end : next;
  }

  return out;
}
