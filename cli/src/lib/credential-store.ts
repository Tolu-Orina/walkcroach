/**
 * Credential storage with the OS keychain first and a file fallback (C1.7).
 *
 * Until now every secret lived in `~/.walkcroach/secrets.json` at mode 0600.
 * That is better than nothing and worse than it sounds: the file is readable
 * by every process running as that user, by every backup tool, and by anything
 * that gets a moment of access to the machine. Heroku moved its CLI to the
 * system keychain for exactly this reason and demoted `.netrc` to a fallback;
 * this is the same move.
 *
 * ## Why the fallback stays
 *
 * A keychain is not always there — a container, a minimal Linux image with no
 * Secret Service, a CI runner. Failing to store a credential because the
 * platform lacks a daemon would make the CLI unusable in precisely the
 * environments people script it in. So the file remains, `doctor` reports
 * which backend is live, and nobody has to guess.
 *
 * ## Migration
 *
 * Reads consult the keychain, then the file, so an existing install keeps
 * working untouched. A successful keychain write removes the file copy: two
 * sources of truth for a credential is how stale tokens outlive a logout, and
 * leaving plaintext behind would forfeit the reason for the change.
 */
import { createRequire } from 'node:module';

const SERVICE = 'walkcroach';

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(value: string): void;
  deletePassword(): boolean;
};

type KeyringModule = {
  Entry: new (service: string, account: string) => KeyringEntry;
};

export type CredentialBackend = 'keychain' | 'file';

let cached: KeyringModule | null | undefined;

/**
 * Escape hatch: `WALKCROACH_NO_KEYCHAIN=1` forces the file backend.
 *
 * Needed by three real cases. A container or CI image where the keychain
 * exists but is not the store anyone wants; a user who would rather keep a
 * file they can inspect and copy; and this repo's own test suite, which must
 * not write to the developer's real credential store — a temp `$WALKCROACH_HOME`
 * isolates the file backend, but nothing isolates the machine keychain.
 *
 * ## Production refuse (P3.7)
 *
 * When `WALKCROACH_PROFILE=production` (or `WALKCROACH_ENV=production`) and the
 * keychain cannot store the value, writes fail closed unless
 * `WALKCROACH_ALLOW_PLAINTEXT_SECRETS=1`. CI/tests keep the file fallback via
 * `WALKCROACH_NO_KEYCHAIN` or Vitest's NODE_ENV=test.
 */
export function keychainDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.WALKCROACH_NO_KEYCHAIN;
  return raw !== undefined && raw !== '' && raw !== '0';
}

/** True when plaintext `secrets.json` writes are permitted. */
export function allowPlaintextSecrets(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.WALKCROACH_ALLOW_PLAINTEXT_SECRETS === '1') return true;
  if (keychainDisabled(env)) return true;
  if (env.VITEST || env.NODE_ENV === 'test') return true;
  const profile = (
    env.WALKCROACH_PROFILE ||
    env.WALKCROACH_ENV ||
    ''
  ).toLowerCase();
  if (profile === 'production' || profile === 'prod') return false;
  return true;
}

export class PlaintextSecretsRefusedError extends Error {
  readonly code = 'PLAINTEXT_SECRETS_REFUSED';
  constructor() {
    super(
      'Plaintext secret file is refused in production profile. Enable the OS keychain, or set WALKCROACH_ALLOW_PLAINTEXT_SECRETS=1 if you intentionally accept file-backed secrets.',
    );
    this.name = 'PlaintextSecretsRefusedError';
  }
}


/**
 * Load the native keychain binding, once, without letting its absence throw.
 *
 * `createRequire` rather than a static import because the module is an
 * optional dependency: on a platform with no prebuilt binary the install
 * simply skips it, and the CLI has to keep working.
 */
export function loadKeyring(): KeyringModule | null {
  if (keychainDisabled()) return null;
  if (cached !== undefined) return cached;
  try {
    const require = createRequire(import.meta.url);
    const mod = require('@napi-rs/keyring') as KeyringModule;
    cached = typeof mod?.Entry === 'function' ? mod : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Tests only — the module memoises a native handle. */
export function resetKeyringCache(): void {
  cached = undefined;
}

/**
 * Whether the keychain is usable *right now*.
 *
 * Deliberately a live probe rather than "did the module load": on Linux the
 * binding imports cleanly and then fails at the D-Bus call when no Secret
 * Service is running. Only a real round-trip distinguishes those.
 */
export function keychainAvailable(): boolean {
  const keyring = loadKeyring();
  if (!keyring) return false;
  try {
    // Reading an absent entry is side-effect free and exercises the same path
    // a real read would take.
    new keyring.Entry(SERVICE, '__walkcroach_probe__').getPassword();
    return true;
  } catch {
    return false;
  }
}

export function credentialBackend(): CredentialBackend {
  return keychainAvailable() ? 'keychain' : 'file';
}

export function keychainGet(key: string): string | undefined {
  const keyring = loadKeyring();
  if (!keyring) return undefined;
  try {
    return new keyring.Entry(SERVICE, key).getPassword() ?? undefined;
  } catch {
    return undefined;
  }
}

/** Returns false when the keychain could not take the value, so callers fall back. */
export function keychainSet(key: string, value: string): boolean {
  const keyring = loadKeyring();
  if (!keyring) return false;
  try {
    new keyring.Entry(SERVICE, key).setPassword(value);
    return true;
  } catch {
    return false;
  }
}

export function keychainDelete(key: string): void {
  const keyring = loadKeyring();
  if (!keyring) return;
  try {
    new keyring.Entry(SERVICE, key).deletePassword();
  } catch {
    // Absent, or no keychain — either way there is nothing left to remove.
  }
}
