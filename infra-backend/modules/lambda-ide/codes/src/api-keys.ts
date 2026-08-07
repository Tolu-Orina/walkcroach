/**
 * Service-account API keys for @walkcroach/sdk and @walkcroach/sdk-mcp.
 *
 * Every other caller on this BFF is a Cognito user. An SDK running server-side has
 * no user to sign in, so it carries one of these instead. A key is owner-scoped: it
 * can reach exactly what the user who minted it can reach, and no more — the
 * `assertOwnsProject` check on every memory route still applies unchanged.
 *
 * Storage rule: the raw secret is returned once, at creation, and never persisted.
 * What lands in the table is a scrypt hash and a non-secret lookup prefix, so a
 * database dump is not a set of usable credentials.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { DbClient } from '@walkcroach/db';

const scrypt = promisify(scryptCb) as (
  secret: string | Buffer,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export type ApiKeyScope = 'memory:read' | 'memory:write' | 'content:run';

export const ALL_SCOPES: readonly ApiKeyScope[] = [
  'memory:read',
  'memory:write',
  'content:run',
];

export type ApiKeyContext = {
  ownerId: string;
  keyId: string;
  scopes: ApiKeyScope[];
};

/**
 * `wc_live_` marks these as live credentials in a form secret scanners recognise,
 * which is what makes an accidental commit detectable rather than silent.
 */
const KEY_PREFIX = 'wc_live_';
const HANDLE_LEN = 10; // non-secret, indexed
const SECRET_LEN = 32; // the part that is actually a secret
const HASH_LEN = 32;

// Deliberately excludes look-alike characters so a key read off a screen is
// transcribable without ambiguity.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(len: number): string {
  // Rejection-free modulo bias is irrelevant at 56 symbols vs 256 byte values for
  // a handle, but the secret gets rejection sampling because bias there is real.
  const out: string[] = [];
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b >= 256 - (256 % ALPHABET.length)) continue; // reject to keep uniform
      out.push(ALPHABET[b % ALPHABET.length]!);
      if (out.length === len) break;
    }
  }
  return out.join('');
}

export function isApiKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX);
}

/** Split `wc_live_<handle>_<secret>` without throwing on malformed input. */
export function parseApiKey(
  token: string,
): { prefix: string; secret: string } | null {
  if (!isApiKey(token)) return null;
  const rest = token.slice(KEY_PREFIX.length);
  const sep = rest.indexOf('_');
  if (sep !== HANDLE_LEN) return null;
  const handle = rest.slice(0, sep);
  const secret = rest.slice(sep + 1);
  if (handle.length !== HANDLE_LEN || secret.length !== SECRET_LEN) return null;
  return { prefix: KEY_PREFIX + handle, secret };
}

export async function mintApiKey(params: {
  db: DbClient;
  ownerId: string;
  name: string;
  scopes?: ApiKeyScope[];
  expiresAt?: Date | null;
}): Promise<{ id: string; key: string; prefix: string; scopes: ApiKeyScope[] }> {
  const handle = randomString(HANDLE_LEN);
  const secret = randomString(SECRET_LEN);
  const prefix = KEY_PREFIX + handle;
  const salt = randomBytes(16);
  const hash = await scrypt(secret, salt, HASH_LEN);

  const scopes =
    params.scopes && params.scopes.length > 0 ? params.scopes : (['memory:read'] as ApiKeyScope[]);

  const { rows } = await params.db.query<{ id: string }>(
    `INSERT INTO api_keys (owner_id, name, key_prefix, key_hash, key_salt, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [params.ownerId, params.name, prefix, hash, salt, scopes, params.expiresAt ?? null],
  );

  return {
    id: rows[0]!.id,
    // The only time this value exists anywhere. Not recoverable.
    key: `${prefix}_${secret}`,
    prefix,
    scopes,
  };
}

/**
 * Verify a raw key. Returns null for every failure mode — unknown prefix, bad
 * secret, revoked, expired — so a caller cannot distinguish "no such key" from
 * "wrong secret" by response shape.
 */
export async function verifyApiKey(
  db: DbClient,
  token: string,
): Promise<ApiKeyContext | null> {
  const parsed = parseApiKey(token);
  if (!parsed) return null;

  const { rows } = await db.query<{
    id: string;
    owner_id: string;
    key_hash: Buffer;
    key_salt: Buffer;
    scopes: string[];
    expires_at: Date | null;
  }>(
    `SELECT id, owner_id, key_hash, key_salt, scopes, expires_at
       FROM api_keys
      WHERE key_prefix = $1 AND revoked_at IS NULL
      LIMIT 1`,
    [parsed.prefix],
  );

  const row = rows[0];
  if (!row) {
    // Spend comparable time on the miss path so response latency does not leak
    // whether the prefix existed.
    await scrypt(parsed.secret, randomBytes(16), HASH_LEN);
    return null;
  }

  if (row.expires_at && row.expires_at.getTime() <= Date.now()) return null;

  const candidate = await scrypt(parsed.secret, row.key_salt, HASH_LEN);
  if (
    candidate.length !== row.key_hash.length ||
    !timingSafeEqual(candidate, row.key_hash)
  ) {
    return null;
  }

  // Best-effort, never awaited: a failure to record usage must not fail the
  // request, and it must not sit in the latency path of every SDK call.
  void db
    .query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.id])
    .catch(() => {});

  return {
    ownerId: row.owner_id,
    keyId: row.id,
    scopes: row.scopes.filter((s): s is ApiKeyScope =>
      (ALL_SCOPES as readonly string[]).includes(s),
    ),
  };
}

export async function revokeApiKey(params: {
  db: DbClient;
  ownerId: string;
  id: string;
}): Promise<boolean> {
  // owner_id in the predicate, not just the lookup — one user must not be able to
  // revoke another's key by guessing an id.
  const res = await params.db.query(
    `UPDATE api_keys SET revoked_at = now()
      WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL`,
    [params.id, params.ownerId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listApiKeys(params: {
  db: DbClient;
  ownerId: string;
}): Promise<
  Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
  }>
> {
  const { rows } = await params.db.query<{
    id: string;
    name: string;
    key_prefix: string;
    scopes: string[];
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
  }>(
    `SELECT id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at
       FROM api_keys WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [params.ownerId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.key_prefix,
    scopes: r.scopes,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
    expiresAt: r.expires_at?.toISOString() ?? null,
    revokedAt: r.revoked_at?.toISOString() ?? null,
  }));
}

export function hasScope(
  scopes: readonly string[] | undefined,
  required: ApiKeyScope,
): boolean {
  // Cognito users carry no scopes and are unrestricted — scope checks only
  // narrow API keys, they never widen anything.
  if (scopes === undefined) return true;
  return scopes.includes(required);
}
