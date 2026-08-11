import { describe, expect, it } from 'vitest';
import { formatMemoryHitsText } from './memory-format.js';

describe('formatMemoryHitsText', () => {
  it('leads every hit with source_surface (P4 moat)', () => {
    const text = formatMemoryHitsText([
      {
        sourceSurface: 'chrome',
        kind: 'decision',
        text: 'Prefer Drizzle',
        relevance: 0.91,
      },
      { sourceSurface: 'web', kind: 'preference', text: 'Use UUID PKs' },
    ]);
    expect(text).toContain('[chrome · decision · 0.91] Prefer Drizzle');
    expect(text).toContain('[web · preference] Use UUID PKs');
  });

  it('handles empty hits', () => {
    expect(formatMemoryHitsText([])).toMatch(/no matching/i);
  });
});
