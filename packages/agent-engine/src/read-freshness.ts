/**
 * Stale-read / content-aware freshness (OpenDev + Claude Code / OpenCode lessons).
 *
 * - Track mtime (when host supports it) **and** content hash on every successful read.
 * - Autosave/format that bumps mtime without changing bytes → allow (hash match).
 * - Content changed + edit/patch with unique old_str still matching → allow with note.
 * - Content changed + write_file overwrite → reject with fresh excerpt.
 * - Rejects update the tracker to current bytes so the next attempt is not stuck.
 */

import { createHash } from 'node:crypto';

export const DEFAULT_MTIME_TOLERANCE_MS = 50;
/** Cap excerpt attached to reject errors (OpenCode-style recovery). */
export const FRESHNESS_EXCERPT_MAX_CHARS = 6_000;

export type FreshnessSnapshot = {
  mtimeMs: number | null;
  contentHash: string;
};

export type ReadFreshnessTracker = {
  lastRead: Map<string, FreshnessSnapshot>;
  /**
   * @deprecated Prefer lastRead — kept for callers that only inspected mtimes.
   * Synced on every record.
   */
  lastReadMtimeMs: Map<string, number>;
  toleranceMs: number;
};

export function createReadFreshnessTracker(
  toleranceMs: number = DEFAULT_MTIME_TOLERANCE_MS,
): ReadFreshnessTracker {
  return {
    lastRead: new Map(),
    lastReadMtimeMs: new Map(),
    toleranceMs: Math.max(0, toleranceMs),
  };
}

export function normalizeFreshnessPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function hashFileContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export type RecordFreshnessInput = {
  content: string;
  mtimeMs?: number | null;
};

/**
 * Record freshness after a successful read or mutation.
 * Pass `content` always; `mtimeMs` when the host can supply it.
 */
export function recordReadFreshness(
  tracker: ReadFreshnessTracker,
  path: string,
  input: RecordFreshnessInput | number,
): void {
  const key = normalizeFreshnessPath(path);
  if (typeof input === 'number') {
    // Legacy: mtime-only record (no hash) — incomplete; prefer content form.
    const snap: FreshnessSnapshot = {
      mtimeMs: input,
      contentHash: '',
    };
    tracker.lastRead.set(key, snap);
    tracker.lastReadMtimeMs.set(key, input);
    return;
  }
  const mtimeMs = input.mtimeMs ?? null;
  const snap: FreshnessSnapshot = {
    mtimeMs,
    contentHash: hashFileContent(input.content),
  };
  tracker.lastRead.set(key, snap);
  if (mtimeMs !== null && Number.isFinite(mtimeMs)) {
    tracker.lastReadMtimeMs.set(key, mtimeMs);
  }
}

export type StaleReadCheck =
  | { ok: true; note?: string }
  | { ok: false; message: string };

/**
 * Legacy mtime-only assert (kept for unit tests / simple hosts).
 * Prefer {@link evaluateMutationFreshness} for mutations.
 */
export function assertFreshForWrite(
  tracker: ReadFreshnessTracker,
  path: string,
  currentMtimeMs: number | null,
): StaleReadCheck {
  const key = normalizeFreshnessPath(path);
  const last = tracker.lastRead.get(key);
  const lastMtime =
    last?.mtimeMs ?? tracker.lastReadMtimeMs.get(key) ?? undefined;
  if (lastMtime === undefined && !last) {
    return { ok: true };
  }
  if (currentMtimeMs === null) {
    return {
      ok: false,
      message: [
        `Stale-read guard: \`${path}\` is missing after it was read.`,
        'Re-read (or confirm delete) before writing.',
      ].join(' '),
    };
  }
  const baseline = lastMtime ?? 0;
  if (currentMtimeMs > baseline + tracker.toleranceMs) {
    return {
      ok: false,
      message: [
        `Stale-read guard: \`${path}\` changed on disk since the last read`,
        `(mtime ${currentMtimeMs} > read ${baseline} + ${tracker.toleranceMs}ms tolerance).`,
        'Re-read the file, then retry the edit.',
      ].join(' '),
    };
  }
  return { ok: true };
}

export type MutationKind = 'write_file' | 'edit_file' | 'apply_patch';

