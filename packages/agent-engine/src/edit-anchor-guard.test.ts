import { describe, expect, it } from 'vitest';
import {
  assertEditAnchorAllowed,
  clearEditAnchorsForPath,
  createEditAnchorFailCache,
  recordEditAnchorFailure,
} from './edit-anchor-guard.js';

describe('edit-anchor-guard', () => {
  it('refuses the same old_str after a recorded failure', () => {
    const cache = createEditAnchorFailCache();
    recordEditAnchorFailure(cache, 'a.css', ['color: red;']);
    expect(() =>
      assertEditAnchorAllowed(cache, 'a.css', ['color: red;']),
    ).toThrow(/Refused identical old_str/);
  });

  it('allows a different old_str on the same path', () => {
    const cache = createEditAnchorFailCache();
    recordEditAnchorFailure(cache, 'a.css', ['color: red;']);
    expect(() =>
      assertEditAnchorAllowed(cache, 'a.css', ['color: blue;']),
    ).not.toThrow();
  });

  it('does not clear failures on path alone without clearEditAnchorsForPath', () => {
    const cache = createEditAnchorFailCache();
    recordEditAnchorFailure(cache, 'blog/a.css', ['old']);
    // Re-read must NOT unlock — simulate by not calling clear.
    expect(() =>
      assertEditAnchorAllowed(cache, 'blog/a.css', ['old']),
    ).toThrow(/Re-reading alone does not unlock/);
  });

  it('clears failures after successful mutation clear', () => {
    const cache = createEditAnchorFailCache();
    recordEditAnchorFailure(cache, 'blog/a.css', ['old']);
    clearEditAnchorsForPath(cache, 'blog/a.css');
    expect(() =>
      assertEditAnchorAllowed(cache, 'blog/a.css', ['old']),
    ).not.toThrow();
  });

  it('normalizes path separators when matching', () => {
    const cache = createEditAnchorFailCache();
    recordEditAnchorFailure(cache, 'blog\\a.css', ['x']);
    expect(() =>
      assertEditAnchorAllowed(cache, 'blog/a.css', ['x']),
    ).toThrow(/Refused identical old_str/);
  });
});
