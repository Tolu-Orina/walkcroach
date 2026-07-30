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

describe('CHROME_REDIRECT_PATTERN — launchWebAuthFlow (Phase B2)', () => {
  it('accepts the chromiumapp.org redirect for a valid extension ID', () => {
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth',
      ),
    ).toBe(true);
  });

  it('still binds the redirect to a well-formed extension ID', () => {
    // An attacker must not be able to point a one-time connect code anywhere.
    expect(
      CHROME_REDIRECT_PATTERN.test('https://evil.chromiumapp.org/auth'),
    ).toBe(false);
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'https://abcdefghijklmnopqrstuvwxyzabcdef.chromiumapp.org/auth',
      ),
    ).toBe(false);
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'https://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP.chromiumapp.org/auth',
      ),
    ).toBe(false);
  });

  it('rejects look-alike hosts and extra path segments', () => {
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org.evil.test/auth',
      ),
    ).toBe(false);
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth/../x',
      ),
    ).toBe(false);
    expect(
      CHROME_REDIRECT_PATTERN.test(
        'http://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/auth',
      ),
    ).toBe(false);
  });
});
