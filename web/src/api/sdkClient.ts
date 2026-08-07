/**
 * Cognito-backed `@walkcroach/sdk` client for the Web app (Phase P2 follow-on).
 *
 * Uses **accessToken** (falls back to idToken / session token) — never apiKey
 * in the browser. Agent loops stay on the harness `API_URL`; only memory UX
 * goes through this client → `/v1/memory/*`.
 */
import { WalkCroach } from '@walkcroach/sdk';
import { loadStoredAuth } from '../auth/storage';

const IDE_API_URL = (
  import.meta.env.VITE_IDE_API_URL ??
  import.meta.env.VITE_API_URL ??
  'http://localhost:3003'
).replace(/\/$/, '');

function sdkBaseUrl(): string {
  return /\/v1$/i.test(IDE_API_URL)
    ? IDE_API_URL.replace(/\/v1$/i, '')
    : IDE_API_URL;
}

/** Prefer Cognito access token; fall back to idToken / session token. */
export function getSdkAccessToken(): string | undefined {
  const stored = loadStoredAuth();
  if (!stored) return undefined;
  return (
    stored.cognito?.accessToken?.trim() ||
    stored.cognito?.idToken?.trim() ||
    stored.token?.trim() ||
    undefined
  );
}

/**
 * Fresh WalkCroach client for the current session.
 * Throws if the user is not signed in.
 */
export function createWalkCroachClient(): WalkCroach {
  const accessToken = getSdkAccessToken();
  if (!accessToken) {
    throw new Error('Not signed in — project memory requires a Cognito session.');
  }
  return new WalkCroach({
    accessToken,
    baseUrl: sdkBaseUrl(),
  });
}
