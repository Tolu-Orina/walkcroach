import { describe, expect, it } from 'vitest';
import { assertRateLimit, isUuid } from './util.js';

describe('assertRateLimit', () => {
  it('allows under the cap then blocks', () => {
    const key = `test:${Date.now()}`;
    expect(assertRateLimit(key, 2, 60_000)).toBeNull();
    expect(assertRateLimit(key, 2, 60_000)).toBeNull();
    expect(assertRateLimit(key, 2, 60_000)).toMatch(/rate limit/);
  });
});

describe('isUuid', () => {
  it('validates', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
