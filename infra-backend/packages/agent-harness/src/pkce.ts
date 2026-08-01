/**
 * Server-side PKCE (RFC 7636) verification for the WalkCroach authorization-code
 * handoff.
 *
 * ## Why this lives in agent-harness
 *
 * Two BFFs need it — `lambda-ide` (IDE + CLI) and `lambda-chrome` — and they are
 * separate npm workspaces. Those two duplicate `auth.ts` / `http.ts` / `util.ts`
 * between them, so duplication is the established pattern here; it is refused in
 * this one case because a constant-time comparison fixed in one copy and missed in
 * the other is precisely the kind of drift that turns a security control into
 * decoration. `@walkcroach/agent-harness` is the only package both already depend
 * on, which makes it the shared home despite this not being agent-runtime code.
 *
 * The client half (generation) lives in `packages/agent-engine/src/pkce.ts`; it
 * cannot be shared with this file because that package is bundled into the IDE
 * extension and the CLI, and this one runs in Lambda.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/** The only method issued or accepted. `plain` provides no proof of possession. */
export const PKCE_METHOD = 'S256' as const;

/** RFC 7636 §4.2 — BASE64URL(SHA256(ASCII(verifier))). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** RFC 7636 §4.1 — 43–128 characters from the unreserved set. */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidVerifierFormat(verifier: string): boolean {
  return VERIFIER_PATTERN.test(verifier);
}

/**
 * Constant-time check that `verifier` hashes to `expected`.
 *
 * Returns false rather than throwing on anything malformed, so every failure mode
 * — absent, wrong shape, wrong value — reaches the caller identically and can be
 * reported as a single undifferentiated `invalid_grant`. Telling an attacker
 * *which* part of their guess was wrong is a free oracle.
 */
export function verifyPkce(
  verifier: string | undefined,
  expectedChallenge: string | null | undefined,
  method: string | null | undefined,
): boolean {
  if (!verifier || !expectedChallenge) return false;
  if (method !== PKCE_METHOD) return false;
  if (!isValidVerifierFormat(verifier)) return false;

  const actual = Buffer.from(codeChallengeS256(verifier), 'utf8');
  const want = Buffer.from(expectedChallenge, 'utf8');
  // timingSafeEqual throws on unequal lengths; a length mismatch means the stored
  // challenge is malformed, which is a rejection either way.
  if (actual.length !== want.length) return false;
  return timingSafeEqual(actual, want);
}
