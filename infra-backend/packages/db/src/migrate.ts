import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient } from './client.js';
import { loadEnv } from './load-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

async function main() {
  loadEnv(join(__dirname, '..', '..', '..'));
  const db = createDbClient();
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id STRING PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await db.query(
        'SELECT 1 FROM schema_migrations WHERE id = $1',
        [file],
      );
      if (rows.length > 0) {
        console.log(`skip ${file}`);
        continue;
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      console.log(`apply ${file}`);
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    }

    console.log('migrations complete');
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
