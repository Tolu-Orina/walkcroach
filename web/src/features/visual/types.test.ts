import { describe, expect, it } from 'vitest';
import { filePathFromWcPath } from './types';

describe('filePathFromWcPath', () => {
  it('returns full path when no hash', () => {
    expect(filePathFromWcPath('src/App.tsx')).toBe('src/App.tsx');
  });

  it('strips from hash onwards', () => {
    expect(filePathFromWcPath('src/App.tsx:#title')).toBe('src/App.tsx:');
  });

  it('strips from first hash onwards', () => {
    expect(filePathFromWcPath('src/App.tsx#title')).toBe('src/App.tsx');
  });

  it('returns empty string for hash-only path', () => {
    expect(filePathFromWcPath('#fragment')).toBe('');
  });
});
