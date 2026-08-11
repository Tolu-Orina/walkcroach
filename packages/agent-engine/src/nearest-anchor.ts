/**
 * Rank nearest line-windows in a file against a failed old_str so mismatch
 * errors can offer copy-pasteable anchors instead of only a raw excerpt dump.
 */

export const DEFAULT_NEAREST_TOP_K = 3;
/** Skip candidates below this combined score (0–1). */
export const DEFAULT_NEAREST_MIN_SCORE = 0.28;
/** Cap sliding-window search for large files. */
export const DEFAULT_NEAREST_MAX_SCAN_LINES = 4_000;
/** Cap strings fed to Levenshtein. */
const LEV_MAX_CHARS = 360;

export type NearestAnchorCandidate = {
  /** 1-based start line in the file. */
  startLine: number;
  /** 1-based end line (inclusive). */
  endLine: number;
  /** Exact text to copy into old_str (file newlines preserved as \n). */
  text: string;
  /** Combined similarity 0–1. */
  score: number;
};

export function normalizeAnchorText(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/gu, ' ').trim())
    .join('\n')
    .trim();
}

function tokenize(s: string): string[] {
  const n = normalizeAnchorText(s);
  return n ? n.split(/\s+/u).filter(Boolean) : [];
}

function jaccardTokens(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Normalized Levenshtein similarity in [0, 1]. */
export function levenshteinRatio(a: string, b: string): number {
  const aa = a.length > LEV_MAX_CHARS ? a.slice(0, LEV_MAX_CHARS) : a;
  const bb = b.length > LEV_MAX_CHARS ? b.slice(0, LEV_MAX_CHARS) : b;
  if (aa === bb) return 1;
  if (!aa.length || !bb.length) return 0;
  const m = aa.length;
  const n = bb.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = aa.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === bb.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  const dist = prev[n] ?? 0;
  return 1 - dist / Math.max(m, n, 1);
}

function scoreWindow(needleNorm: string, needleTok: string[], window: string): number {
  const winNorm = normalizeAnchorText(window);
  if (!winNorm) return 0;
  const jac = jaccardTokens(needleTok, tokenize(winNorm));
  const lev = levenshteinRatio(needleNorm, winNorm);
  return 0.55 * jac + 0.45 * lev;
}

/**
 * Find top-K nearest line windows for a failed old_str.
 * Windows use the needle's line count (clamped 1–12), scanning the file once.
 */
export function findNearestAnchors(
  content: string,
  oldStr: string,
  opts?: {
    topK?: number;
    minScore?: number;
    maxScanLines?: number;
  },
): NearestAnchorCandidate[] {
  const topK = opts?.topK ?? DEFAULT_NEAREST_TOP_K;
  const minScore = opts?.minScore ?? DEFAULT_NEAREST_MIN_SCORE;
  const maxScan = opts?.maxScanLines ?? DEFAULT_NEAREST_MAX_SCAN_LINES;

  if (!oldStr.trim() || !content) return [];

  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const scanLines = lines.length > maxScan ? lines.slice(0, maxScan) : lines;
  const needleLines = oldStr.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const windowSize = Math.min(12, Math.max(1, needleLines.length));
  const needleNorm = normalizeAnchorText(oldStr);
  const needleTok = tokenize(oldStr);

  const scored: NearestAnchorCandidate[] = [];
  if (scanLines.length < windowSize) {
    const text = scanLines.join('\n');
    const score = scoreWindow(needleNorm, needleTok, text);
    if (score >= minScore) {
      scored.push({
        startLine: 1,
        endLine: Math.max(1, scanLines.length),
        text,
        score,
      });
    }
  } else {
    for (let i = 0; i <= scanLines.length - windowSize; i++) {
      const slice = scanLines.slice(i, i + windowSize);
      const text = slice.join('\n');
      const score = scoreWindow(needleNorm, needleTok, text);
      if (score < minScore) continue;
      scored.push({
        startLine: i + 1,
        endLine: i + windowSize,
        text,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.startLine - b.startLine);

  // Deduplicate near-identical windows (keep highest score).
  const out: NearestAnchorCandidate[] = [];
  const seen = new Set<string>();
  for (const c of scored) {
    const key = normalizeAnchorText(c.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= topK) break;
  }
  return out;
}

/** Format candidates for tool-error recovery (empty string when none). */
export function formatNearestAnchorHints(
  candidates: NearestAnchorCandidate[],
): string {
  if (candidates.length === 0) return '';
  const blocks = candidates.map((c, i) => {
    const score = c.score.toFixed(2);
    return [
      `--- candidate ${i + 1} (score=${score}, lines ${c.startLine}–${c.endLine}) ---`,
      c.text,
      `--- end candidate ${i + 1} ---`,
    ].join('\n');
  });
  return [
    'Nearest anchors in the file (copy one into old_str verbatim):',
    ...blocks,
  ].join('\n');
}
