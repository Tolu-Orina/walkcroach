import { describe, expect, it } from 'vitest';
import { ideRedirectUri, jwtExpiresInSeconds } from './session.js';

describe('ideRedirectUri', () => {
  it('uses vscode scheme by default from mock', () => {
    expect(ideRedirectUri()).toBe('vscode://walkcroach.walkcroach-ide/auth');
  });

  it('builds cursor deep link when scheme is cursor', () => {
    expect(ideRedirectUri('cursor')).toBe(
      'cursor://walkcroach.walkcroach-ide/auth',
    );
  });

  it('supports vscode-insiders', () => {
    expect(ideRedirectUri('vscode-insiders')).toBe(
      'vscode-insiders://walkcroach.walkcroach-ide/auth',
    );
  });
});

describe('jwtExpiresInSeconds', () => {
  it('reads exp from an unsigned JWT payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    const token = `hdr.${payload}.sig`;
    const secs = jwtExpiresInSeconds(token);
    expect(secs).toBeGreaterThan(3500);
    expect(secs).toBeLessThanOrEqual(3600);
  });

  it('returns undefined for garbage', () => {
    expect(jwtExpiresInSeconds('not-a-jwt')).toBeUndefined();
  });
});
