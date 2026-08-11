import { describe, expect, it } from 'vitest';
import {
  findNearestAnchors,
  formatNearestAnchorHints,
  levenshteinRatio,
  normalizeAnchorText,
} from './nearest-anchor.js';
import { formatEditMismatchError } from './read-freshness.js';

describe('nearest-anchor', () => {
  it('normalizeAnchorText collapses whitespace', () => {
    expect(normalizeAnchorText('  foo \t bar  \n')).toBe('foo bar');
  });

  it('levenshteinRatio is 1 for equal strings', () => {
    expect(levenshteinRatio('abc', 'abc')).toBe(1);
    expect(levenshteinRatio('abc', 'xyz')).toBeLessThan(0.5);
  });

  it('finds nearest window for a near-miss old_str', () => {
    const content = [
      'import React from "react";',
      'export function SiteChrome() {',
      '  return (',
      '    <footer className="site-footer">',
      '      <p>© WalkCroach</p>',
      '    </footer>',
      '  );',
      '}',
    ].join('\n');
    const oldStr = [
      '  return (',
      '    <footer className="site-foot">',
      '      <p>© WalkCroach</p>',
      '    </footer>',
      '  );',
    ].join('\n');
    const hits = findNearestAnchors(content, oldStr);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toContain('site-footer');
    expect(hits[0]!.score).toBeGreaterThan(0.5);
  });

  it('formatNearestAnchorHints includes candidate markers', () => {
    const hints = formatNearestAnchorHints([
      {
        startLine: 2,
        endLine: 4,
        text: 'a\nb\nc',
        score: 0.81,
      },
    ]);
    expect(hints).toMatch(/candidate 1/);
    expect(hints).toContain('a\nb\nc');
  });

  it('formatEditMismatchError embeds nearest anchors when oldStr given', () => {
    const content = 'alpha\nbeta line here\ngamma\n';
    const msg = formatEditMismatchError({
      path: 'a.ts',
      reason: 'old_str not found',
      content,
      oldStr: 'beta line her',
    });
    expect(msg).toMatch(/Nearest anchors/);
    expect(msg).toMatch(/beta line here/);
  });
});
