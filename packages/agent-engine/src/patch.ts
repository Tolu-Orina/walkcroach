/**
 * Multi-hunk search/replace with cascading match (exact → CRLF → trim-end → trim-all).
 * Fuzzy strategies locate a unique span in the *original* file bytes and splice
 * `new_str` over that span — never rewrite matched lines with whitespace-normalized
 * copies (avoids Codex-style indent corruption on context lines).
 */

export type PatchEdit = {
  old_str: string;
  new_str: string;
};

export type MatchStrategy = 'exact' | 'crlf' | 'trim_end' | 'trim_all';

export type UniqueMatch = {
  start: number;
  end: number;
  strategy: MatchStrategy;
};

type LinePart = { text: string; eol: string };

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

function countExact(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/** Split into lines; `eol` is '' | '\n' | '\r\n' (or lone '\r'). */
export function splitLineParts(s: string): LinePart[] {
  if (s.length === 0) return [{ text: '', eol: '' }];
  const out: LinePart[] = [];
  let i = 0;
  while (i < s.length) {
    const n = s.indexOf('\n', i);
    const r = s.indexOf('\r', i);
    if (n === -1 && r === -1) {
      out.push({ text: s.slice(i), eol: '' });
      break;
    }
    if (n !== -1 && (r === -1 || n <= r)) {
      // ...\n or ...\r\n (when \r immediately before \n)
      if (n > i && s[n - 1] === '\r') {
        out.push({ text: s.slice(i, n - 1), eol: '\r\n' });
      } else {
        out.push({ text: s.slice(i, n), eol: '\n' });
      }
      i = n + 1;
      continue;
    }
    // Lone \r (old Mac)
    out.push({ text: s.slice(i, r), eol: '\r' });
    i = r + 1;
  }
  return out;
}

function lineOffset(lines: LinePart[], index: number): number {
  let o = 0;
  for (let i = 0; i < index; i++) {
    o += lines[i]!.text.length + lines[i]!.eol.length;
  }
  return o;
}

function matchSpanEnd(
  lines: LinePart[],
  start: number,
  needle: LinePart[],
): number {
  let end = lineOffset(lines, start);
  for (let i = 0; i < needle.length; i++) {
    const line = lines[start + i]!;
    end += line.text.length;
    const needleEol = needle[i]!.eol;
    // Include this line's EOL when the needle also carried an EOL here
    // (always true for non-final needle lines; final only if needle ended with NL).
    if (needleEol) {
      end += line.eol.length;
    } else if (i < needle.length - 1) {
      end += line.eol.length;
    }
  }
  return end;
}

function normalizeForMode(
  text: string,
  mode: 'exact' | 'trim_end' | 'trim_all',
): string {
  if (mode === 'exact') return text;
  if (mode === 'trim_end') return text.replace(/[ \t]+$/u, '');
  return text.trim();
}

/**
 * Find all start line indices where needle lines match under `mode`.
 * Compares line *text* only (EOL style ignored at this stage).
 */
function findLineStarts(
  hay: LinePart[],
  needle: LinePart[],
  mode: 'exact' | 'trim_end' | 'trim_all',
): number[] {
  if (needle.length === 0 || needle.length > hay.length) return [];
  const starts: number[] = [];
  const max = hay.length - needle.length;
  for (let i = 0; i <= max; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (
        normalizeForMode(hay[i + j]!.text, mode) !==
        normalizeForMode(needle[j]!.text, mode)
      ) {
        ok = false;
        break;
      }
    }
    if (ok) starts.push(i);
  }
  return starts;
}

function uniqueSpanFromStarts(
  content: string,
  oldStr: string,
  starts: number[],
  strategy: MatchStrategy,
): UniqueMatch | 'ambiguous' | null {
  if (starts.length === 0) return null;
  if (starts.length > 1) return 'ambiguous';
  const hay = splitLineParts(content);
  const needle = splitLineParts(oldStr);
  const start = lineOffset(hay, starts[0]!);
  const end = matchSpanEnd(hay, starts[0]!, needle);
  if (start >= end && oldStr.length > 0) return null;
  return { start, end, strategy };
}

/**
 * Locate a unique span for `oldStr` using cascading strategies.
 * Returns null if not found; throws if ambiguous under the winning strategy.
 */
