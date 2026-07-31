/**
 * The CLI redirect validator (C1.1d).
 *
 * This decides where the browser will hand off a one-time code that can be
 * exchanged for the user's Cognito tokens, so every case is a security case.
 * It must agree exactly with `isLoopbackRedirectUri` in the IDE BFF: the
 * browser check decides what gets navigated to, the server check decides what
 * gets minted, and a disagreement is a confusing sign-in failure at best.
 */
import { describe, expect, it } from 'vitest';
import { isCliRedirectUri } from './cliRedirectUri';

describe('isCliRedirectUri', () => {
  it('accepts a literal loopback address on a high port', () => {
    expect(isCliRedirectUri('http://127.0.0.1:49512/callback')).toBe(true);
    expect(isCliRedirectUri('http://[::1]:49512/callback')).toBe(true);
  });

  it('rejects a host that only looks like loopback', () => {
    expect(isCliRedirectUri('http://127.0.0.1.attacker.example/callback')).toBe(false);
    expect(isCliRedirectUri('http://127.0.0.1@attacker.example/callback')).toBe(false);
  });

  it('rejects localhost, which resolves through DNS', () => {
    expect(isCliRedirectUri('http://localhost:49512/callback')).toBe(false);
  });

  it('rejects a path other than /callback', () => {
    expect(isCliRedirectUri('http://127.0.0.1:49512/')).toBe(false);
    expect(isCliRedirectUri('http://127.0.0.1:49512/callbackx')).toBe(false);
  });

  it('rejects a redirect that arrives carrying its own query or fragment', () => {
    expect(isCliRedirectUri('http://127.0.0.1:49512/callback?next=x')).toBe(false);
    expect(isCliRedirectUri('http://127.0.0.1:49512/callback#x')).toBe(false);
  });

  it('rejects privileged ports and non-http schemes', () => {
    expect(isCliRedirectUri('http://127.0.0.1:80/callback')).toBe(false);
    expect(isCliRedirectUri('https://127.0.0.1:49512/callback')).toBe(false);
    expect(isCliRedirectUri('javascript:alert(1)')).toBe(false);
  });

  it('rejects an editor deep link, which belongs to the IDE page', () => {
    expect(isCliRedirectUri('vscode://walkcroach.walkcroach-ide/auth')).toBe(false);
  });

  it('rejects an empty or malformed value', () => {
    expect(isCliRedirectUri('')).toBe(false);
    expect(isCliRedirectUri('127.0.0.1:49512/callback')).toBe(false);
  });
});
