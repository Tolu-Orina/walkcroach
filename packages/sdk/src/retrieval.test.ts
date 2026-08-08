import { describe, expect, it } from 'vitest';
import type { RecallHit } from './types.js';
import {
  clampRecallLimit,
  formatHitsForPrompt,
  RECALL_LIMIT_DEFAULT,
  selectHitsForPrompt,
} from './retrieval.js';

function hit(text: string, kind = 'decision'): RecallHit {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: kind as RecallHit['kind'],
    text,
    surface: 'sdk',
    relevance: 0.9,
  };
}

describe('retrieval budget helpers', () => {
  it('clamps recall limits to the public window', () => {
    expect(clampRecallLimit(undefined)).toBe(RECALL_LIMIT_DEFAULT);
    expect(clampRecallLimit(0)).toBe(1);
    expect(clampRecallLimit(99)).toBe(20);
    expect(clampRecallLimit(3.7)).toBe(3);
  });

  it('selects by maxHits', () => {
    const hits = [hit('a'), hit('b'), hit('c')];
    expect(selectHitsForPrompt(hits, { maxHits: 2 }).map((h) => h.text)).toEqual([
      'a',
      'b',
    ]);
  });

  it('formats a prompt block', () => {
    const block = formatHitsForPrompt([hit('Chose Drizzle')], {
      budget: { maxHits: 1 },
    });
    expect(block).toContain('Project memory');
    expect(block).toContain('[decision] Chose Drizzle');
  });

  it('honours a soft char budget without dropping the first hit', () => {
    const selected = selectHitsForPrompt([hit('short'), hit('also short')], {
      maxHits: 5,
      maxChars: 40,
    });
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected[0]!.text).toBe('short');
  });
});
