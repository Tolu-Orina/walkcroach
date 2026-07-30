#!/usr/bin/env node
/**
 * Extension ID helper (Phase A5).
 *
 * Unpacked extensions derive their ID from the absolute install path, so it
 * differs per machine and per checkout. Every OAuth redirect URI we build is
 * `chrome-extension://<id>/auth.html` or `https://<id>.chromiumapp.org/auth`,
 * and the Chrome BFF allowlist binds to that ID — so an unpinned ID means
 * sign-in works on one machine and fails on the next with a redirect error.
 *
 * Setting the manifest `key` field pins the ID everywhere.
 *
 * Usage:
 *   node scripts/extension-id.mjs --generate     # mint a dev key + print its ID
 *   node scripts/extension-id.mjs <base64-key>   # show the ID for a key
 *   node scripts/extension-id.mjs                # show the ID for $WALKCROACH_EXTENSION_KEY
 */
import { createHash, generateKeyPairSync } from 'node:crypto';

/**
 * Chrome hashes the DER SubjectPublicKeyInfo, takes the first 16 bytes, and
 * maps each hex nibble 0..f onto a..p.
 */
function extensionIdFromKey(base64Key) {
  const der = Buffer.from(base64Key, 'base64');
  const digest = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...digest]
    .map((nibble) => String.fromCharCode(parseInt(nibble, 16) + 97))
    .join('');
}

function generateKey() {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

const arg = process.argv[2];
let key;

if (arg === '--generate') {
  key = generateKey();
  console.log('Generated development key.\n');
} else {
  key = arg ?? process.env.WALKCROACH_EXTENSION_KEY;
  if (!key) {
    console.error(
      'No key given. Pass one as an argument, set WALKCROACH_EXTENSION_KEY, or run with --generate.',
    );
    process.exit(1);
  }
}

const id = extensionIdFromKey(key);
if (!/^[a-p]{32}$/.test(id)) {
  console.error('That key did not produce a valid extension ID. Is it base64 DER?');
  process.exit(1);
}

console.log(`WALKCROACH_EXTENSION_KEY=${key}`);
console.log('');
console.log(`Extension ID:        ${id}`);
console.log(`auth.html redirect:  chrome-extension://${id}/auth.html`);
console.log(`identity redirect:   https://${id}.chromiumapp.org/auth`);
console.log('');
console.log(
  'Do NOT set WALKCROACH_EXTENSION_KEY for store builds — the Chrome Web Store\n' +
    'holds the key for a published listing and assigns the ID from it.',
);
