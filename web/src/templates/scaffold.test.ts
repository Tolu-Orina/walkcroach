import { describe, expect, it } from 'vitest';
import { safeProjectSlug, viteScaffold } from './scaffold';

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

  it('trims leading/trailing whitespace', () => {
    expect(safeProjectSlug('  hello  ')).toBe('hello');
  });
});

describe('viteScaffold', () => {
  const tree = viteScaffold('Test App', '<div>App</div>');

  it('creates package.json at root', () => {
    expect(tree['package.json']).toBeDefined();
    const pkg = tree['package.json'] as { file: { contents: string } };
    const parsed = JSON.parse(pkg.file.contents);
    expect(parsed.name).toBe('test-app');
    expect(parsed.dependencies.react).toBeDefined();
  });

  it('creates vite.config.ts', () => {
    expect(tree['vite.config.ts']).toBeDefined();
  });

  it('creates tsconfig.json', () => {
    expect(tree['tsconfig.json']).toBeDefined();
  });

  it('creates index.html with project name as title', () => {
    const html = tree['index.html'] as { file: { contents: string } };
    expect(html.file.contents).toContain('<title>Test App</title>');
  });

  it('creates src directory with App.tsx, main.tsx, index.css, wc-bridge.ts', () => {
    const src = tree.src as { directory: Record<string, unknown> };
    expect(src.directory['App.tsx']).toBeDefined();
    expect(src.directory['main.tsx']).toBeDefined();
    expect(src.directory['index.css']).toBeDefined();
    expect(src.directory['wc-bridge.ts']).toBeDefined();
  });

  it('App.tsx contains passed content', () => {
    const src = tree.src as { directory: Record<string, { file: { contents: string } }> };
    expect(src.directory['App.tsx'].file.contents).toBe('<div>App</div>');
  });

  it('creates lib directory with db.ts and walkcroach.ts', () => {
    const src = tree.src as { directory: Record<string, { directory: Record<string, unknown> }> };
    expect(src.directory.lib.directory['db.ts']).toBeDefined();
    expect(src.directory.lib.directory['walkcroach.ts']).toBeDefined();
  });

  it('applies custom indexCss', () => {
    const custom = viteScaffold('X', '<div/>', 'body { margin: 0 }');
    const src = custom.src as { directory: Record<string, { file: { contents: string } }> };
    expect(src.directory['index.css'].file.contents).toBe('body { margin: 0 }');
  });

  it('lowercases and hyphenates package name', () => {
    const t = viteScaffold('My Cool App', '<div/>');
    const pkg = t['package.json'] as { file: { contents: string } };
    const parsed = JSON.parse(pkg.file.contents);
    expect(parsed.name).toBe('my-cool-app');
  });
});
