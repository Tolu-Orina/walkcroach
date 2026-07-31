import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { getRuntimeFlags } from './runtime.js';
import { keychainDelete, keychainGet, keychainSet } from './credential-store.js';

export type WalkcroachConfig = {
  apiBaseUrl: string;
  cognitoHostedUiUrl?: string;
  cognitoClientId?: string;
  cognitoRegion?: string;
  defaultAutonomy?: 'strict' | 'low_friction';
  /**
   * Bedrock region for BYOK inference (Part 1 §4A).
   *
   * Configuration, not a secret: a Bedrock API key only works in the region it
   * was created in, so getting this wrong is the most common BYOK failure and
   * the user needs to be able to see and change it.
   */
  bedrockRegion?: string;
};

/**
 * Production API, same stage the IDE extension ships as its default
 * (`ide/package.json` → `walkcroach.ide.apiBaseUrl`).
 *
 * This used to be `http://localhost:3003` (C0.2), which is correct for someone
 * running `npm run dev:ide` in this repo and useless for everyone else — a
 * published CLI would have talked to nothing on a fresh machine. Local
 * development is now the explicit case, not the default one:
 *
 *   walkcroach config apiBaseUrl http://localhost:3003
 *   WALKCROACH_API_BASE_URL=http://localhost:3003 walkcroach doctor
 *   walkcroach --api-url http://localhost:3003 doctor
 */
export const DEFAULT_API_BASE_URL =
  'https://awbcf4clij.execute-api.eu-west-2.amazonaws.com/v1';

const DEFAULTS: WalkcroachConfig = {
  apiBaseUrl: DEFAULT_API_BASE_URL,
  cognitoRegion: 'eu-west-2',
  defaultAutonomy: 'strict',
};

/** Where a resolved setting came from, highest precedence first (C0.3). */
export type ConfigSource = 'flag' | 'env' | 'project' | 'user' | 'default';

export type Resolved<T> = {
  value: T;
  source: ConfigSource;
  /** Set when a lower-precedence value was rejected rather than used. */
  note?: string;
};

/** Project-level config file, read from the workspace and never written. */
export const PROJECT_CONFIG_REL = join('.walkcroach', 'config.json');

export type ProjectConfig = Partial<Pick<WalkcroachConfig, 'apiBaseUrl' | 'defaultAutonomy'>>;

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
  // Keychain first, file second (C1.7) — so an install that predates the
  // keychain keeps working with no migration step asked of the user.
  const fromKeychain = keychainGet(key);
  if (fromKeychain !== undefined) return fromKeychain;
  const secrets = await loadSecrets();
  return secrets[key];
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (keychainSet(key, value)) {
    // Drop any plaintext copy now that the keychain holds the value. Two
    // sources of truth is how a stale token survives a logout, and leaving
    // the file behind would forfeit the point of using a keychain.
    const secrets = await loadSecrets();
    if (key in secrets) {
      delete secrets[key];
      await saveSecrets(secrets);
    }
    return;
  }
  const secrets = await loadSecrets();
  secrets[key] = value;
  await saveSecrets(secrets);
}

export async function deleteSecret(key: string): Promise<void> {
  // Clear both backends: a value may predate the keychain, and a logout that
  // leaves either copy behind has not logged anyone out.
  keychainDelete(key);
  const secrets = await loadSecrets();
  if (key in secrets) {
    delete secrets[key];
    await saveSecrets(secrets);
  }
}

// ---------------------------------------------------------------------------
// Configuration precedence (C0.2, C0.3)
//
// flag > env > project (.walkcroach/config.json) > user (~/.walkcroach) > default
//
// The order is clig.dev's. The project layer is new: it lets a repo pin a
// self-hosted API without anyone editing $HOME, which is what a team sharing a
// deployment actually wants.
// ---------------------------------------------------------------------------

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Find the nearest `.walkcroach/config.json` at or above `cwd`.
 *
 * Upward search matches how `.git` and every tool layered on it behave, so a
 * command run from a subdirectory sees the same configuration as one run from
 * the repo root. Synchronous because it runs once, before anything prints.
 */
export function findProjectConfig(cwd = process.cwd()): {
  path: string;
  config: ProjectConfig;
} | null {
  let dir = resolve(cwd);
  for (let depth = 0; depth < 32; depth += 1) {
    const candidate = join(dir, PROJECT_CONFIG_REL);
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { path: candidate, config: parsed as ProjectConfig };
        }
      } catch {
        // A malformed project config must not brick the CLI in a repo the user
        // may not control. Fall through to the layer below.
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Whether a project-supplied API URL may be used.
 *
 * This is a trust boundary, not a formatting check. The project config comes
 * from whatever repository the user has cd'd into — cloning someone else's
 * code should never be enough to redirect an authenticated CLI, because every
 * authenticated request carries a bearer token to whatever host this returns.
 *
 * So a repo may point the CLI at its own HTTPS deployment, or at this machine,
 * and nothing else. Plaintext HTTP to a remote host is refused outright: that
 * would put the token on the wire in the clear as well as send it somewhere new.
 */
export function isTrustedProjectApiUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return (
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]' ||
    url.hostname === 'localhost'
  );
}

/**
 * Resolve the API base URL and report which layer supplied it.
 *
 * The source is returned rather than logged because `doctor` shows it (C1.6):
 * "which API am I talking to, and why" is the first question when a command
 * misbehaves, and answering it should not require reading three files.
 */
export async function resolveApiBaseUrl(opts?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<Resolved<string>> {
  const env = opts?.env ?? process.env;

  const flag = getRuntimeFlags().apiBaseUrl?.trim();
  if (flag) return { value: stripTrailingSlash(flag), source: 'flag' };

  const fromEnv = env.WALKCROACH_API_BASE_URL?.trim();
  if (fromEnv) return { value: stripTrailingSlash(fromEnv), source: 'env' };

  const project = findProjectConfig(opts?.cwd);
  const projectUrl = project?.config.apiBaseUrl?.trim();
  if (projectUrl) {
    if (isTrustedProjectApiUrl(projectUrl)) {
      return { value: stripTrailingSlash(projectUrl), source: 'project' };
    }
    // Ignored, not fatal: refusing to run would let an untrusted repo break the
    // CLI just as effectively as redirecting it. The note surfaces in `doctor`
    // and on stderr, so the decision is visible rather than silent.
    const note = `Ignored apiBaseUrl from ${project?.path}: only https:// or a loopback address is accepted from project config.`;
    return { ...(await fromUserOrDefault()), note };
  }

  return fromUserOrDefault();
}

async function fromUserOrDefault(): Promise<Resolved<string>> {
  const raw = await loadUserConfigRaw();
  const userUrl = raw?.apiBaseUrl?.trim();
  // Source is decided by whether the *file* set the key, not by whether the
  // effective value happens to equal the default — a user who explicitly pins
  // the production URL should still see `user`, so `doctor` explains why an
  // env change did not take effect.
  if (userUrl) return { value: stripTrailingSlash(userUrl), source: 'user' };
  return { value: DEFAULT_API_BASE_URL, source: 'default' };
}

/** The user config exactly as stored, with no defaults merged in. */
export async function loadUserConfigRaw(): Promise<Partial<WalkcroachConfig> | null> {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Partial<WalkcroachConfig>;
  } catch {
    return null;
  }
}
