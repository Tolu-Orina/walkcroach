import { describe, expect, it } from 'vitest';
import {
  applyPatchEdits,
  applyUniqueReplace,
  findUniqueOldStrSpan,
  oldStrMatchesUniquely,
} from './patch.js';

describe('applyUniqueReplace cascade', () => {
  it('prefers exact match', () => {
    const content = '  foo\n  bar\n';
    expect(applyUniqueReplace(content, '  foo\n', '  baz\n')).toBe('  baz\n  bar\n');
    expect(findUniqueOldStrSpan(content, '  foo\n')?.strategy).toBe('exact');
  });

  it('matches LF needle against CRLF file', () => {
    const content = 'line1\r\nline2\r\nline3\r\n';
    const after = applyUniqueReplace(content, 'line2\n', 'LINE2\n');
    expect(after).toBe('line1\r\nLINE2\r\nline3\r\n');
    expect(findUniqueOldStrSpan(content, 'line2\n')?.strategy).toBe('crlf');
  });

  it('matches when trailing whitespace differs (trim_end)', () => {
    const content = 'alpha  \nbeta\n';
    const after = applyUniqueReplace(content, 'alpha\n', 'ALPHA\n');
    expect(after).toBe('ALPHA\nbeta\n');
    expect(findUniqueOldStrSpan(content, 'alpha\n')?.strategy).toBe('trim_end');
  });

  it('matches when indentation differs (trim_all) and preserves file indent outside span', () => {
    const content = [
      'export function SiteChrome() {',
      '    return (',
      '        <footer />',
      '    );',
      '}',
    ].join('\n');
    // Model guessed 2-space indent; file uses 4.
    const oldStr = [
      '  return (',
      '    <footer />',
      '  );',
    ].join('\n');
    const newStr = [
      '    return (',
      '        <footer aria-label="site" />',
      '    );',
    ].join('\n');
    const after = applyUniqueReplace(content, oldStr, newStr);
    expect(after).toContain('<footer aria-label="site" />');
    expect(after).toContain('export function SiteChrome()');
    expect(findUniqueOldStrSpan(content, oldStr)?.strategy).toBe('trim_all');
  });

  it('splices original file bytes on fuzzy match (does not rewrite unmatched neighbors)', () => {
    const content = '\tkeep\n\tchange me\n\tkeep2\n';
    const after = applyUniqueReplace(content, 'change me', 'changed');
    expect(after).toBe('\tkeep\n\tchanged\n\tkeep2\n');
  });

  it('rejects ambiguous exact matches', () => {
    expect(() => applyUniqueReplace('x x', 'x', 'y')).toThrow(/unique/);
  });

  it('rejects when nothing matches', () => {
    expect(() => applyUniqueReplace('abc', 'zzz', 'y')).toThrow(/not found/);
  });

  it('oldStrMatchesUniquely mirrors findUniqueOldStrSpan', () => {
    expect(oldStrMatchesUniquely('  a  \n', 'a\n')).toBe(true);
    expect(oldStrMatchesUniquely('ab', 'z')).toBe(false);
  });
});

describe('applyPatchEdits', () => {
  it('applies sequential fuzzy hunks', () => {
    const before = '  aaa  \nbbb\n  ccc\n';
    const after = applyPatchEdits(before, [
      { old_str: 'aaa\n', new_str: 'AAA\n' },
      { old_str: 'ccc', new_str: 'CCC' },
    ]);
    expect(after).toBe('  AAA\nbbb\n  CCC\n');
  });
});
