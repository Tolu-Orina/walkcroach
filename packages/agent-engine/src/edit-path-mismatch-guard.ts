/**
 * After N consecutive edit_mismatch failures on the same path, refuse further
 * edit_file / apply_patch on that path until a successful mutate or explicit clear.
 * Forces write_file / ask_user instead of burning more Bedrock turns.
 *
 * Small files (≤ {@link SMALL_FILE_LINE_LIMIT} lines) use a tighter limit
 * ({@link SMALL_FILE_PATH_MISMATCH_LIMIT}) — Aider/Cursor economics: full rewrite
 * beats thrashing surgical anchors on short files (no Morph/apply sidecar).
 */
import { normalizeEditPath } from './edit-anchor-guard.js';

export const DEFAULT_PATH_MISMATCH_LIMIT = 3;
/** Aider-style threshold: below this, prefer write_file after repeated mismatches. */
export const SMALL_FILE_LINE_LIMIT = 400;
/** Block surgical edits sooner on small files. */
export const SMALL_FILE_PATH_MISMATCH_LIMIT = 2;

export type EditPathMismatchState = {
  /** path → consecutive edit_mismatch count */
  counts: Map<string, number>;
  /** paths blocked until successful mutate */
  blocked: Set<string>;
  /** paths that qualified as small-file when last recorded / blocked */
  smallFiles: Set<string>;
  limit: number;
};

export function createEditPathMismatchState(
  limit: number = DEFAULT_PATH_MISMATCH_LIMIT,
): EditPathMismatchState {
  return {
    counts: new Map(),
    blocked: new Set(),
    smallFiles: new Set(),
    limit: Math.max(1, limit),
  };
}

/** Line count for rewrite-size decisions (handles CRLF / empty). */
export function countFileLines(content: string): number {
  if (!content) return 0;
  const n = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let lines = 1;
  for (let i = 0; i < n.length; i++) {
    if (n[i] === '\n') lines += 1;
  }
  // Trailing newline: last empty segment still counts as a line in editors;
  // "a\n" → 2 is fine for thresholding; empty → 0 already returned.
  return lines;
}

export function isSmallFileForRewrite(
  content: string,
  lineLimit: number = SMALL_FILE_LINE_LIMIT,
): boolean {
  const lines = countFileLines(content);
  return lines > 0 && lines <= lineLimit;
}

export type PathMismatchRecord = {
  count: number;
  blocked: boolean;
  limit: number;
  smallFile: boolean;
  lineCount: number;
};

export function recordPathEditMismatch(
  state: EditPathMismatchState | null | undefined,
  path: string,
  opts?: { content?: string },
): PathMismatchRecord {
  if (!state) {
    const lineCount =
      opts?.content !== undefined ? countFileLines(opts.content) : 0;
    const smallFile =
      opts?.content !== undefined && isSmallFileForRewrite(opts.content);
    return {
      count: 0,
      blocked: false,
      limit: smallFile
        ? SMALL_FILE_PATH_MISMATCH_LIMIT
        : DEFAULT_PATH_MISMATCH_LIMIT,
      smallFile,
      lineCount,
    };
  }
  const key = normalizeEditPath(path);
  const lineCount =
    opts?.content !== undefined ? countFileLines(opts.content) : 0;
  const smallFile =
    opts?.content !== undefined
      ? isSmallFileForRewrite(opts.content)
      : state.smallFiles.has(key);
  if (smallFile) state.smallFiles.add(key);

  const effectiveLimit = smallFile
    ? Math.min(state.limit, SMALL_FILE_PATH_MISMATCH_LIMIT)
    : state.limit;

  const count = (state.counts.get(key) ?? 0) + 1;
  state.counts.set(key, count);
  const blocked = count >= effectiveLimit;
  if (blocked) state.blocked.add(key);
  return {
    count,
    blocked,
    limit: effectiveLimit,
    smallFile,
    lineCount,
  };
}

export function clearPathEditMismatches(
  state: EditPathMismatchState | null | undefined,
  path: string,
): void {
  if (!state) return;
  const key = normalizeEditPath(path);
  state.counts.delete(key);
  state.blocked.delete(key);
  state.smallFiles.delete(key);
}

export function assertPathEditAllowed(
  state: EditPathMismatchState | null | undefined,
  path: string,
): void {
  if (!state) return;
  const key = normalizeEditPath(path);
  if (!state.blocked.has(key)) return;
  const count = state.counts.get(key) ?? state.limit;
  const small = state.smallFiles.has(key);
  throw new Error(
    [
      `[edit_mismatch] Path-level gate: ${count} consecutive edit mismatches on \`${path}\`.`,
      'edit_file / apply_patch are blocked on this path for the rest of the turn.',
      small
        ? `This file is ≤${SMALL_FILE_LINE_LIMIT} lines — use write_file now with the full updated contents (do not keep surgical-editing).`
        : 'Use write_file for a full rewrite of this file, or ask_user for guidance.',
      'Do not switch edit tools or retry surgical anchors on this path.',
    ].join(' '),
  );
}

export function pathMismatchGateMessage(opts: {
  path: string;
  count: number;
  limit: number;
  smallFile?: boolean;
  lineCount?: number;
}): string {
  const small = Boolean(opts.smallFile);
  const lines =
    opts.lineCount && opts.lineCount > 0 ? ` (${opts.lineCount} lines)` : '';
  if (small) {
    return [
      `[path_gate] ${opts.count}/${opts.limit} consecutive edit_mismatch on small file \`${opts.path}\`${lines}.`,
      opts.count >= opts.limit
        ? `Surgical edits blocked. Call write_file with the complete updated file (≤${SMALL_FILE_LINE_LIMIT}-line rewrite path).`
        : `After ${opts.limit} mismatches on files ≤${SMALL_FILE_LINE_LIMIT} lines, edit_file/apply_patch will be blocked — prefer write_file.`,
    ].join(' ');
  }
  return [
    `[path_gate] ${opts.count}/${opts.limit} consecutive edit_mismatch on \`${opts.path}\`.`,
    opts.count >= opts.limit
      ? 'Further edit_file/apply_patch on this path are blocked — use write_file or ask_user.'
      : `After ${opts.limit} mismatches, surgical edits on this path will be blocked.`,
  ].join(' ');
}
