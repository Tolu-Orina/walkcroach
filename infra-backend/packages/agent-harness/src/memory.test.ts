import { describe, expect, it } from 'vitest';
import { formatVector } from './memory.js';

describe('formatVector', () => {
  it('formats pgvector literal', () => {
    expect(formatVector([1, 2, 3])).toBe('[1,2,3]');
  });

  it('handles empty vector', () => {
    expect(formatVector([])).toBe('[]');
  });
});
