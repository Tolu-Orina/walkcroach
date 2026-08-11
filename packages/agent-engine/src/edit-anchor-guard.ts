/**
 * Reject identical edit/patch anchors after edit_mismatch until a *different*
 * old_str is tried or the path is successfully mutated. Switching edit_file ↔
 * apply_patch with the same old_str must not bypass this — that thrash burns
 * Bedrock turns without improving accuracy.
 *
 * Re-reading alone does NOT clear the fail cache (models otherwise re-submit
 * the same bad anchor after read_file).
 */
import { createHash } from 'node:crypto';

export type EditAnchorFailCache = {
  /** path → set of failed old_str hashes (and multi-hunk fingerprints). */
  byPath: Map<string, Set<string>>;
};

export function createEditAnchorFailCache(): EditAnchorFailCache {
  return { byPath: new Map() };
}

export function normalizeEditPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function hashEditAnchor(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 24);
}

function joinedAnchorHash(oldStrs: string[]): string {
  return hashEditAnchor(
    oldStrs.map((s) => s.replace(/\r\n/g, '\n')).join('\n---\n'),
  );
}

/** Single-hunk or joined multi-hunk fingerprint for a path. */
export function editAnchorFingerprint(
  path: string,
  oldStrs: string[],
): string {
  const joined = oldStrs.map((s) => s.replace(/\r\n/g, '\n')).join('\n---\n');
  return `${normalizeEditPath(path)}|${hashEditAnchor(joined)}`;
}

export function recordEditAnchorFailure(
  cache: EditAnchorFailCache | null | undefined,
  path: string,
  oldStrs: string[],
): void {
  if (!cache || oldStrs.length === 0) return;
  const key = normalizeEditPath(path);
  const set = cache.byPath.get(key) ?? new Set<string>();
  set.add(joinedAnchorHash(oldStrs));
  cache.byPath.set(key, set);
}

/**
 * Clear failed anchors for a path after a successful mutation (or explicit reset).
 * Do not call on read_file — re-read must not unlock the same bad old_str.
 */
export function clearEditAnchorsForPath(
  cache: EditAnchorFailCache | null | undefined,
  path: string,
): void {
  if (!cache) return;
  cache.byPath.delete(normalizeEditPath(path));
}

export function assertEditAnchorAllowed(
  cache: EditAnchorFailCache | null | undefined,
  path: string,
  oldStrs: string[],
): void {
  if (!cache || oldStrs.length === 0) return;
  const key = normalizeEditPath(path);
  const set = cache.byPath.get(key);
  if (!set?.size) return;
  const hash = joinedAnchorHash(oldStrs);
  if (!set.has(hash)) return;
  throw new Error(
    [
      `[edit_mismatch] Refused identical old_str retry on \`${path}\`.`,
      'Copy a NEW old_str verbatim from the file excerpt (3–5 unique surrounding lines).',
      'Re-reading alone does not unlock this hash.',
      'Do not resubmit the same old_str, and do not switch edit_file ↔ apply_patch with the same anchors.',
    ].join(' '),
  );
}

/** Extract old_str anchors from edit_file / apply_patch tool input. */
export function oldStrsFromEditInput(
  toolName: string,
  input: Record<string, unknown>,
): { path: string; oldStrs: string[] } | null {
  const path = String(input.path ?? '').trim();
  if (!path) return null;
  if (toolName === 'edit_file') {
    const old_str = String(input.old_str ?? '');
    return old_str ? { path, oldStrs: [old_str] } : null;
  }
  if (toolName === 'apply_patch') {
    const edits = input.edits;
    if (!Array.isArray(edits)) return null;
    const oldStrs: string[] = [];
    for (const row of edits) {
      if (!row || typeof row !== 'object') continue;
      const o = String((row as { old_str?: unknown }).old_str ?? '');
      if (o) oldStrs.push(o);
    }
    return oldStrs.length ? { path, oldStrs } : null;
  }
  return null;
}
