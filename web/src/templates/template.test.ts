import { describe, expect, it } from 'vitest';
import { templateTree } from './template';

describe('templateTree', () => {
  it('returns a file system tree for a known template', () => {
    const tree = templateTree('todo', 'My Todo');
    expect(tree['package.json']).toBeDefined();
    const src = tree.src as { directory: Record<string, unknown> };
    expect(src.directory['App.tsx']).toBeDefined();
  });

  it('falls back to blank for unknown template', () => {
    const tree = templateTree('unknown-id', 'Fallback');
    expect(tree['package.json']).toBeDefined();
  });

  it('falls back to blank for null', () => {
    const tree = templateTree(null, 'Null');
    expect(tree['package.json']).toBeDefined();
  });
});
