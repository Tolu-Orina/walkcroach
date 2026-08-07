/**
 * Keychain-first credential storage (C1.7).
 *
 * The suite runs with `WALKCROACH_NO_KEYCHAIN=1` (see vitest.config.ts), so
 * these tests opt back in deliberately and then clean up after themselves.
 * Where a real keychain is unavailable — a CI container with no Secret
 * Service — the round-trip assertions are skipped rather than failed: that
 * platform is exactly the one the file fallback exists for, and the fallback
 * itself is asserted unconditionally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  allowPlaintextSecrets,
  credentialBackend,
  keychainAvailable,
  keychainDelete,
  keychainDisabled,
  keychainGet,
  keychainSet,
  PlaintextSecretsRefusedError,
  resetKeyringCache,
} from './credential-store.js';
import { deleteSecret, getSecret, secretsPath, setSecret } from './config.js';

const KEY = 'walkcroach.test.credential';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'wc-cred-'));
  process.env.WALKCROACH_HOME = home;
  resetKeyringCache();
});

afterEach(async () => {
  delete process.env.WALKCROACH_HOME;
  process.env.WALKCROACH_NO_KEYCHAIN = '1';
  resetKeyringCache();
  await rm(home, { recursive: true, force: true });
});

/** Run a body with the keychain enabled, restoring the guard afterwards. */
async function withKeychain(body: () => Promise<void>): Promise<void> {
  delete process.env.WALKCROACH_NO_KEYCHAIN;
  resetKeyringCache();
  try {
    await body();
  } finally {
    keychainDelete(KEY);
    process.env.WALKCROACH_NO_KEYCHAIN = '1';
    resetKeyringCache();
  }
}

describe('keychainDisabled', () => {
  it('treats any non-empty, non-zero value as "off"', () => {
    expect(keychainDisabled({ WALKCROACH_NO_KEYCHAIN: '1' })).toBe(true);
    expect(keychainDisabled({ WALKCROACH_NO_KEYCHAIN: 'true' })).toBe(true);
    expect(keychainDisabled({ WALKCROACH_NO_KEYCHAIN: '0' })).toBe(false);
    expect(keychainDisabled({ WALKCROACH_NO_KEYCHAIN: '' })).toBe(false);
    expect(keychainDisabled({})).toBe(false);
  });
});

describe('with the keychain disabled', () => {
  it('reports the file backend', () => {
    expect(credentialBackend()).toBe('file');
  });

  it('stores and reads through the 0600 file', async () => {
    await setSecret(KEY, 'file-value');
    expect(await getSecret(KEY)).toBe('file-value');
    expect(await readFile(secretsPath(), 'utf8')).toContain('file-value');
  });

  it('removes the value on delete', async () => {
    await setSecret(KEY, 'file-value');
    await deleteSecret(KEY);
    expect(await getSecret(KEY)).toBeUndefined();
  });

  it('never reaches the keychain', () => {
    expect(keychainSet(KEY, 'should-not-be-stored')).toBe(false);
    expect(keychainGet(KEY)).toBeUndefined();
  });
});

describe('with the keychain enabled', () => {
  it('round-trips a value through the OS store', async () => {
    await withKeychain(async () => {
      if (!keychainAvailable()) return; // No Secret Service — fallback covers it.
      expect(credentialBackend()).toBe('keychain');
      expect(keychainSet(KEY, 'keychain-value')).toBe(true);
      expect(keychainGet(KEY)).toBe('keychain-value');
      keychainDelete(KEY);
      expect(keychainGet(KEY)).toBeUndefined();
    });
  });

  it('keeps the plaintext value out of the file entirely', async () => {
    await withKeychain(async () => {
      if (!keychainAvailable()) return;
      await setSecret(KEY, 'secret-value');
      expect(await getSecret(KEY)).toBe('secret-value');
      // The whole point: nothing readable is left on disk.
      if (existsSync(secretsPath())) {
        expect(await readFile(secretsPath(), 'utf8')).not.toContain('secret-value');
      }
    });
  });

  it('migrates an existing file value and removes the plaintext copy', async () => {
    await withKeychain(async () => {
      if (!keychainAvailable()) return;
      // Simulate an install that predates C1.7: value already in the file.
      process.env.WALKCROACH_NO_KEYCHAIN = '1';
      resetKeyringCache();
      await setSecret(KEY, 'legacy-value');
      expect(await readFile(secretsPath(), 'utf8')).toContain('legacy-value');

      delete process.env.WALKCROACH_NO_KEYCHAIN;
      resetKeyringCache();

      // Reads keep working with no migration step asked of the user…
      expect(await getSecret(KEY)).toBe('legacy-value');
      // …and the next write moves it, leaving one source of truth.
      await setSecret(KEY, 'new-value');
      expect(await getSecret(KEY)).toBe('new-value');
      expect(await readFile(secretsPath(), 'utf8')).not.toContain('legacy-value');
    });
  });

  it('clears both backends on delete, so a logout really logs out', async () => {
    await withKeychain(async () => {
      if (!keychainAvailable()) return;
      keychainSet(KEY, 'in-keychain');
      process.env.WALKCROACH_NO_KEYCHAIN = '1';
      resetKeyringCache();
      await setSecret(KEY, 'in-file');
      delete process.env.WALKCROACH_NO_KEYCHAIN;
      resetKeyringCache();

      await deleteSecret(KEY);
      expect(await getSecret(KEY)).toBeUndefined();
      expect(keychainGet(KEY)).toBeUndefined();
    });
  });
});

describe('environment precedence', () => {
  it('still beats both backends', async () => {
    // A run must reflect what the environment says, whatever is stored.
    process.env.WALKCROACH_WALKCROACH_TEST_CREDENTIAL = 'from-env';
    try {
      await setSecret(KEY, 'from-store');
      expect(await getSecret(KEY)).toBe('from-env');
    } finally {
      delete process.env.WALKCROACH_WALKCROACH_TEST_CREDENTIAL;
    }
  });
});

describe('production plaintext refuse (P3.7)', () => {
  it('allowPlaintextSecrets is false for production profile', () => {
    expect(
      allowPlaintextSecrets({
        WALKCROACH_PROFILE: 'production',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      allowPlaintextSecrets({
        WALKCROACH_ENV: 'prod',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('allowPlaintextSecrets stays true for CI / explicit escape hatches', () => {
    expect(
      allowPlaintextSecrets({
        WALKCROACH_PROFILE: 'production',
        WALKCROACH_ALLOW_PLAINTEXT_SECRETS: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      allowPlaintextSecrets({
        WALKCROACH_PROFILE: 'production',
        WALKCROACH_NO_KEYCHAIN: '1',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(PlaintextSecretsRefusedError).toBeDefined();
  });
});
