import { describe, expect, it } from 'vitest';
import {
  assertPathEditAllowed,
  clearPathEditMismatches,
  countFileLines,
  createEditPathMismatchState,
  DEFAULT_PATH_MISMATCH_LIMIT,
  isSmallFileForRewrite,
  recordPathEditMismatch,
  SMALL_FILE_LINE_LIMIT,
  SMALL_FILE_PATH_MISMATCH_LIMIT,
} from './edit-path-mismatch-guard.js';

describe('edit-path-mismatch-guard', () => {
  it('blocks after DEFAULT_PATH_MISMATCH_LIMIT consecutive mismatches', () => {
    const state = createEditPathMismatchState();
    expect(DEFAULT_PATH_MISMATCH_LIMIT).toBe(3);
    // Large file content so small-file limit does not apply
    const large = `${'x\n'.repeat(SMALL_FILE_LINE_LIMIT + 10)}tail\n`;
    for (let i = 1; i <= 2; i++) {
      const r = recordPathEditMismatch(state, 'src/a.ts', { content: large });
      expect(r.blocked).toBe(false);
      expect(r.smallFile).toBe(false);
      expect(r.count).toBe(i);
      expect(() => assertPathEditAllowed(state, 'src/a.ts')).not.toThrow();
    }
    const third = recordPathEditMismatch(state, 'src/a.ts', { content: large });
    expect(third.blocked).toBe(true);
    expect(() => assertPathEditAllowed(state, 'src/a.ts')).toThrow(
      /Path-level gate/,
    );
  });

  it('blocks small files after SMALL_FILE_PATH_MISMATCH_LIMIT mismatches', () => {
    const state = createEditPathMismatchState();
    expect(SMALL_FILE_PATH_MISMATCH_LIMIT).toBe(2);
    const small = 'line1\nline2\nline3\n';
    expect(isSmallFileForRewrite(small)).toBe(true);
    expect(countFileLines(small)).toBeLessThanOrEqual(SMALL_FILE_LINE_LIMIT);

    const first = recordPathEditMismatch(state, 'SiteChrome.tsx', {
      content: small,
    });
    expect(first.blocked).toBe(false);
    expect(first.limit).toBe(2);
    expect(first.smallFile).toBe(true);

    const second = recordPathEditMismatch(state, 'SiteChrome.tsx', {
      content: small,
    });
    expect(second.blocked).toBe(true);
    expect(() => assertPathEditAllowed(state, 'SiteChrome.tsx')).toThrow(
      /≤400 lines/,
    );
  });

  it('normalizes path separators', () => {
    const state = createEditPathMismatchState(2);
    recordPathEditMismatch(state, 'blog\\a.tsx', { content: 'a\n' });
    recordPathEditMismatch(state, 'blog/a.tsx', { content: 'a\n' });
    expect(() => assertPathEditAllowed(state, 'blog/a.tsx')).toThrow(
      /Path-level gate/,
    );
  });

  it('clears on successful mutate', () => {
    const state = createEditPathMismatchState(1);
    recordPathEditMismatch(state, 'a.ts', { content: 'x\n' });
    expect(() => assertPathEditAllowed(state, 'a.ts')).toThrow();
    clearPathEditMismatches(state, 'a.ts');
    expect(() => assertPathEditAllowed(state, 'a.ts')).not.toThrow();
  });

  it('tracks paths independently', () => {
    const state = createEditPathMismatchState(1);
    recordPathEditMismatch(state, 'a.ts', { content: 'x\n' });
    expect(() => assertPathEditAllowed(state, 'b.ts')).not.toThrow();
  });
});
