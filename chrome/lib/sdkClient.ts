/**
 * Cognito-backed `@walkcroach/sdk` client for Chrome (Phase P2 follow-on).
 *
 * Uses Cognito JWT (prefer real access_token) — never apiKey in the extension.
 * Captures / recall / summarize streams stay on the chrome BFF; only project
 * memory list/remember/export go through this client → `/v1/memory/*`.
 */
import { WalkCroach } from '@walkcroach/sdk';
import { loadSession } from './auth';

declare const __WALKCROACH_IDE_API_BASE__: string;

const IDE_API_URL = (
  typeof __WALKCROACH_IDE_API_BASE__ !== 'undefined'
    ? __WALKCROACH_IDE_API_BASE__
    : 'http://localhost:3003'
).replace(/\/$/, '');

export function sdkBaseUrl(): string {
  return /\/v1$/i.test(IDE_API_URL)
    ? IDE_API_URL.replace(/\/v1$/i, '')
    : IDE_API_URL;
}

/**
 * Prefer real Cognito access_token; fall back to id_token / BFF bearer.
 * Device sessions cannot call IDE `/v1` — returns undefined.
 */
export async function getSdkAccessToken(): Promise<string | undefined> {
  const session = await loadSession();
  if (!session || session.source !== 'cognito') return undefined;

  const data = await chrome.storage.local.get([
    'wc_cognito_access_token',
    'wc_id_token',
    'wc_access_token',
  ]);
  const cognitoAccess = (data.wc_cognito_access_token as string | undefined)?.trim();
  const idToken = (data.wc_id_token as string | undefined)?.trim();
  const bearer = session.accessToken?.trim();
  return cognitoAccess || idToken || bearer || undefined;
}

/**
 * Fresh WalkCroach client for the current Cognito session.
 * Throws if the user has not upgraded from a device session.
 */
export async function createWalkCroachClient(): Promise<WalkCroach> {
  const accessToken = await getSdkAccessToken();
  if (!accessToken) {
    throw new Error(
      'Project memory requires a signed-in WalkCroach account (Cognito).',
    );
  }
  return new WalkCroach({
    accessToken,
    baseUrl: sdkBaseUrl(),
  });
}

export type ProjectMemoryEntry = {
  id: string;
  kind: string;
  text: string;
  sourceSurface: string;
  createdAt: string;
};

export async function listProjectMemory(
  projectId: string,
): Promise<{ entries: ProjectMemoryEntry[] }> {
  const wc = await createWalkCroachClient();
  const entries = await wc.memory.list({ projectId, limit: 100 });
  return {
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      text: e.text,
      sourceSurface: e.surface,
      createdAt: e.createdAt,
    })),
  };
}

export async function rememberProjectMemory(opts: {
  projectId: string;
  kind: string;
  text: string;
}): Promise<{ id: string; supersededId: string | null }> {
  const wc = await createWalkCroachClient();
  const result = await wc.memory.remember({
    projectId: opts.projectId,
    kind: opts.kind as never,
    text: opts.text,
    surface: 'chrome',
  });
  return { id: result.id, supersededId: result.supersededId ?? null };
}

export async function exportProjectMemory(projectId: string) {
  const wc = await createWalkCroachClient();
  return wc.memory.export({ projectId });
}
