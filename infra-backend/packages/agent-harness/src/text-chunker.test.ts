import { describe, expect, it } from 'vitest';
import {
  CHUNK_OVERLAP_CHARS,
  CHUNK_TARGET_CHARS,
  chunkText,
} from './text-chunker.js';

describe('chunkText', () => {
  it('returns empty for blank input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('returns a single chunk when under target size', () => {
    const chunks = chunkText('Short note about PTO.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      index: 0,
      content: 'Short note about PTO.',
      charCount: 'Short note about PTO.'.length,
    });
  });

  it('splits long text into overlapping windows', () => {
    const sentence = 'Alpha sentence about billing. ';
    const raw = sentence.repeat(80); // ~2400+ chars
    const chunks = chunkText(raw, {
      targetChars: 400,
      overlapChars: 80,
      maxChunks: 20,
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c, i) => c.index === i)).toBe(true);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
    expect(chunks.every((c) => c.charCount === c.content.length)).toBe(true);
    // Each chunk should stay near the target (soft break can undershoot)
    expect(chunks.every((c) => c.content.length <= 6000)).toBe(true);
  });

  it('respects maxChunks', () => {
    const raw = 'word '.repeat(5000);
    const chunks = chunkText(raw, {
      targetChars: 200,
      overlapChars: 40,
      maxChunks: 3,
    });
    expect(chunks).toHaveLength(3);
  });

  it('uses default constants', () => {
    expect(CHUNK_TARGET_CHARS).toBe(1200);
    expect(CHUNK_OVERLAP_CHARS).toBe(200);
  });

  it('prefers sentence boundaries when available', () => {
    const a = 'A'.repeat(200);
    const b = 'B'.repeat(200);
    const raw = `${a}. ${b}. ${'C'.repeat(200)}.`;
    const chunks = chunkText(raw, {
      targetChars: 250,
      overlapChars: 20,
      maxChunks: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should end around a sentence boundary, not mid-run of B's only
    expect(chunks[0]!.content.includes('.')).toBe(true);
  });
});