export function findUniqueOldStrSpan(
  content: string,
  oldStr: string,
): UniqueMatch | null {
  if (!oldStr) {
    throw new Error('old_str must be non-empty');
  }

  // 1. Exact byte match
  const exact = countExact(content, oldStr);
  if (exact === 1) {
    const start = content.indexOf(oldStr);
    return { start, end: start + oldStr.length, strategy: 'exact' };
  }
  if (exact > 1) {
    throw new Error(
      `old_str matches ${exact} locations (must be unique)`,
    );
  }

  // 2. CRLF ↔ LF dual-try (still exact on the converted needle)
  const lf = oldStr.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  for (const [candidate, strategy] of [
    [lf, 'crlf'] as const,
    [crlf, 'crlf'] as const,
  ]) {
    if (candidate === oldStr) continue;
    const n = countExact(content, candidate);
    if (n === 1) {
      const start = content.indexOf(candidate);
      return { start, end: start + candidate.length, strategy };
    }
    if (n > 1) {
      throw new Error(
        `old_str matches ${n} locations after newline normalization (must be unique)`,
      );
    }
  }

  const hay = splitLineParts(content);
  const needle = splitLineParts(oldStr);

  // 3. Line-wise trim trailing whitespace
  const trimEndStarts = findLineStarts(hay, needle, 'trim_end');
  const trimEnd = uniqueSpanFromStarts(
    content,
    oldStr,
    trimEndStarts,
    'trim_end',
  );
  if (trimEnd === 'ambiguous') {
    throw new Error(
      `old_str matches ${trimEndStarts.length} locations with trailing-whitespace tolerance (must be unique)`,
    );
  }
  if (trimEnd) return trimEnd;

  // 4. Line-wise trim both sides (indent-flexible locate; splice original bytes)
  const trimAllStarts = findLineStarts(hay, needle, 'trim_all');
  const trimAll = uniqueSpanFromStarts(
    content,
    oldStr,
    trimAllStarts,
    'trim_all',
  );
  if (trimAll === 'ambiguous') {
    throw new Error(
      `old_str matches ${trimAllStarts.length} locations with whitespace tolerance (must be unique)`,
    );
  }
  if (trimAll) return trimAll;

  return null;
}

/** True when cascading match finds exactly one span (for stale-read allow). */
export function oldStrMatchesUniquely(
  content: string,
  oldStr: string,
): boolean {
  try {
    return findUniqueOldStrSpan(content, oldStr) !== null;
  } catch {
    return false;
  }
}

/**
 * Replace a unique old_str with new_str. Throws if missing or ambiguous.
 * Fuzzy strategies splice the original file span; indent/EOL are aligned to
 * the matched file bytes so model whitespace drift does not corrupt neighbors.
 */
export function applyUniqueReplace(
  content: string,
  oldStr: string,
  newStr: string,
): string {
  const match = findUniqueOldStrSpan(content, oldStr);
  if (!match) {
    throw new Error('old_str not found (provide more unique context)');
  }
  const replacement = adaptReplacement(content, match, newStr);
  return content.slice(0, match.start) + replacement + content.slice(match.end);
}

function dominantEol(span: string): '\r\n' | '\n' | '\r' | '' {
  if (span.includes('\r\n')) return '\r\n';
  if (span.includes('\r') && !span.includes('\n')) return '\r';
  if (span.includes('\n')) return '\n';
  return '';
}

function adaptEolToSpan(text: string, span: string): string {
  const eol = dominantEol(span);
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (eol === '\r\n') return normalized.replace(/\n/g, '\r\n');
  if (eol === '\r') return normalized.replace(/\n/g, '\r');
  return normalized;
}

/**
 * Align replacement to the matched file span:
 * - crlf: normalize new_str newlines to the span's EOL
 * - trim_*: same line count → keep each file line's leading indent + EOL;
 *   different line count → EOL-adapt only (structural edit)
 */
function adaptReplacement(
  content: string,
  match: UniqueMatch,
  newStr: string,
): string {
  const span = content.slice(match.start, match.end);
  if (match.strategy === 'exact') {
    return newStr;
  }
  if (match.strategy === 'crlf') {
    return adaptEolToSpan(newStr, span);
  }

  const fileLines = splitLineParts(span);
  const newLines = splitLineParts(newStr);
  if (fileLines.length !== newLines.length) {
    return adaptEolToSpan(newStr, span);
  }

  let out = '';
  for (let i = 0; i < fileLines.length; i++) {
    const fileLine = fileLines[i]!;
    const newLine = newLines[i]!;
    const lead = /^[ \t]*/u.exec(fileLine.text)?.[0] ?? '';
    const core = newLine.text.trim();
    out += lead + core;
    if (fileLine.eol) {
      out += fileLine.eol;
    } else if (newLine.eol) {
      const eol = dominantEol(span) || newLine.eol;
      out += eol === '\r\n' || eol === '\r' || eol === '\n' ? eol : newLine.eol;
    }
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
    try {
      next = applyUniqueReplace(next, old_str, new_str);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`apply_patch edit[${i}]: ${msg}`);
    }
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
