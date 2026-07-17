/**
 * Phase 0 smoke: create project → write preference memory → recall by similarity.
 *
 * Requires CRDB_CONNECTION_STRING and AWS credentials with Bedrock access.
 *
 *   cd infra-backend && npm run smoke:memory
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient } from '@walkcroach/db';
import { recallProjectMemory, writeMemoryEntry } from './memory.js';

function loadEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const path = join(root, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  const db = createDbClient();
  try {
    const { rows: projects } = await db.query<{ id: string }>(
      `INSERT INTO projects (owner_id, name, surface_origin)
       VALUES ('smoke', 'Smoke Test Project', 'web')
       RETURNING id`,
    );
    const projectId = projects[0]!.id;
    console.log('project', projectId);

    const memId = await writeMemoryEntry({
      db,
      projectId,
      sourceSurface: 'web',
      kind: 'preference',
      text: 'User prefers muted tones and non-salesy landing-page copy',
    });
    console.log('wrote memory', memId);

    const hits = await recallProjectMemory({
      db,
      projectId,
      query: 'what style should the landing page use?',
      limit: 3,
    });

    console.log('recall hits:');
    for (const h of hits) {
      console.log(`  [${h.kind}] dist=${h.distance?.toFixed(4)} ${h.text}`);
    }

    if (hits.length === 0) {
      throw new Error('Expected at least one memory hit');
    }
    console.log('smoke:memory OK');
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
