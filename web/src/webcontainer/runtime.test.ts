import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editFile, ensureDir, parseCmd, writeFile } from './runtime';

const fakeStore: Record<string, string> = {};

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((k: string) => fakeStore[k] ?? null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(() => {
  for (const k of Object.keys(fakeStore)) delete fakeStore[k];
  vi.restoreAllMocks();
});

describe('parseCmd', () => {
  it('splits simple command', () => {
    expect(parseCmd('npm install')).toEqual({ command: 'npm', args: ['install'] });
  });

  it('handles quoted arguments', () => {
    expect(parseCmd('echo "hello world"')).toEqual({
      command: 'echo',
      args: ['hello world'],
    });
  });

  it('handles single-word command', () => {
    expect(parseCmd('ls')).toEqual({ command: 'ls', args: [] });
  });

  it('trims whitespace', () => {
    expect(parseCmd('  git status  ')).toEqual({ command: 'git', args: ['status'] });
  });

  it('handles multiple args', () => {
    expect(parseCmd('npm run dev --host')).toEqual({
      command: 'npm',
      args: ['run', 'dev', '--host'],
    });
  });

  it('returns empty command for empty string', () => {
    expect(parseCmd('')).toEqual({ command: '', args: [] });
  });
});

describe('ensureDir', () => {
  it('creates parent directories', async () => {
    const mockWc = { fs: { mkdir: vi.fn() } };
    await ensureDir(mockWc as never, 'a/b/c/file.ts');
    expect(mockWc.fs.mkdir).toHaveBeenCalledWith('a');
    expect(mockWc.fs.mkdir).toHaveBeenCalledWith('a/b');
    expect(mockWc.fs.mkdir).toHaveBeenCalledWith('a/b/c');
  });

  it('ignores mkdir errors (dir exists)', async () => {
    const mockWc = { fs: { mkdir: vi.fn(async () => { throw new Error('EEXIST'); }) } };
    await ensureDir(mockWc as never, 'x/y.ts');
    expect(mockWc.fs.mkdir).toHaveBeenCalledWith('x');
  });

  it('does nothing for root-level file', async () => {
    const mockWc = { fs: { mkdir: vi.fn() } };
    await ensureDir(mockWc as never, 'file.ts');
    expect(mockWc.fs.mkdir).not.toHaveBeenCalled();
  });
});

describe('writeFile', () => {
  it('writes file after creating parent dirs', async () => {
    const mockWc = { fs: { mkdir: vi.fn(), writeFile: vi.fn() } };
    await writeFile(mockWc as never, 'src/utils/helpers.ts', 'export {}');
    expect(mockWc.fs.mkdir).toHaveBeenCalledWith('src');
    expect(mockWc.fs.mkdir).toHaveBeenCalledWith('src/utils');
    expect(mockWc.fs.writeFile).toHaveBeenCalledWith('src/utils/helpers.ts', 'export {}');
  });

  it('strips leading ./', async () => {
    const mockWc = { fs: { mkdir: vi.fn(), writeFile: vi.fn() } };
    await writeFile(mockWc as never, './src/x.ts', 'hi');
    expect(mockWc.fs.writeFile).toHaveBeenCalledWith('src/x.ts', 'hi');
  });
});

describe('editFile', () => {
  it('replaces old string with new string', async () => {
    const mockWc = {
      fs: {
        readFile: vi.fn(async () => '<h1>Hello</h1>'),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
      },
    };
    await editFile(mockWc as never, 'src/App.tsx', 'Hello', 'World');
    expect(mockWc.fs.writeFile).toHaveBeenCalledWith('src/App.tsx', '<h1>World</h1>');
  });

  it('throws when old string not found', async () => {
    const mockWc = {
      fs: {
        readFile: vi.fn(async () => '<h1>Hello</h1>'),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
      },
    };
    await expect(editFile(mockWc as never, 'src/App.tsx', 'Missing', 'X')).rejects.toThrow(
      'old_str not found',
    );
  });

  it('strips leading ./ from path', async () => {
    const mockWc = {
      fs: {
        readFile: vi.fn(async () => 'abc'),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
      },
    };
    await editFile(mockWc as never, './src/f.ts', 'abc', 'xyz');
    expect(mockWc.fs.readFile).toHaveBeenCalledWith('src/f.ts', 'utf-8');
  });
});
