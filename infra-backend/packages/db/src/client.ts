import pg from 'pg';

const { Pool } = pg;

export type DbClient = {
  pool: pg.Pool;
  query: pg.Pool['query'];
  close: () => Promise<void>;
};

export function createDbClient(connectionString?: string): DbClient {
  const cs = connectionString ?? process.env.CRDB_CONNECTION_STRING;
  if (!cs) {
    throw new Error('CRDB_CONNECTION_STRING is required');
  }

  const pool = new Pool({
    connectionString: cs,
    ssl: cs.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    max: 5,
  });

  return {
    pool,
    query: pool.query.bind(pool),
    close: async () => {
      await pool.end();
    },
  };
}
