import { describe, expect, it, vi } from 'vitest';
import { applyProjectFiles, listProjectFiles, type ProjectFile } from './files';

function makeMockWc(fileMap: Record<string, string>) {
  const dirs: Record<string, Array<{ name: string; isDirectory: () => boolean }>> = {};

  for (const path of Object.keys(fileMap)) {
    const parts = path.split('/');
    const fileName = parts.pop()!;
    const dir = parts.length ? parts.join('/') : '.';
    if (!dirs[dir]) dirs[dir] = [];
    dirs[dir].push({ name: fileName, isDirectory: () => false });
  }

  return {
    fs: {
      readdir: vi.fn(async (dir: string, _opts?: unknown) => {
        return dirs[dir] ?? [];
      }),
      readFile: vi.fn(async (path: string) => {
        if (path in fileMap) return fileMap[path];
        throw new Error('ENOENT');
      }),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
    },
  } as unknown;
}

describe('listProjectFiles', () => {
  it('returns files from root directory', async () => {
    const wc = makeMockWc({
      'index.ts': 'export {}',
      'app.tsx': '<App/>',
    });
    const files = await listProjectFiles(wc as never);
    expect(files).toHaveLength(2);
    expect(files.map((f: ProjectFile) => f.path).sort()).toEqual(['app.tsx', 'index.ts']);
  });

  it('recurses into subdirectories', async () => {
    const mockWc = {
      fs: {
        readdir: vi.fn(async (dir: string) => {
          if (dir === '.') {
            return [
              { name: 'src', isDirectory: () => true },
              { name: 'readme.md', isDirectory: () => false },
            ];
          }
          if (dir === 'src') {
            return [{ name: 'main.ts', isDirectory: () => false }];
          }
          return [];
        }),
        readFile: vi.fn(async (path: string) => `content-${path}`),
      },
    };
    const files = await listProjectFiles(mockWc as never);
    expect(files).toHaveLength(2);
    expect(files.find((f: ProjectFile) => f.path === 'src/main.ts')).toBeDefined();
  });

  it('skips node_modules', async () => {
    const mockWc = {
      fs: {
        readdir: vi.fn(async (dir: string) => {
          if (dir === '.') {
            return [
              { name: 'node_modules', isDirectory: () => true },
              { name: 'app.ts', isDirectory: () => false },
            ];
          }
          return [];
        }),
        readFile: vi.fn(async () => 'content'),
      },
    };
    const files = await listProjectFiles(mockWc as never);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('app.ts');
  });

  it('returns empty array when readdir fails', async () => {
    const mockWc = {
      fs: {
        readdir: vi.fn(async () => {
          throw new Error('ENOENT');
        }),
      },
    };
    const files = await listProjectFiles(mockWc as never);
    expect(files).toEqual([]);
  });

  it('skips unreadable files', async () => {
    const mockWc = {
      fs: {
        readdir: vi.fn(async () => [
          { name: 'ok.ts', isDirectory: () => false },
          { name: 'bad.bin', isDirectory: () => false },
        ]),
        readFile: vi.fn(async (path: string) => {
          if (path === 'bad.bin') throw new Error('ENOENT');
          return 'content';
        }),
      },
    };
    const files = await listProjectFiles(mockWc as never);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('ok.ts');
  });
});

describe('applyProjectFiles', () => {
  it('writes files and creates directories', async () => {
    const mockWc = {
      fs: {
        mkdir: vi.fn(),
        writeFile: vi.fn(),
      },
    };
    const files: ProjectFile[] = [
      { path: 'src/components/Button.tsx', content: '<button/>' },
      { path: 'readme.md', content: '# Hi' },
    ];
    await applyProjectFiles(mockWc as never, files);
    expect(mockWc.fs.writeFile).toHaveBeenCalledTimes(2);
    expect(mockWc.fs.writeFile).toHaveBeenCalledWith(
      'src/components/Button.tsx',
      '<button/>',
    );
    expect(mockWc.fs.mkdir).toHaveBeenCalled();
  });

  it('strips leading ./ from paths', async () => {
    const mockWc = { fs: { mkdir: vi.fn(), writeFile: vi.fn() } };
    await applyProjectFiles(mockWc as never, [
      { path: './src/index.ts', content: 'x' },
    ]);
    expect(mockWc.fs.writeFile).toHaveBeenCalledWith('src/index.ts', 'x');
  });

  it('handles mkdir errors (existing dirs) gracefully', async () => {
    const mockWc = {
      fs: {
        mkdir: vi.fn(async () => {
          throw new Error('EEXIST');
        }),
        writeFile: vi.fn(),
      },
    };
    await applyProjectFiles(mockWc as never, [
      { path: 'a/b/c.ts', content: 'ok' },
    ]);
    expect(mockWc.fs.writeFile).toHaveBeenCalledWith('a/b/c.ts', 'ok');
  });
});
