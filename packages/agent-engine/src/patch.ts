/**
 * Multi-hunk search/replace patch apply (unique old_str per hunk, sequential).
 */

export type PatchEdit = {
  old_str: string;
  new_str: string;
};

export function normalizePatchEdits(raw: unknown): PatchEdit[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('apply_patch requires a non-empty edits array');
  }
  if (raw.length > 20) {
    throw new Error('apply_patch allows at most 20 edits');
  }
  const out: PatchEdit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each edit must be an object with old_str and new_str');
    }
    const row = item as Record<string, unknown>;
    const old_str = String(row.old_str ?? '');
    const new_str = String(row.new_str ?? '');
    if (!old_str) {
      throw new Error('Each edit requires a non-empty old_str');
    }
    out.push({ old_str, new_str });
  }
  return out;
}

/**
 * Apply sequential unique search/replace hunks. Throws if a hunk is missing or ambiguous.
 */
export function applyPatchEdits(
  content: string,
  edits: PatchEdit[],
): string {
  let next = content;
  for (let i = 0; i < edits.length; i++) {
    const { old_str, new_str } = edits[i]!;
    if (!next.includes(old_str)) {
      throw new Error(
        `apply_patch edit[${i}]: old_str not found (provide more unique context)`,
      );
    }
    const occurrences = next.split(old_str).length - 1;
    if (occurrences > 1) {
      throw new Error(
        `apply_patch edit[${i}]: old_str matches ${occurrences} locations (must be unique)`,
      );
    }
    next = next.replace(old_str, new_str);
  }
  return next;
}

/**
 * HostAdapter.applyDiff contract: treat `diff` as JSON-encoded edits array
 * or a single `old_str\n<<<<<<\nnew_str` pair. Prefer the tool's structured edits.
 */
export function applyDiffString(content: string, diff: string): string {
  const trimmed = diff.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    return applyPatchEdits(content, normalizePatchEdits(parsed));
  }
  const sep = '\n<<<<<<\n';
  const idx = trimmed.indexOf(sep);
  if (idx === -1) {
    throw new Error(
      'applyDiff expects JSON edits array or old_str\\n<<<<<<\\nnew_str',
    );
  }
  const old_str = trimmed.slice(0, idx);
  const new_str = trimmed.slice(idx + sep.length);
  return applyPatchEdits(content, [{ old_str, new_str }]);
}
