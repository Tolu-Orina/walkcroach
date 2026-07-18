import { describe, expect, it } from 'vitest';
import { isPathInsideWorkspace } from './CliHostAdapter.js';

describe('isPathInsideWorkspace', () => {
  it('returns true for paths inside workspace', () => {
    expect(isPathInsideWorkspace('/home/user/proj', '/home/user/proj/src/a.ts')).toBe(true);
    expect(isPathInsideWorkspace('/home/user/proj', '/home/user/proj')).toBe(true);
  });

  it('returns false for paths escaping workspace', () => {
    expect(isPathInsideWorkspace('/home/user/proj', '/home/user/other/a.ts')).toBe(false);
    expect(isPathInsideWorkspace('/home/user/proj', '/etc/passwd')).toBe(false);
  });

  it('handles relative traversal', () => {
    expect(
      isPathInsideWorkspace('/home/user/proj', '/home/user/proj/../other/a.ts'),
    ).toBe(false);
  });

  it('handles nested subdirectories', () => {
    expect(
      isPathInsideWorkspace('/workspace', '/workspace/src/deep/nested/file.ts'),
    ).toBe(true);
  });

  it('handles Windows-style paths on win32', () => {
    if (process.platform === 'win32') {
      expect(
        isPathInsideWorkspace('C:\\Users\\me\\proj', 'C:\\Users\\me\\proj\\src\\a.ts'),
      ).toBe(true);
      expect(
        isPathInsideWorkspace('C:\\Users\\me\\proj', 'D:\\other\\a.ts'),
      ).toBe(false);
    }
  });
});
