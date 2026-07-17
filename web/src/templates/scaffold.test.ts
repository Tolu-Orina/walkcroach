import { describe, expect, it } from 'vitest';
import { safeProjectSlug } from './scaffold';

describe('safeProjectSlug', () => {
  it('strips unsafe characters', () => {
    expect(safeProjectSlug('My App! @#$')).toBe('My App');
  });

  it('falls back when empty after sanitization', () => {
    expect(safeProjectSlug('!!!')).toBe('app');
  });

  it('preserves hyphens and underscores', () => {
    expect(safeProjectSlug('todo-list_v2')).toBe('todo-list_v2');
  });
});
