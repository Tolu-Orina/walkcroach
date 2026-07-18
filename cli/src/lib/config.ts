import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export type WalkcroachConfig = {
  apiBaseUrl: string;
  cognitoHostedUiUrl?: string;
  cognitoClientId?: string;
  cognitoRegion?: string;
  defaultAutonomy?: 'strict' | 'low_friction';
};

const DEFAULTS: WalkcroachConfig = {
  apiBaseUrl: 'http://localhost:3003',
  cognitoRegion: 'eu-west-2',
  defaultAutonomy: 'strict',
};

export function walkcroachHome(): string {
  return (
    process.env.WALKCROACH_HOME?.trim() ||
    join(homedir(), '.walkcroach')
  );
}

export function configPath(): string {
  return join(walkcroachHome(), 'config.json');
}

export function secretsPath(): string {
  return join(walkcroachHome(), 'secrets.json');
}

export async function ensureHome(): Promise<void> {
  const dir = walkcroachHome();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
}

export async function loadConfig(): Promise<WalkcroachConfig> {
  await ensureHome();
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    const raw = await readFile(path, 'utf8');
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WalkcroachConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConfig(
  patch: Partial<WalkcroachConfig>,
): Promise<WalkcroachConfig> {
  await ensureHome();
  const next = { ...(await loadConfig()), ...patch };
  await writeFile(configPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  try {
    await chmod(configPath(), 0o600);
  } catch {
    // Windows may ignore chmod
  }
  return next;
}

/** Secrets share logical keys with the IDE SecretStorage (FR-D23 / NFR-D04). */
export type SecretsFile = Record<string, string>;

export async function loadSecrets(): Promise<SecretsFile> {
  await ensureHome();
  const path = secretsPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SecretsFile;
  } catch {
    return {};
  }
}

export async function saveSecrets(secrets: SecretsFile): Promise<void> {
  await ensureHome();
  await writeFile(secretsPath(), `${JSON.stringify(secrets, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    await chmod(secretsPath(), 0o600);
  } catch {
    // ignore
  }
}

export async function getSecret(key: string): Promise<string | undefined> {
  const envKey = `WALKCROACH_${key.replace(/\./g, '_').toUpperCase()}`;
  if (process.env[envKey]) return process.env[envKey];
  // Common alias for Cognito access token
  if (
    key.includes('accessToken') &&
    process.env.WALKCROACH_ACCESS_TOKEN
  ) {
    return process.env.WALKCROACH_ACCESS_TOKEN;
  }
  const secrets = await loadSecrets();
  return secrets[key];
}

export async function setSecret(key: string, value: string): Promise<void> {
  const secrets = await loadSecrets();
  secrets[key] = value;
  await saveSecrets(secrets);
}

export async function deleteSecret(key: string): Promise<void> {
  const secrets = await loadSecrets();
  delete secrets[key];
  await saveSecrets(secrets);
}
