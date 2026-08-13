import { describe, expect, it } from 'vitest';
import { projectNumberFromClientId } from './projectNumberFromClientId';

describe('projectNumberFromClientId', () => {
  it('extracts numeric prefix from a standard OAuth web client id', () => {
    expect(
      projectNumberFromClientId(
        '123456789012-abcdefg.apps.googleusercontent.com',
      ),
    ).toBe('123456789012');
  });

  it('rejects non-numeric prefixes', () => {
    expect(projectNumberFromClientId('not-a-number-xyz.apps.googleusercontent.com')).toBeNull();
  });

  it('rejects empty', () => {
    expect(projectNumberFromClientId('')).toBeNull();
  });
});
