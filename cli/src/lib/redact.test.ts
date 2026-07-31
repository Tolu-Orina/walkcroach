/**
 * Credential scrubbing (C0.7) — and the boundary of where it must not reach.
 */
import { describe, expect, it } from 'vitest';
import { REDACTED, redact, redactString } from './redact.js';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe('redactString', () => {
  it('scrubs a Cognito JWT out of an error message', () => {
    const out = redactString(`Token exchange failed for ${JWT} (401)`);
    expect(out).not.toContain(JWT);
    expect(out).toContain(REDACTED);
    expect(out).toContain('(401)');
  });

  it('scrubs an Authorization header echoed back by an API', () => {
    const out = redactString('sent headers: {authorization: Bearer abc.def-ghi}');
    expect(out).not.toContain('abc.def-ghi');
    expect(out).toContain(`Bearer ${REDACTED}`);
  });

  it('scrubs long-lived and session AWS key ids', () => {
    const out = redactString('creds AKIAIOSFODNN7EXAMPLE and ASIAIOSFODNN7EXAMPLE');
    expect(out).not.toMatch(/AKIA|ASIA/);
  });

  it('leaves ordinary text alone', () => {
    const text = 'Added src/health.ts and ran 12 tests in 4.1s';
    expect(redactString(text)).toBe(text);
  });
});

describe('redact', () => {
  it('replaces values under secret-sounding keys whatever they contain', () => {
    const out = redact({
      accessToken: 'plain-looking-value',
      refreshToken: 'another',
      apiKey: 'k',
      ownerId: 'user_123',
    });
    expect(out).toEqual({
      accessToken: REDACTED,
      refreshToken: REDACTED,
      apiKey: REDACTED,
      ownerId: 'user_123',
    });
  });

  it('preserves absence, so "not signed in" still reads as not signed in', () => {
    expect(redact({ token: null, secret: undefined })).toEqual({
      token: null,
      secret: undefined,
    });
  });

  it('keeps non-string values under a sensitive-sounding key', () => {
    // `hasApiKey: true` and a list of configured key *names* carry nothing to
    // leak. Blanking them would make `doctor` and `secrets list` useless
    // while protecting nothing.
    expect(
      redact({ hasApiKey: true, hasRefreshToken: false, tokenCount: 3 }),
    ).toEqual({ hasApiKey: true, hasRefreshToken: false, tokenCount: 3 });
  });

  it('still catches a real secret nested under a sensitive-sounding key', () => {
    const out = redact({
      secrets: [{ key: 'mcp.apiKey', accessToken: 'value-here' }],
    }) as any;
    expect(out.secrets[0].key).toBe('mcp.apiKey');
    expect(out.secrets[0].accessToken).toBe(REDACTED);
  });

  it('reaches into nested objects and arrays', () => {
    const out = redact({
      links: [{ name: 'repo', authorization: 'Bearer xyz' }],
      health: { ok: true, detail: `bad token ${JWT}` },
    }) as Record<string, any>;
    expect(out.links[0].authorization).toBe(REDACTED);
    expect(out.health.detail).not.toContain(JWT);
    expect(out.health.ok).toBe(true);
  });

  it('does not hang on a circular payload', () => {
    // Command payloads are assembled from API responses; a cycle here would
    // hang the process at exactly the moment it is trying to report an error.
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(redact(node)).toEqual({ name: 'root', self: '[circular]' });
  });

  it('keeps booleans and numbers as themselves', () => {
    expect(redact({ signedIn: true, linkCount: 2 })).toEqual({
      signedIn: true,
      linkCount: 2,
    });
  });

  it('leaves generated code containing a key-shaped literal intact', () => {
    // A string that merely *looks* like a key still gets scrubbed by pattern —
    // that is intended for our own output. What must not happen is redaction
    // reaching the agent's token stream, which is asserted in output.test.ts.
    const out = redactString('const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"');
    expect(out).toContain('const AWS_KEY =');
  });
});
