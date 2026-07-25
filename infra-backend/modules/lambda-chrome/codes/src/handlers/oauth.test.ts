import { describe, it, expect } from 'vitest';
import { CHROME_REDIRECT_PATTERN } from './oauth.js';

describe('CHROME_REDIRECT_PATTERN', () => {
  it('accepts a valid chrome-extension auth.html URI', () => {
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/auth.html',
      ),
    ).toBe(true);
  });

  it('rejects non-extension schemes and wrong paths', () => {
    expect(
      CHROME_REDIRECT_PATTERN.test('https://evil.example/auth.html'),
    ).toBe(false);
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef/sidepanel.html',
      ),
    ).toBe(false);
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP/auth.html',
      ),
    ).toBe(false);
  });
});
