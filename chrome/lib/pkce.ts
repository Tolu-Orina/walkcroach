/**
 * PKCE (RFC 7636) for the Chrome side panel's sign-in handoff.
 *
 * A separate implementation from `packages/agent-engine/src/pkce.ts` because MV3
 * has no `node:crypto`. WebCrypto's `digest` is async, which is why
 * `generatePkce()` here returns a promise and its callers in `auth.ts` had to
 * become async — the one behavioural difference between the surfaces.
 *
 * Chrome receives its code on `https://<extension-id>.chromiumapp.org/auth` via
 * `chrome.identity.launchWebAuthFlow`. That channel is better isolated than the
 * IDE's custom scheme or the CLI's loopback port, but the code is still a bearer
 * credential in a URL; proof-of-possession removes the value of intercepting it.
 */

export type PkcePair = {
  /** Secret. Held in `chrome.storage.session`; never sent to Web. */
  verifier: string;
  /** Public. Travels in the authorize URL. */
  challenge: string;
};

/** The only method we issue. `plain` provides no proof of possession. */
export const PKCE_METHOD = 'S256' as const;

/** 48 random bytes → 64 base64url chars, inside RFC 7636 §4.1's 43–128 range. */
const VERIFIER_BYTES = 48;

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** RFC 7636 §4.2 — BASE64URL(SHA256(ASCII(verifier))). */
export async function codeChallengeS256(verifier: string): Promise<string> {
  // The verifier is base64url, so every character is single-byte in UTF-8 and
  // this matches the ASCII encoding the other implementations use.
  const data = new TextEncoder().encode(verifier);
  return base64Url(await crypto.subtle.digest('SHA-256', data));
}

export async function generatePkce(): Promise<PkcePair> {
  const verifier = generateCodeVerifier();
  return { verifier, challenge: await codeChallengeS256(verifier) };
}
