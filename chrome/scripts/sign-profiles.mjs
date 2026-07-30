#!/usr/bin/env node
/**
 * Generate keys for, and sign, a site-profile bundle (Phase D6).
 *
 * The extension applies a remote bundle only if an Ed25519 signature verifies
 * against the public key baked into its build, so a compromised CDN or a MITM
 * cannot introduce profiles. The private key belongs in Secrets Manager and must
 * never enter the repo or a build.
 *
 * Usage:
 *   node scripts/sign-profiles.mjs --generate
 *       Mint a keypair. Public half goes in the extension build
 *       (WALKCROACH_PROFILES_PUBLIC_KEY); private half goes in Secrets Manager.
 *
 *   node scripts/sign-profiles.mjs --sign <bundle.json> --key <private-b64>
 *       Print the CHROME_SITE_PROFILES_BUNDLE / _SIGNATURE pair for the Lambda.
 *       Defaults to the packaged lib/site-profiles/profiles.v1.json.
 *
 * The bundle is signed as the exact string that will be served. Do not reformat
 * it afterwards — re-serialising changes the bytes and invalidates the signature.
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function rawPublic(publicKey) {
  // Last 32 bytes of the DER SPKI are the raw Ed25519 key, which is what
  // WebCrypto's `importKey('raw', …)` expects in the extension.
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return Buffer.from(der.subarray(der.length - 32)).toString('base64');
}

if (has('--generate')) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  console.log('Public key  → extension build env:');
  console.log(`  WALKCROACH_PROFILES_PUBLIC_KEY=${rawPublic(publicKey)}`);
  console.log('');
  console.log('Private key → Secrets Manager (never commit, never build with):');
  console.log(
    `  ${privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')}`,
  );
  console.log('');
  console.log('Sign a bundle with:');
  console.log('  node scripts/sign-profiles.mjs --sign <bundle.json> --key <private-b64>');
  process.exit(0);
}

if (has('--sign')) {
  const bundlePath = resolve(
    valueOf('--sign') ?? 'lib/site-profiles/profiles.v1.json',
  );
  const privateB64 = valueOf('--key') ?? process.env.WALKCROACH_PROFILES_PRIVATE_KEY;
  if (!privateB64) {
    console.error('Missing --key (base64 PKCS8 private key).');
    process.exit(1);
  }

  // Re-serialise once, deterministically, then sign *that* exact text. The
  // Lambda serves this string verbatim and the extension verifies these bytes.
  const parsed = JSON.parse(readFileSync(bundlePath, 'utf-8'));
  if (typeof parsed?.version !== 'number' || !Array.isArray(parsed?.profiles)) {
    console.error('Not a profiles bundle: expected { version, profiles[] }.');
    process.exit(1);
  }
  const bundle = JSON.stringify(parsed);

  const privateKey = createPrivateKey({
    key: Buffer.from(privateB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = sign(null, Buffer.from(bundle, 'utf8'), privateKey).toString('base64');

  console.log(`# version ${parsed.version}, ${parsed.profiles.length} profiles`);
  console.log(`# verifies against WALKCROACH_PROFILES_PUBLIC_KEY=${rawPublic(createPublicKey(privateKey))}`);
  console.log('');
  console.log(`CHROME_SITE_PROFILES_BUNDLE='${bundle.replace(/'/g, "'\''")}'`);
  console.log(`CHROME_SITE_PROFILES_SIGNATURE=${signature}`);
  process.exit(0);
}

console.error(
  'Usage:\n  node scripts/sign-profiles.mjs --generate\n  node scripts/sign-profiles.mjs --sign <bundle.json> --key <private-b64>',
);
process.exit(1);
