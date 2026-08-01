/**
 * PKCE (RFC 7636) for the WalkCroach authorization-code handoff.
 *
 * This protects the code WalkCroach itself issues (`ide_auth_codes` /
 * `chrome_auth_codes`), not the Cognito sign-in behind it. Web signs in with
 * USER_PASSWORD_AUTH and never handles an authorization code, so it has no
 * verifier — its `/connect/*` pages only forward the challenge.
 *
 * Why it matters here: the IDE receives its code on a custom scheme
 * (`vscode://…/auth`) and the CLI on a loopback port. Both are local channels
 * another process on the machine can plausibly observe or race for. Without
 * proof-of-possession, a code seen in transit is a session. With it, the code is
 * useless to anyone who does not also hold the verifier — which never leaves this
 * process.
 *
 * Mirrors `generatePkce()` in `infra-backend/packages/connectors/src/oauth.ts`,
 * which does the same job for outbound provider OAuth. Kept as a separate copy
 * rather than shared because that package is backend-only and this one is bundled
 * into the IDE extension and the CLI.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type PkcePair = {
  /** Secret. Held in memory (CLI) or SecretStorage (IDE); never sent to Web. */
  verifier: string;
  /** Public. Travels in the authorize URL. */
  challenge: string;
};

/** The only method we issue or accept. `plain` provides no proof of possession. */
export const PKCE_METHOD = 'S256' as const;

/**
 * RFC 7636 §4.1 allows a 43–128 character verifier. 48 random bytes encodes to 64
 * base64url characters — comfortably inside the range, and matching the connectors
 * implementation so the two do not drift.
 */
const VERIFIER_BYTES = 48;

export function generateCodeVerifier(): string {
  return randomBytes(VERIFIER_BYTES).toString('base64url');
}

/** RFC 7636 §4.2 — BASE64URL(SHA256(ASCII(verifier))). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function generatePkce(): PkcePair {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: codeChallengeS256(verifier) };
}

/**
 * Constant-time challenge comparison, so a mismatch leaks nothing through timing.
 *
 * Length is compared first and in the clear: challenges are fixed-length public
 * values, so a length difference reveals only that the input was malformed, and
 * `timingSafeEqual` throws on unequal-length buffers rather than returning false.
 */
export function verifyChallenge(verifier: string, expected: string): boolean {
  if (!verifier || !expected) return false;
  const actual = Buffer.from(codeChallengeS256(verifier), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (actual.length !== want.length) return false;
  return timingSafeEqual(actual, want);
}
