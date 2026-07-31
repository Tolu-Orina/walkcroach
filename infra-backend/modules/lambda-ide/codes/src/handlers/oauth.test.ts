/**
 * Redirect allowlist for the sign-in handoff.
 *
 * This decides where the BFF is willing to send a one-time code that can be
 * exchanged for a user's Cognito tokens, so every case below is a security
 * case. Two rules it exists to hold:
 *
 *  - the editor deep links keep working exactly as before (CLI work must not
 *    regress IDE sign-in — the same pattern is mirrored in Web);
 *  - loopback is accepted only as a literal address, never as something that
 *    merely reads like one.
 */
import { describe, expect, it } from 'vitest';
import { isAllowedRedirectUri, isLoopbackRedirectUri } from './oauth.js';

describe('editor redirects (unchanged by the CLI work)', () => {
  it('accepts every supported editor scheme', () => {
    for (const scheme of [
      'vscode',
      'cursor',
      'vscode-insiders',
      'vscodium',
      'windsurf',
      'code-oss',
    ]) {
      expect(
        isAllowedRedirectUri(`${scheme}://walkcroach.walkcroach-ide/auth`),
        scheme,
      ).toBe(true);
    }
  });

  it('still rejects an unknown scheme and a wrong path', () => {
    expect(isAllowedRedirectUri('evil://walkcroach.walkcroach-ide/auth')).toBe(false);
    expect(isAllowedRedirectUri('vscode://walkcroach.walkcroach-ide/steal')).toBe(false);
    expect(isAllowedRedirectUri('vscode://attacker.extension/auth')).toBe(false);
  });
});

describe('loopback redirects (CLI)', () => {
  it('accepts a literal IPv4 or IPv6 loopback with a high port', () => {
    expect(isLoopbackRedirectUri('http://127.0.0.1:49512/callback')).toBe(true);
    expect(isLoopbackRedirectUri('http://[::1]:49512/callback')).toBe(true);
  });

  it('rejects a host that only looks like loopback', () => {
    // The failure a naive prefix or regex check would wave through.
    expect(isLoopbackRedirectUri('http://127.0.0.1.attacker.example/callback')).toBe(false);
    expect(isLoopbackRedirectUri('http://127.0.0.1@attacker.example/callback')).toBe(false);
    expect(isLoopbackRedirectUri('http://attacker.example/127.0.0.1/callback')).toBe(false);
  });

  it('rejects localhost, which resolves through DNS', () => {
    expect(isLoopbackRedirectUri('http://localhost:49512/callback')).toBe(false);
  });

  it('rejects any other loopback-range address', () => {
    // Only the address the CLI actually binds is accepted.
    expect(isLoopbackRedirectUri('http://127.0.0.2:49512/callback')).toBe(false);
    expect(isLoopbackRedirectUri('http://0.0.0.0:49512/callback')).toBe(false);
  });

  it('rejects a path other than /callback', () => {
    expect(isLoopbackRedirectUri('http://127.0.0.1:49512/')).toBe(false);
    expect(isLoopbackRedirectUri('http://127.0.0.1:49512/callback/../x')).toBe(false);
    expect(isLoopbackRedirectUri('http://127.0.0.1:49512/callbackx')).toBe(false);
  });

  it('rejects a redirect carrying its own query or fragment', () => {
    // The CLI appends `?code&state`; a pre-loaded query would let a crafted
    // URI smuggle parameters past the exact-match check at exchange time.
    expect(isLoopbackRedirectUri('http://127.0.0.1:49512/callback?next=x')).toBe(false);
    expect(isLoopbackRedirectUri('http://127.0.0.1:49512/callback#x')).toBe(false);
  });

  it('rejects embedded credentials', () => {
    expect(isLoopbackRedirectUri('http://u:p@127.0.0.1:49512/callback')).toBe(false);
  });

  it('requires plain http on an unprivileged port', () => {
    expect(isLoopbackRedirectUri('https://127.0.0.1:49512/callback')).toBe(false);
    expect(isLoopbackRedirectUri('http://127.0.0.1/callback')).toBe(false);
    expect(isLoopbackRedirectUri('http://127.0.0.1:80/callback')).toBe(false);
    expect(isLoopbackRedirectUri('http://127.0.0.1:443/callback')).toBe(false);
  });

  it('rejects anything that is not a URL', () => {
    expect(isLoopbackRedirectUri('')).toBe(false);
    expect(isLoopbackRedirectUri('127.0.0.1:49512/callback')).toBe(false);
    expect(isLoopbackRedirectUri('javascript:alert(1)')).toBe(false);
  });
});
