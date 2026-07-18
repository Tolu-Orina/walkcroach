import { describe, expect, it } from 'vitest';
import { normalizeChromePath } from './handlers/rest.js';

describe('Phase C routes (path normalize)', () => {
  it('strips /v1 prefix used by local BFF', () => {
    expect(normalizeChromePath('/v1/chrome/v1/me/projects')).toBe(
      '/chrome/v1/me/projects',
    );
    expect(
      normalizeChromePath('/v1/chrome/v1/workspaces/abc/link-project'),
    ).toBe('/chrome/v1/workspaces/abc/link-project');
  });
});
