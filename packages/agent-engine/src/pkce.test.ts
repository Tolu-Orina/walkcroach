import { describe, expect, it } from 'vitest';
import {
  generatePkce,
  generateCodeVerifier,
  codeChallengeS256,
  verifyChallenge,
  PKCE_METHOD,
} from './pkce.js';

/**
 * RFC 7636 Appendix B is the normative worked example. Pinning it means a future
 * "harmless" change — utf8 instead of ascii, base64 instead of base64url, a
 * different hash — fails here rather than silently producing challenges the
 * server will reject (or, worse, accept from the wrong verifier).
 */
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('codeChallengeS256', () => {
  it('matches the RFC 7636 Appendix B vector', () => {
    expect(codeChallengeS256(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
  });

  it('is deterministic', () => {
    expect(codeChallengeS256('abc')).toBe(codeChallengeS256('abc'));
  });

  it('produces base64url with no padding', () => {
    expect(codeChallengeS256('abc')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('changes completely for a one-character difference', () => {
    expect(codeChallengeS256('abc')).not.toBe(codeChallengeS256('abd'));
  });
});

describe('generateCodeVerifier', () => {
  it('stays inside the RFC 7636 length range', () => {
    const v = generateCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
  });

  it('uses only unreserved characters', () => {
    expect(generateCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateCodeVerifier()));
    expect(seen.size).toBe(50);
  });
});

describe('generatePkce', () => {
  it('returns a challenge derived from its own verifier', () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(codeChallengeS256(verifier));
  });

  it('never returns the verifier as the challenge', () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).not.toBe(verifier);
  });
});

describe('verifyChallenge', () => {
  it('accepts the matching verifier', () => {
    expect(verifyChallenge(RFC_VERIFIER, RFC_CHALLENGE)).toBe(true);
  });

  it('rejects a different verifier', () => {
    expect(verifyChallenge(generateCodeVerifier(), RFC_CHALLENGE)).toBe(false);
  });

  it('rejects the challenge replayed as the verifier', () => {
    // The exact attack PKCE exists to stop: someone who saw only the authorize
    // URL holds the challenge, not the verifier.
    expect(verifyChallenge(RFC_CHALLENGE, RFC_CHALLENGE)).toBe(false);
  });

  it('rejects empty input rather than treating it as a match', () => {
    expect(verifyChallenge('', RFC_CHALLENGE)).toBe(false);
    expect(verifyChallenge(RFC_VERIFIER, '')).toBe(false);
  });

  it('rejects a length mismatch without throwing', () => {
    // timingSafeEqual throws on unequal buffers; the guard must catch it first.
    expect(() => verifyChallenge(RFC_VERIFIER, 'short')).not.toThrow();
    expect(verifyChallenge(RFC_VERIFIER, 'short')).toBe(false);
  });
});

describe('PKCE_METHOD', () => {
  it('is S256 — plain offers no proof of possession', () => {
    expect(PKCE_METHOD).toBe('S256');
  });
});
