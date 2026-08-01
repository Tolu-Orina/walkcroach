import { describe, expect, it } from 'vitest';
import {
  generatePkce,
  generateCodeVerifier,
  codeChallengeS256,
  PKCE_METHOD,
} from './pkce';

/**
 * RFC 7636 Appendix B. Pinned here as well as in the engine and the harness
 * because this is a *separate* WebCrypto implementation — MV3 has no
 * `node:crypto` — and the three must agree byte for byte or Chrome sign-in
 * fails against a server that is behaving correctly.
 */
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('codeChallengeS256 (WebCrypto)', () => {
  it('matches the RFC 7636 Appendix B vector, so it agrees with the engine', async () => {
    await expect(codeChallengeS256(RFC_VERIFIER)).resolves.toBe(RFC_CHALLENGE);
  });

  it('produces base64url with no padding', async () => {
    await expect(codeChallengeS256('abc')).resolves.toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is deterministic', async () => {
    const [a, b] = await Promise.all([
      codeChallengeS256('abc'),
      codeChallengeS256('abc'),
    ]);
    expect(a).toBe(b);
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
  it('returns a challenge derived from its own verifier', async () => {
    const { verifier, challenge } = await generatePkce();
    await expect(codeChallengeS256(verifier)).resolves.toBe(challenge);
  });

  it('never returns the verifier as the challenge', async () => {
    const { verifier, challenge } = await generatePkce();
    expect(challenge).not.toBe(verifier);
  });
});

describe('PKCE_METHOD', () => {
  it('is S256', () => {
    expect(PKCE_METHOD).toBe('S256');
  });
});
