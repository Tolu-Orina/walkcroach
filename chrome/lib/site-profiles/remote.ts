import { API_BASE } from '../api';
import { installProfiles, SITE_PROFILES, type SiteProfilesBundle } from './matcher';
import { validateProfilesBundle } from './schema';

/**
 * Remote-updatable site profiles (Phase D6).
 *
 * Profiles are copy and match patterns — the label on a button, which hosts count
 * as a job board. Freezing them into the extension package means a one-word fix
 * waits for a Chrome Web Store review. This fetches a newer bundle from our own
 * BFF, and applies it only if an Ed25519 signature verifies against a public key
 * baked into the build.
 *
 * Three properties make this safe to ship in an extension:
 *
 *  - **Data, not code.** The bundle is JSON describing matches and labels.
 *    Nothing is evaluated, so this is outside the CWS remote-code policy.
 *  - **Signed.** A compromised CDN or a MITM cannot introduce profiles; the
 *    private key never leaves Secrets Manager.
 *  - **Fail-closed to the package.** Any failure — offline, bad signature,
 *    malformed schema, no key configured — silently keeps the bundled profiles.
 *    A profile update is never load-bearing for the panel working.
 */

declare const __WALKCROACH_PROFILES_PUBLIC_KEY__: string;

/** Base64 raw Ed25519 public key, empty until signing keys are provisioned. */
export const PROFILES_PUBLIC_KEY =
  typeof __WALKCROACH_PROFILES_PUBLIC_KEY__ !== 'undefined'
    ? __WALKCROACH_PROFILES_PUBLIC_KEY__
    : '';

const CACHE_KEY = 'wc_profiles_cache_v1';
export const PROFILES_TTL_MS = 12 * 60 * 60 * 1000;

export type SignedProfiles = {
  /** The exact JSON text that was signed. Parsed only after verification. */
  bundle: string;
  /** Base64 Ed25519 signature over the UTF-8 bytes of `bundle`. */
  signature: string;
};

type CachedProfiles = {
  bundle: SiteProfilesBundle;
  fetchedAt: number;
};

/**
 * Backed by an explicit `ArrayBuffer` rather than the default allocation, so the
 * result satisfies `BufferSource` — `Uint8Array<ArrayBufferLike>` does not, and
 * WebCrypto will not accept it.
 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Verify the signature over the exact bytes the server signed.
 *
 * The server sends the bundle as a *string* and signs that string, so there is no
 * canonical-JSON problem: key order and whitespace cannot drift between signing
 * and verification because the same bytes are used for both.
 */
export async function verifyBundleSignature(
  bundleJson: string,
  signatureB64: string,
  publicKeyB64: string = PROFILES_PUBLIC_KEY,
): Promise<boolean> {
  if (!publicKeyB64 || !signatureB64) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      base64ToBytes(publicKeyB64),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      base64ToBytes(signatureB64),
      new TextEncoder().encode(bundleJson),
    );
  } catch {
    // Unsupported algorithm, malformed key, or bad base64 — all untrusted.
    return false;
  }
}

/**
 * Validate and accept a signed payload. Exported for testing without a network.
 * Returns the bundle only if it verifies, parses, validates, and is newer.
 */
export async function acceptSignedProfiles(
  payload: SignedProfiles,
  currentVersion: number,
  publicKeyB64: string = PROFILES_PUBLIC_KEY,
): Promise<SiteProfilesBundle | null> {
  if (typeof payload?.bundle !== 'string') return null;
  const ok = await verifyBundleSignature(
    payload.bundle,
    payload.signature,
    publicKeyB64,
  );
  if (!ok) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.bundle);
  } catch {
    return null;
  }
  const bundle = validateProfilesBundle(parsed);
  if (!bundle) return null;
  // Never move backwards: a replayed older signed bundle must not downgrade.
  if (bundle.version <= currentVersion) return null;
  return bundle;
}

async function readCache(): Promise<CachedProfiles | null> {
  try {
    const raw = await chrome.storage.local.get(CACHE_KEY);
    const entry = raw[CACHE_KEY] as CachedProfiles | undefined;
    if (!entry?.bundle) return null;
    // Re-validate on read: cached data has been at rest and is not more trusted
    // than the network for having been stored.
    const bundle = validateProfilesBundle(entry.bundle);
    if (!bundle) return null;
    return { bundle, fetchedAt: entry.fetchedAt ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Apply the newest profiles we already hold, then refresh in the background.
 *
 * Synchronous match paths keep working throughout: `installProfiles` swaps the
 * active bundle in place, and until it is called the packaged profiles are live.
 */
export async function initProfiles(now = Date.now()): Promise<SiteProfilesBundle> {
  const cached = await readCache();
  if (cached && cached.bundle.version > SITE_PROFILES.version) {
    installProfiles(cached.bundle);
  }
  const active = cached?.bundle ?? SITE_PROFILES;

  if (!cached || now - cached.fetchedAt > PROFILES_TTL_MS) {
    // Deliberately not awaited: a profile refresh must never delay first paint.
    void refreshProfiles(now).catch(() => undefined);
  }
  return active;
}

export async function refreshProfiles(
  now = Date.now(),
): Promise<SiteProfilesBundle | null> {
  if (!PROFILES_PUBLIC_KEY) return null;
  try {
    const base = API_BASE.replace(/\/$/, '');
    const res = await fetch(`${base}/chrome/v1/site-profiles`);
    if (!res.ok) return null;
    const payload = (await res.json()) as SignedProfiles;

    const current = await readCache();
    const currentVersion = Math.max(
      SITE_PROFILES.version,
      current?.bundle.version ?? 0,
    );
    const bundle = await acceptSignedProfiles(payload, currentVersion);
    if (!bundle) return null;

    await chrome.storage.local.set({
      [CACHE_KEY]: { bundle, fetchedAt: now } satisfies CachedProfiles,
    });
    installProfiles(bundle);
    return bundle;
  } catch {
    return null;
  }
}
