import { randomUUID } from 'node:crypto';
import type { DbClient } from '@walkcroach/db';

const STATE_TTL_MS = 15 * 60 * 1000;

export type GithubOAuthStatePayload = {
  projectId: string;
  ownerId: string;
  repo: string;
  nonce: string;
};

export function encodeGithubOAuthState(payload: GithubOAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeGithubOAuthState(state: string): GithubOAuthStatePayload {
  const json = Buffer.from(state, 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as GithubOAuthStatePayload;
  if (!parsed.projectId || !parsed.ownerId || !parsed.repo || !parsed.nonce) {
    throw new Error('invalid oauth state');
  }
  return parsed;
}

export async function createGithubOAuthState(
  db: DbClient,
  projectId: string,
  ownerId: string,
  repo: string,
): Promise<string> {
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);

  await db.query(
    `INSERT INTO github_oauth_states (project_id, owner_id, repo, nonce, expires_at)
     VALUES ($1::uuid, $2, $3, $4, $5)`,
    [projectId, ownerId, repo, nonce, expiresAt.toISOString()],
  );

  return encodeGithubOAuthState({ projectId, ownerId, repo, nonce });
}

export async function consumeGithubOAuthState(
  db: DbClient,
  state: string,
  authOwnerId: string,
): Promise<{ projectId: string; repo: string }> {
  const payload = decodeGithubOAuthState(state);
  if (payload.ownerId !== authOwnerId) {
    throw new Error('oauth state owner mismatch');
  }

  const { rows } = await db.query<{ project_id: string; repo: string }>(
    `DELETE FROM github_oauth_states
     WHERE nonce = $1 AND owner_id = $2 AND expires_at > now()
     RETURNING project_id, repo`,
    [payload.nonce, authOwnerId],
  );

  const row = rows[0];
  if (!row || row.project_id !== payload.projectId || row.repo !== payload.repo) {
    throw new Error('oauth state expired or invalid');
  }

  return { projectId: row.project_id, repo: row.repo };
}
