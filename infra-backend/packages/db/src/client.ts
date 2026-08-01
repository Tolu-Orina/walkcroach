import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Pool } = pg;

export type DbClient = {
  pool: pg.Pool;
  /**
   * Single-statement query with automatic CockroachDB retry (see MAX_QUERY_ATTEMPTS).
   * Every call is its own implicit transaction — do NOT send BEGIN/COMMIT through
   * here (it throws); use `withTransaction` for multi-statement atomicity.
   */
  query: pg.Pool['query'];
  /**
   * Multi-statement transaction on one dedicated connection, retried as a unit
   * on serialization failures. `fn` may run more than once — keep it free of
   * non-idempotent side effects (S3 writes, Bedrock calls, metric emission).
   */
  withTransaction: <T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

/**
 * CockroachDB signals "this transaction did not commit, run it again" with
 * SQLSTATE 40001. It is the only code we retry: 40001 carries a guarantee that
 * nothing was committed, so replaying is safe.
 *
 * Connection-level errors (08006, 57P01, ECONNRESET) are deliberately NOT
 * retried. Those are ambiguous — the statement may well have committed before
 * the connection dropped, with only the acknowledgement lost. Replaying a credit
 * debit or an INSERT in that state would double-apply it, which is strictly
 * worse than surfacing the error to the caller.
 */
const RETRYABLE_SQLSTATE = '40001';
const MAX_QUERY_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 50;
const MAX_BACKOFF_MS = 1_000;

export function isRetryableDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ((err as { code?: unknown }).code === RETRYABLE_SQLSTATE) return true;
  // Older/proxied paths surface the retry hint in the message rather than `code`.
  const msg = (err as { message?: unknown }).message;
  return typeof msg === 'string' && /restart transaction|retry transaction/i.test(msg);
}

/** Full-jitter exponential backoff — spreads retries so contending txns don't re-collide. */
export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `pool.query` hands out an arbitrary pooled connection per call, so transaction
 * control sent through it lands on unrelated connections: the BEGIN opens a
 * transaction that is never committed, while the statements it was meant to wrap
 * autocommit individually elsewhere. It reads as a transaction and provides none
 * of the atomicity, so it is refused outright rather than silently tolerated.
 */
const TXN_CONTROL =
  /^\s*(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT)\b/i;

function assertNotTransactionControl(sql: unknown): void {
  if (typeof sql === 'string' && TXN_CONTROL.test(sql)) {
    const verb = sql.trim().split(/\s+/)[0];
    throw new Error(
      `Transaction control ("${verb}") cannot be sent through db.query — it would run ` +
        'on an arbitrary pooled connection. Use db.withTransaction(fn) instead.',
    );
  }
}

/**
 * TLS policy. CockroachDB Cloud presents a publicly-trusted certificate, so
 * Node's default trust store verifies it with no extra configuration.
 *
 * This previously passed `rejectUnauthorized: false`, which silently downgraded
 * every connection to unverified TLS and contradicted the `sslmode=verify-full`
 * documented in .env.example. Verification is now on by default.
 *
 * Escape hatches, in order of preference:
 *   CRDB_CA_CERT       inline PEM, or a path to one (self-hosted / custom CA)
 *   CRDB_SSL_INSECURE  'true' restores the old unverified behaviour, loudly
 */
export function buildSslConfig(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): pg.ConnectionConfig['ssl'] {
  if (connectionString.includes('sslmode=disable')) return false;

  if (env.CRDB_SSL_INSECURE === 'true') {
    console.warn(
      '[walkcroach/db] CRDB_SSL_INSECURE=true — TLS certificate verification is DISABLED. ' +
        'Connections are exposed to man-in-the-middle. Never set this in production.',
    );
    return { rejectUnauthorized: false };
  }

  const ca = env.CRDB_CA_CERT?.trim();
  if (ca) {
    return {
      rejectUnauthorized: true,
      ca: ca.startsWith('-----BEGIN') ? ca : readFileSync(ca, 'utf8'),
    };
  }

  return { rejectUnauthorized: true };
}

export function createDbClient(
  connectionString?: string,
  opts?: { applicationName?: string },
): DbClient {
  const cs = connectionString ?? process.env.CRDB_CONNECTION_STRING;
  if (!cs) {
    throw new Error('CRDB_CONNECTION_STRING is required');
  }

  const pool = new Pool({
    connectionString: cs,
    ssl: buildSslConfig(cs),
    max: 5,
    // Surfaces per-surface load in the DB Console's statement/transaction
    // fingerprint views, so "which surface is driving this contention" is
    // answerable without correlating CloudWatch by hand.
    application_name:
      opts?.applicationName ?? process.env.WALKCROACH_SURFACE ?? 'walkcroach',
  });

  const rawQuery = pool.query.bind(pool) as (
    ...args: unknown[]
  ) => Promise<unknown>;

  const query = (async (...args: unknown[]) => {
    assertNotTransactionControl(args[0]);
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_QUERY_ATTEMPTS; attempt++) {
      try {
        return await rawQuery(...args);
      } catch (err) {
        lastErr = err;
        if (!isRetryableDbError(err) || attempt === MAX_QUERY_ATTEMPTS - 1) throw err;
        await sleep(retryDelayMs(attempt));
      }
    }
    throw lastErr;
  }) as pg.Pool['query'];

  const withTransaction = async <T>(
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_QUERY_ATTEMPTS; attempt++) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Connection may already be unusable; release below still returns it.
        }
        lastErr = err;
        if (!isRetryableDbError(err) || attempt === MAX_QUERY_ATTEMPTS - 1) throw err;
        await sleep(retryDelayMs(attempt));
      } finally {
        client.release();
      }
    }
    throw lastErr;
  };

  return {
    pool,
    query,
    withTransaction,
    close: async () => {
      await pool.end();
    },
  };
}
