import { describe, expect, it, vi } from 'vitest';
import { applyInlineTextEdit, readProjectFile } from './inlineEdit';

function makeMockWc(files: Record<string, string>) {
  return {
    fs: {
      readFile: vi.fn(async (path: string) => {
        if (path in files) return files[path];
        throw new Error('ENOENT');
      }),
      writeFile: vi.fn(),
    },
  };
}

describe('readProjectFile', () => {
  it('reads and returns file content', async () => {
    const wc = makeMockWc({ 'src/App.tsx': '<div>Hello</div>' });
    const result = await readProjectFile(wc as never, 'src/App.tsx');
    expect(result).toBe('<div>Hello</div>');
  });

  it('strips leading ./ from path', async () => {
    const wc = makeMockWc({ 'src/App.tsx': 'content' });
    await readProjectFile(wc as never, './src/App.tsx');
    expect(wc.fs.readFile).toHaveBeenCalledWith('src/App.tsx', 'utf-8');
  });
});

describe('applyInlineTextEdit', () => {
  it('replaces text in file (wcPath without colon)', async () => {
    const wc = makeMockWc({ 'src/App.tsx': '<h1>Hello</h1>' });
    await applyInlineTextEdit(wc as never, 'src/App.tsx#title', 'Hello', 'World');
    expect(wc.fs.writeFile).toHaveBeenCalledWith('src/App.tsx', '<h1>World</h1>');
  });

  it('throws when old text not found', async () => {
    const wc = makeMockWc({ 'src/App.tsx': '<h1>Hello</h1>' });
    await expect(
      applyInlineTextEdit(wc as never, 'src/App.tsx#title', 'Missing', 'X'),
    ).rejects.toThrow('Text not found');
  });

  it('throws when text appears multiple times', async () => {
    const wc = makeMockWc({ 'src/App.tsx': '<p>Hi</p><p>Hi</p>' });
    await expect(
      applyInlineTextEdit(wc as never, 'src/App.tsx#x', 'Hi', 'Bye'),
    ).rejects.toThrow('appears 2 times');
  });

  it('strips leading ./ from wcPath file portion', async () => {
    const wc = makeMockWc({ 'src/App.tsx': '<div>X</div>' });
    await applyInlineTextEdit(wc as never, './src/App.tsx#id', 'X', 'Y');
    expect(wc.fs.readFile).toHaveBeenCalledWith('src/App.tsx', 'utf-8');
  });
});
