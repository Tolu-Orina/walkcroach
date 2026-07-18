/**
 * Shared env resolution for deployed integration / E2E runs.
 * Prefer explicit env vars; fall back to SSM Parameter Store when CI (or WALKCROACH_USE_SSM=1).
 */
import { execFileSync } from 'node:child_process';

export type SurfaceEnv = {
  apiBaseUrl: string;
  webBaseUrl: string;
  environment: string;
  allowDevAuth: boolean;
};

function trimSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function shouldQuerySsm(): boolean {
  return (
    process.env.CI === 'true' ||
    process.env.WALKCROACH_USE_SSM === '1' ||
    process.env.WALKCROACH_USE_SSM === 'true'
  );
}

function readSsm(name: string): string | null {
  if (!shouldQuerySsm()) return null;
  try {
    const out = execFileSync(
      'aws',
      [
        'ssm',
        'get-parameter',
        '--name',
        name,
        '--query',
        'Parameter.Value',
        '--output',
        'text',
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 8_000,
      },
    ).trim();
    if (!out || out === 'None') return null;
    return out;
  } catch {
    return null;
  }
}

export function resolveEnvironment(): string {
  return (
    process.env.WALKCROACH_ENV?.trim() ||
    process.env.TF_VAR_environment?.trim() ||
    process.env.ENVIRONMENT?.trim() ||
    'test'
  );
}

/**
 * Resolve API + SPA base URLs for CI / local deployed tests.
 * Required: WALKCROACH_API_URL or (CI/SSM) /walkcroach/{env}/web/api_url
 * Optional web: WALKCROACH_WEB_URL or SSM /walkcroach/{env}/web/web_url
 */
export function resolveSurfaceEnv(): SurfaceEnv | null {
  const environment = resolveEnvironment();
  const apiFromEnv = process.env.WALKCROACH_API_URL?.trim();
  const webFromEnv = process.env.WALKCROACH_WEB_URL?.trim();

  const apiBaseUrl =
    apiFromEnv ||
    readSsm(`/walkcroach/${environment}/web/api_url`) ||
    '';
  if (!apiBaseUrl) return null;

  const webBaseUrl =
    webFromEnv ||
    readSsm(`/walkcroach/${environment}/web/web_url`) ||
    (environment === 'prod'
      ? 'https://walkcroach.conquerorfoundation.com'
      : '');

  return {
    apiBaseUrl: trimSlash(apiBaseUrl),
    webBaseUrl: webBaseUrl ? trimSlash(webBaseUrl) : '',
    environment,
    allowDevAuth: process.env.ALLOW_DEV_AUTH === 'true',
  };
}

export function requireSurfaceEnv(): SurfaceEnv {
  const env = resolveSurfaceEnv();
  if (!env) {
    throw new Error(
      'WALKCROACH_API_URL (or SSM /walkcroach/{env}/web/api_url with CI/WALKCROACH_USE_SSM) is required for deployed integration tests',
    );
  }
  return env;
}

export function devBearer(ownerId: string): string {
  return `Bearer dev:${ownerId}`;
}
