import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `pg` is mocked so these run with no cluster: Pool records the config it was
 * constructed with and hands back a scripted query implementation.
 */
const poolConfigs: Array<Record<string, unknown>> = [];
let queryImpl: (...args: unknown[]) => Promise<unknown> = async () => ({ rows: [] });
const released: number[] = [];

class FakePool {
  constructor(config: Record<string, unknown>) {
    poolConfigs.push(config);
  }
  query(...args: unknown[]) {
    return queryImpl(...args);
  }
  async connect() {
    return {
      query: (...args: unknown[]) => queryImpl(...args),
      release: () => released.push(1),
    };
  }
  async end() {}
}

vi.mock('pg', () => ({ default: { Pool: FakePool } }));

const { createDbClient, buildSslConfig, isRetryableDbError, retryDelayMs } =
  await import('./client.js');

/** Shaped like a pg error: SQLSTATE lives on `.code`. */
function serializationFailure(): Error & { code: string } {
  return Object.assign(new Error('restart transaction: TransactionRetryError'), {
    code: '40001',
  });
}

beforeEach(() => {
  poolConfigs.length = 0;
  released.length = 0;
  queryImpl = async () => ({ rows: [] });
});

describe('buildSslConfig', () => {
  it('disables TLS only when the connection string opts out', () => {
    expect(buildSslConfig('postgresql://h/db?sslmode=disable', {})).toBe(false);
  });

  it('verifies certificates by default', () => {
    expect(buildSslConfig('postgresql://h/db?sslmode=verify-full', {})).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('accepts an inline CA without disabling verification', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';
    expect(buildSslConfig('postgresql://h/db', { CRDB_CA_CERT: ca })).toEqual({
      rejectUnauthorized: true,
      ca,
    });
  });

  it('only disables verification behind the explicit, loud opt-out', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(buildSslConfig('postgresql://h/db', { CRDB_SSL_INSECURE: 'true' })).toEqual({
      rejectUnauthorized: false,
    });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('is not disabled by a merely truthy-looking value', () => {
    expect(buildSslConfig('postgresql://h/db', { CRDB_SSL_INSECURE: '1' })).toEqual({
      rejectUnauthorized: true,
    });
  });
});

describe('isRetryableDbError', () => {
  it('retries SQLSTATE 40001', () => {
    expect(isRetryableDbError(serializationFailure())).toBe(true);
  });

  it('retries when only the message carries the retry hint', () => {
    expect(isRetryableDbError(new Error('restart transaction'))).toBe(true);
  });

  it('does NOT retry ambiguous connection failures', () => {
    // These may have committed before the connection dropped — replaying could
    // double-apply a debit, so they must surface to the caller.
    for (const code of ['08006', '57P01', 'ECONNRESET']) {
      expect(isRetryableDbError(Object.assign(new Error('conn'), { code }))).toBe(false);
    }
  });

  it('does not retry ordinary SQL errors or non-errors', () => {
    expect(isRetryableDbError(Object.assign(new Error('dup'), { code: '23505' }))).toBe(
      false,
    );
    expect(isRetryableDbError(null)).toBe(false);
    expect(isRetryableDbError('40001')).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('grows exponentially and stays within the jitter ceiling', () => {
    expect(retryDelayMs(0, () => 1)).toBe(50);
    expect(retryDelayMs(1, () => 1)).toBe(100);
    expect(retryDelayMs(2, () => 1)).toBe(200);
  });

  it('caps the ceiling so a retry storm cannot stall a Lambda', () => {
    expect(retryDelayMs(20, () => 1)).toBe(1000);
  });

  it('applies full jitter, so contending transactions do not re-collide', () => {
    expect(retryDelayMs(3, () => 0)).toBe(0);
  });
});

describe('createDbClient — pool configuration', () => {
  it('tags connections with an application_name for DB Console fingerprints', () => {
    createDbClient('postgresql://h/db', { applicationName: 'walkcroach-ide' });
    expect(poolConfigs[0]?.application_name).toBe('walkcroach-ide');
  });

  it('never constructs a pool with verification disabled by default', () => {
    createDbClient('postgresql://h/db');
    expect(poolConfigs[0]?.ssl).toEqual({ rejectUnauthorized: true });
  });
});

describe('createDbClient — query retry', () => {
  it('replays a serialization failure and returns the eventual success', async () => {
    let calls = 0;
    queryImpl = async () => {
      calls++;
      if (calls < 3) throw serializationFailure();
      return { rows: [{ ok: true }] };
    };
    const db = createDbClient('postgresql://h/db');
    await expect(db.query('SELECT 1')).resolves.toEqual({ rows: [{ ok: true }] });
    expect(calls).toBe(3);
  });

  it('gives up after the attempt budget rather than retrying forever', async () => {
    let calls = 0;
    queryImpl = async () => {
      calls++;
      throw serializationFailure();
    };
    const db = createDbClient('postgresql://h/db');
    await expect(db.query('SELECT 1')).rejects.toThrow(/restart transaction/);
    expect(calls).toBe(5);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    queryImpl = async () => {
      calls++;
      throw Object.assign(new Error('syntax error'), { code: '42601' });
    };
    const db = createDbClient('postgresql://h/db');
    await expect(db.query('SELEC 1')).rejects.toThrow(/syntax error/);
    expect(calls).toBe(1);
  });
});

describe('createDbClient — transaction-control guard', () => {
  it.each(['BEGIN', 'begin', '  COMMIT', 'ROLLBACK', 'START TRANSACTION'])(
    'refuses %s sent through the pooled query',
    async (sql) => {
      const db = createDbClient('postgresql://h/db');
      await expect(db.query(sql)).rejects.toThrow(/withTransaction/);
    },
  );

  it('allows ordinary statements that merely mention a keyword', async () => {
    queryImpl = async () => ({ rows: [] });
    const db = createDbClient('postgresql://h/db');
    await expect(
      db.query("SELECT 'BEGIN' AS marker FROM sessions"),
    ).resolves.toEqual({ rows: [] });
  });
});

describe('createDbClient — withTransaction', () => {
  it('wraps the callback in BEGIN/COMMIT and releases the connection', async () => {
    const seen: string[] = [];
    queryImpl = async (sql: unknown) => {
      seen.push(String(sql));
      return { rows: [] };
    };
    const db = createDbClient('postgresql://h/db');
    const out = await db.withTransaction(async (tx) => {
      await tx.query('UPDATE t SET a = 1');
      return 'done';
    });
    expect(out).toBe('done');
    expect(seen).toEqual(['BEGIN', 'UPDATE t SET a = 1', 'COMMIT']);
    expect(released).toHaveLength(1);
  });

  it('rolls back and releases when the callback throws', async () => {
    const seen: string[] = [];
    queryImpl = async (sql: unknown) => {
      seen.push(String(sql));
      if (String(sql).startsWith('UPDATE')) throw new Error('boom');
      return { rows: [] };
    };
    const db = createDbClient('postgresql://h/db');
    await expect(
      db.withTransaction(async (tx) => tx.query('UPDATE t SET a = 1')),
    ).rejects.toThrow('boom');
    expect(seen).toContain('ROLLBACK');
    expect(seen).not.toContain('COMMIT');
    expect(released).toHaveLength(1);
  });

  it('replays the whole transaction on a serialization failure', async () => {
    let attempts = 0;
    queryImpl = async (sql: unknown) => {
      if (String(sql) === 'COMMIT') {
        attempts++;
        if (attempts < 2) throw serializationFailure();
      }
      return { rows: [] };
    };
    const db = createDbClient('postgresql://h/db');
    let bodyRuns = 0;
    await db.withTransaction(async () => {
      bodyRuns++;
    });
    // The callback re-runs: it must stay free of non-idempotent side effects.
    expect(bodyRuns).toBe(2);
    expect(released).toHaveLength(2);
  });
});