export type EvaluateMutationFreshnessParams = {
  tracker: ReadFreshnessTracker;
  path: string;
  /** Current file bytes; null if missing. */
  currentContent: string | null;
  currentMtimeMs?: number | null;
  kind: MutationKind;
  oldStr?: string;
  oldStrs?: string[];
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function allOldStrsUnique(
  content: string,
  strs: string[],
): { ok: true } | { ok: false; reason: string } {
  for (const [i, s] of strs.entries()) {
    const n = countOccurrences(content, s);
    if (n === 0) {
      return {
        ok: false,
        reason: strs.length > 1 ? `hunk[${i}] old_str not found` : 'old_str not found',
      };
    }
    if (n > 1) {
      return {
        ok: false,
        reason:
          strs.length > 1
            ? `hunk[${i}] old_str matches ${n} locations`
            : `old_str matches ${n} locations`,
      };
    }
  }
  return { ok: true };
}

export function formatFreshnessExcerpt(
  path: string,
  content: string,
  maxChars = FRESHNESS_EXCERPT_MAX_CHARS,
): string {
  const body =
    content.length <= maxChars
      ? content
      : `${content.slice(0, maxChars)}\n…[truncated ${content.length - maxChars} chars]`;
  return [
    `--- current contents of ${path} ---`,
    body,
    `--- end ${path} ---`,
  ].join('\n');
}

function rejectMessage(opts: {
  path: string;
  detail: string;
  content: string | null;
}): string {
  const anchor =
    'Re-read the file, then retry with 3–5 lines of unique surrounding context in old_str (do not guess indentation). Prefer apply_patch for multi-site edits.';
  const parts = [`[stale_read] \`${opts.path}\` ${opts.detail}`, anchor];
  if (opts.content !== null) {
    parts.push(formatFreshnessExcerpt(opts.path, opts.content));
  }
  return parts.join('\n');
}

/**
 * Content-aware mutation gate. Call after reading current file bytes.
 * On reject, caller should {@link recordReadFreshness} with current content
 * so the next attempt is not stuck on a dead snapshot.
 */
export function evaluateMutationFreshness(
  params: EvaluateMutationFreshnessParams,
): StaleReadCheck {
  const key = normalizeFreshnessPath(params.path);
  const last = params.tracker.lastRead.get(key);

  if (!last) {
    return { ok: true };
  }

  if (params.currentContent === null) {
    return {
      ok: false,
      message: rejectMessage({
        path: params.path,
        detail: 'is missing after it was read.',
        content: null,
      }),
    };
  }

  const currentHash = hashFileContent(params.currentContent);

  if (last.contentHash && last.contentHash === currentHash) {
    return { ok: true };
  }

  // Legacy mtime-only snapshot (empty hash): fall back to mtime when available.
  if (!last.contentHash) {
    const mtime = params.currentMtimeMs ?? null;
    if (last.mtimeMs !== null && mtime !== null) {
      if (mtime <= last.mtimeMs + params.tracker.toleranceMs) {
        return { ok: true };
      }
      return {
        ok: false,
        message: rejectMessage({
          path: params.path,
          detail: 'mtime moved since last read (legacy tracker without content hash).',
          content: params.currentContent,
        }),
      };
    }
    return { ok: true };
  }

  if (params.kind === 'write_file') {
    return {
      ok: false,
      message: rejectMessage({
        path: params.path,
        detail:
          'changed since the last read. Full overwrite refused — re-read first, then write_file or use edit_file/apply_patch.',
        content: params.currentContent,
      }),
    };
  }

  const strs =
    params.oldStrs ??
    (params.oldStr !== undefined ? [params.oldStr] : []);
  if (strs.length === 0) {
    return {
      ok: false,
      message: rejectMessage({
        path: params.path,
        detail: 'changed since the last read.',
        content: params.currentContent,
      }),
    };
  }

  const match = allOldStrsUnique(params.currentContent, strs);
  if (match.ok) {
    return {
      ok: true,
      note: `File \`${params.path}\` changed externally since last read; old_str still matched uniquely — applying against current contents.`,
    };
  }

  return {
    ok: false,
    message: rejectMessage({
      path: params.path,
      detail: `changed since the last read (${match.reason}).`,
      content: params.currentContent,
    }),
  };
}

/** Build a rich edit_mismatch error with excerpt + anchor guidance. */
export function formatEditMismatchError(opts: {
  path: string;
  reason: string;
  content: string;
}): string {
  return [
    `[edit_mismatch] ${opts.reason}`,
    'Re-read if needed. Include 3–5 lines of unique surrounding context in old_str; do not guess whitespace. Prefer apply_patch for several sites in one file. Do not retry the identical old_str.',
    formatFreshnessExcerpt(opts.path, opts.content),
  ].join('\n');
}
