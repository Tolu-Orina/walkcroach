/**
 * Flattening a template tree onto disk (C3.1).
 *
 * The browser mounts the nested shape; the CLI writes files. Everything about
 * `create` being faithful to the web builder rests on these two views coming
 * from the same definition.
 */
import { describe, expect, it } from 'vitest';
import { materialise, isFileNode, type FileTree } from './tree.js';
import { TEMPLATES, getTemplate, DEFAULT_TEMPLATE_ID } from './index.js';

describe('materialise', () => {
  it('flattens nested directories into relative paths', () => {
    const tree: FileTree = {
      'package.json': { file: { contents: '{}' } },
      src: {
        directory: {
          'App.tsx': { file: { contents: 'app' } },
          lib: { directory: { 'util.ts': { file: { contents: 'util' } } } },
        },
      },
    };
    expect(materialise(tree)).toEqual([
      { path: 'package.json', contents: '{}' },
      { path: 'src/App.tsx', contents: 'app' },
      { path: 'src/lib/util.ts', contents: 'util' },
    ]);
  });

  it('uses forward slashes on every platform', () => {
    // These become paths under a project root; Node accepts `/` on Windows,
    // and a backslash here would corrupt the path on POSIX.
    const tree: FileTree = { a: { directory: { b: { file: { contents: '' } } } } };
    expect(materialise(tree)[0]!.path).toBe('a/b');
  });

  it('returns nothing for an empty tree rather than throwing', () => {
    expect(materialise({})).toEqual([]);
  });

  it('preserves contents byte for byte', () => {
    const contents = 'line1\n  indented\n\ttab\r\nend\n';
    const out = materialise({ 'f.txt': { file: { contents } } });
    expect(out[0]!.contents).toBe(contents);
  });
});

describe('isFileNode', () => {
  it('distinguishes files from directories', () => {
    expect(isFileNode({ file: { contents: '' } })).toBe(true);
    expect(isFileNode({ directory: {} })).toBe(false);
  });
});

describe('the shared catalogue', () => {
  it('gives every template a unique id, name and description', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.name, t.id).toBeTruthy();
      expect(t.description, t.id).toBeTruthy();
      expect(t.examplePrompts.length, t.id).toBeGreaterThan(0);
    }
  });

  it('builds a runnable project shape for every template', () => {
    // What the CLI relies on: whichever template someone picks, the same four
    // files exist, so `npm install && npm run build` works without special
    // cases per template.
    for (const template of TEMPLATES) {
      const files = materialise(template.buildTree('My Project'));
      const paths = files.map((f) => f.path);
      for (const required of ['package.json', 'vite.config.ts', 'index.html', 'src/App.tsx']) {
        expect(paths, `${template.id} is missing ${required}`).toContain(required);
      }
      const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.contents);
      expect(pkg.scripts.build, template.id).toBeTruthy();
    }
  });

  it('names the package after the project, safely', () => {
    const files = materialise(getTemplate('blank').buildTree('My App!! <script>'));
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.contents);
    // Punctuation dropped, spaces to dashes, lowercased — a valid npm name.
    expect(pkg.name).toBe('my-app-script');
  });

  it('falls back to the default template for an unknown id', () => {
    expect(getTemplate('does-not-exist').id).toBe(DEFAULT_TEMPLATE_ID);
    expect(getTemplate(null).id).toBe(DEFAULT_TEMPLATE_ID);
  });
});
