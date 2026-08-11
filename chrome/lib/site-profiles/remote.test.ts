import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { acceptSignedProfiles, verifyBundleSignature } from './remote';
import { validateProfilesBundle } from './schema';
import { SITE_PROFILES } from './matcher';

/**
 * Signs with Node's crypto exactly as `scripts/sign-profiles.mjs` does, and
 * verifies with the WebCrypto path the extension uses — so this exercises the
 * real interop, not a mock of it.
 */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const der = publicKey.export({ type: 'spki', format: 'der' });
const PUBLIC_B64 = Buffer.from(der.subarray(der.length - 32)).toString('base64');

function signBundle(bundleJson: string): string {
  return nodeSign(null, Buffer.from(bundleJson, 'utf8'), privateKey).toString(
    'base64',
  );
}

const newer = () =>
  JSON.stringify({
    version: SITE_PROFILES.version + 1,
    profiles: [
      {
        id: 'remote-jobs',
        sector: 'recruiting',
        label: 'Extract candidate summary',
        actionId: 'extract_candidate',
        captureType: 'candidate',
        defaultWorkspace: 'Hiring',
        match: { hostSuffix: ['newboard.test'], pathIncludes: ['/cv/'] },
        fields: ['name', 'role'],
      },
    ],
  });

beforeEach(() => {
  globalThis.chrome = {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
  } as unknown as typeof chrome;
});

describe('verifyBundleSignature', () => {
  it('accepts a signature produced by the signing script', async () => {
    const bundle = newer();
    await expect(
      verifyBundleSignature(bundle, signBundle(bundle), PUBLIC_B64),
    ).resolves.toBe(true);
  });

  it('rejects a bundle altered after signing', async () => {
    const bundle = newer();
    const signature = signBundle(bundle);
    const tampered = bundle.replace('newboard.test', 'evil.test');
    await expect(
      verifyBundleSignature(tampered, signature, PUBLIC_B64),
    ).resolves.toBe(false);
  });

  it('rejects a signature from a different key', async () => {
    const other = generateKeyPairSync('ed25519');
    const bundle = newer();
    const foreign = nodeSign(
      null,
      Buffer.from(bundle, 'utf8'),
      other.privateKey,
    ).toString('base64');
    await expect(
      verifyBundleSignature(bundle, foreign, PUBLIC_B64),
    ).resolves.toBe(false);
  });

  it('refuses to verify when no public key is configured', async () => {
    // A build without a key must never accept a remote bundle.
    const bundle = newer();
    await expect(
      verifyBundleSignature(bundle, signBundle(bundle), ''),
    ).resolves.toBe(false);
  });

  it('returns false rather than throwing on malformed input', async () => {
    await expect(verifyBundleSignature('{}', 'not-base64!!', PUBLIC_B64)).resolves.toBe(false);
    await expect(verifyBundleSignature('{}', '', PUBLIC_B64)).resolves.toBe(false);
  });
});

describe('acceptSignedProfiles', () => {
  it('accepts a correctly signed, newer, valid bundle', async () => {
    const bundle = newer();
    const out = await acceptSignedProfiles(
      { bundle, signature: signBundle(bundle) },
      SITE_PROFILES.version,
      PUBLIC_B64,
    );
    expect(out?.profiles[0]?.id).toBe('remote-jobs');
  });

  it('refuses an unsigned payload', async () => {
    const bundle = newer();
    await expect(
      acceptSignedProfiles({ bundle, signature: '' }, 0, PUBLIC_B64),
    ).resolves.toBeNull();
  });

  it('refuses a validly signed bundle that fails schema validation', async () => {
    // A signature proves origin, not correctness.
    const bad = JSON.stringify({
      version: 99,
      profiles: [{ id: 'x', sector: 'not-a-sector' }],
    });
    await expect(
      acceptSignedProfiles({ bundle: bad, signature: signBundle(bad) }, 0, PUBLIC_B64),
    ).resolves.toBeNull();
  });

  it('refuses a replayed older bundle', async () => {
    // Otherwise a captured response could roll profiles backwards forever.
    const old = JSON.stringify({ version: 1, profiles: SITE_PROFILES.profiles });
    await expect(
      acceptSignedProfiles({ bundle: old, signature: signBundle(old) }, 5, PUBLIC_B64),
    ).resolves.toBeNull();
  });

  it('refuses a bundle at the same version', async () => {
    const same = JSON.stringify({ version: 7, profiles: SITE_PROFILES.profiles });
    await expect(
      acceptSignedProfiles({ bundle: same, signature: signBundle(same) }, 7, PUBLIC_B64),
    ).resolves.toBeNull();
  });

  it('refuses unparseable JSON that happens to be signed', async () => {
    const junk = 'not json';
    await expect(
      acceptSignedProfiles({ bundle: junk, signature: signBundle(junk) }, 0, PUBLIC_B64),
    ).resolves.toBeNull();
  });

  it('refuses a payload whose bundle is not a string', async () => {
    await expect(
      acceptSignedProfiles(
        { bundle: { version: 9 } as unknown as string, signature: 'x' },
        0,
        PUBLIC_B64,
      ),
    ).resolves.toBeNull();
  });
});

describe('the packaged bundle', () => {
  it('passes the same validation remote bundles must pass', () => {
    expect(validateProfilesBundle(SITE_PROFILES)).not.toBeNull();
  });
});

describe('remoteProfilesEnabled', () => {
  it('is false when the build has no public key (safe default)', async () => {
    const { remoteProfilesEnabled, PROFILES_PUBLIC_KEY } = await import(
      './remote'
    );
    // Unit builds leave the key empty unless WALKCROACH_PROFILES_PUBLIC_KEY is set.
    if (!PROFILES_PUBLIC_KEY) {
      expect(remoteProfilesEnabled()).toBe(false);
    }
  });
});
