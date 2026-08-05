/**
 * Spike: is the C-SPANN vector index still eligible under AS OF SYSTEM TIME?
 *
 * Blocks the SDK's `asOf()` / `diff()` design (docs/walkcroach-sdk-implementation-plan.md §5.3).
 * Migrations 026–032 established that a vector index is only used when every prefix
 * column is constrained. Nothing in that work tested a historical read. If the planner
 * drops the index under AS OF SYSTEM TIME, `asOf()` recall is a brute-force scan and
 * must be documented and rate-limited as one rather than sold as semantic search.
 *
 * Read-only. Runs EXPLAIN, never the query itself. Safe against prod.
 *
 *   node infra-backend/scripts/spike-asof-vector.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function loadEnv() {
  for (const rel of ['.env', 'infra-backend/.env']) {
    try {
      const raw = readFileSync(resolve(repoRoot, rel), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (!m) continue;
        const [, k, v] = m;
        if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '').trim();
      }
    } catch {
      /* optional */
    }
  }
}
loadEnv();

const cs = process.env.CRDB_CONNECTION_STRING;
if (!cs) {
  console.error('CRDB_CONNECTION_STRING is required (repo .env)');
  process.exit(1);
}

// A synthetic unit-ish vector. Index eligibility is a planner decision, so the
// values are irrelevant — only the type and dimensionality matter.
const DIM = 1024;
const probeVec = `[${Array.from({ length: DIM }, (_, i) => (Math.sin(i) / 32).toFixed(6)).join(',')}]`;
const PROBE_PROJECT = '00000000-0000-0000-0000-000000000001';

/** The exact shape recallProjectMemory issues (agent-harness/src/memory.ts). */
const RECALL_SQL = `
  SELECT id, kind, text, source_surface,
         embedding <=> $2::vector AS distance
    FROM memory_entries
   WHERE project_id = $1::uuid
     AND superseded_by IS NULL
   ORDER BY embedding <=> $2::vector
   LIMIT $3`;

/** Same query, read at a historical timestamp. */
const RECALL_SQL_ASOF = `
  SELECT id, kind, text, source_surface,
         embedding <=> $2::vector AS distance
    FROM memory_entries AS OF SYSTEM TIME '-30s'
   WHERE project_id = $1::uuid
     AND superseded_by IS NULL
   ORDER BY embedding <=> $2::vector
   LIMIT $3`;

function usesVectorIndex(plan) {
  return /vector search/i.test(plan);
}
function prefixSpans(plan) {
  const m = /prefix spans:.*/i.exec(plan);
  return m ? m[0].trim() : null;
}

async function explain(db, label, sql) {
  try {
    const { rows } = await db.query(`EXPLAIN ${sql}`, [PROBE_PROJECT, probeVec, 32]);
    const plan = rows.map((r) => Object.values(r)[0]).join('\n');
    const ok = usesVectorIndex(plan);
    console.log(`\n─── ${label} ${'─'.repeat(Math.max(0, 54 - label.length))}`);
    console.log(ok ? '  INDEX: ✅ vector search in plan' : '  INDEX: ❌ NO vector search — full scan');
    const spans = prefixSpans(plan);
    if (spans) console.log(`  ${spans}`);
    console.log(
      plan
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    );
    return ok;
  } catch (err) {
    console.log(`\n─── ${label} ${'─'.repeat(Math.max(0, 54 - label.length))}`);
    console.log(`  ERROR: ${err.message}`);
    return null;
  }
}

const pool = new pg.Pool({
  connectionString: cs,
  ssl: cs.includes('sslmode=disable') ? false : { rejectUnauthorized: true },
  max: 2,
  application_name: 'walkcroach-sdk-spike',
});

try {
  console.log('WalkCroach SDK spike — AS OF SYSTEM TIME × vector index');
  console.log('='.repeat(62));

  const { rows: ver } = await pool.query('SELECT version()');
  console.log(`\nCluster: ${ver[0].version.split(' ').slice(0, 3).join(' ')}`);

  // ── 1. Retention window ────────────────────────────────────────────────
  // gc.ttlseconds bounds how far back asOf() can ever read. Whatever the SDK
  // documents as its provenance window must be <= this.
  console.log('\n─── Retention (gc.ttlseconds) ' + '─'.repeat(33));
  for (const target of ['TABLE memory_entries', 'DATABASE defaultdb', 'RANGE default']) {
    try {
      const { rows } = await pool.query(
        `SELECT raw_config_sql FROM [SHOW ZONE CONFIGURATION FOR ${target}]`,
      );
      const sql = rows[0]?.raw_config_sql ?? '';
      const ttl = /gc\.ttlseconds\s*=\s*(\d+)/.exec(sql);
      if (ttl) {
        const secs = Number(ttl[1]);
        console.log(
          `  ${target.padEnd(22)} gc.ttlseconds = ${secs}  (${(secs / 3600).toFixed(1)}h)`,
        );
      } else {
        console.log(`  ${target.padEnd(22)} (inherits)`);
      }
    } catch (err) {
      console.log(`  ${target.padEnd(22)} n/a — ${err.message.split('\n')[0]}`);
    }
  }

  // ── 1b. Table size + index presence ────────────────────────────────────
  // A cost-based scan on a tiny table is NOT the same failure as an ineligible
  // index. Establish which one we are looking at before drawing conclusions.
  console.log('\n─── Table + index state ' + '─'.repeat(39));
  const { rows: cnt } = await pool.query('SELECT count(*)::int AS n FROM memory_entries');
  console.log(`  memory_entries rows: ${cnt[0].n}`);
  const { rows: idx } = await pool.query(
    `SELECT index_name FROM [SHOW INDEXES FROM memory_entries]
      WHERE index_name LIKE '%recall%' GROUP BY index_name`,
  );
  console.log(
    idx.length
      ? `  recall index present: ${idx.map((r) => r.index_name).join(', ')}`
      : '  ❌ memory_entries_recall_idx MISSING — migration 032 not applied here',
  );

  // ── 2. Index eligibility, now vs historical ────────────────────────────
  const nowOk = await explain(pool, 'Present-time recall (baseline)', RECALL_SQL);
  const asofOk = await explain(pool, "AS OF SYSTEM TIME '-30s'", RECALL_SQL_ASOF);

  // ── 2b. FORCED index — the eligibility test ────────────────────────────
  // This is the question that actually matters. If forcing raises
  // "index ... cannot be used for this query", the index is INELIGIBLE and the
  // 026–032 contract is broken again. If it plans, the index is eligible and
  // the scans above are just the planner being right about a tiny table.
  const forcedNow = await explain(
    pool,
    'FORCED index, present-time',
    RECALL_SQL.replace('FROM memory_entries', 'FROM memory_entries@memory_entries_recall_idx'),
  );
  const forcedAsof = await explain(
    pool,
    'FORCED index, AS OF SYSTEM TIME',
    RECALL_SQL_ASOF.replace(
      'FROM memory_entries AS OF SYSTEM TIME',
      'FROM memory_entries@memory_entries_recall_idx AS OF SYSTEM TIME',
    ),
  );
  console.log('\n─── Eligibility summary ' + '─'.repeat(39));
  console.log(`  forced present-time : ${forcedNow === true ? '✅ eligible' : forcedNow === false ? '⚠️ planned without vector search' : '❌ refused'}`);
  console.log(`  forced AS OF        : ${forcedAsof === true ? '✅ eligible' : forcedAsof === false ? '⚠️ planned without vector search' : '❌ refused'}`);

  // ── 3. Verdict ─────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(62)}\nVERDICT`);
  if (forcedNow === null) {
    console.log('  ❌ INDEX INELIGIBLE at present time — the 026–032 contract is broken.');
    console.log('      This is a memory-layer bug, not an SDK one. Fix before asOf().');
  } else if (forcedNow === true && forcedAsof === null) {
    console.log('  ⚠️  asOf() CANNOT use the vector index — historical recall is a scan.');
    console.log('      Ship asOf() as scan-based, hard-capped LIMIT, rate-limited.');
  } else if (forcedNow === true && forcedAsof === true) {
    console.log('  ✅ GO — the index is eligible both at present time and historically.');
    console.log('      Unforced scans above are the planner costing a tiny table, not a defect.');
  } else if (nowOk === false) {
    console.log('  ⚠️  BASELINE IS BROKEN — present-time recall is not using the index.');
    console.log('      Fix that before drawing any conclusion about asOf().');
  } else if (asofOk === true) {
    console.log('  ✅ GO — historical recall keeps the vector index.');
    console.log('      asOf() ships as real semantic search over past state.');
  } else if (asofOk === false) {
    console.log('  ⚠️  DEGRADED — historical recall drops to a full scan.');
    console.log('      asOf() must be documented as a scan, rate-limited, and');
    console.log('      capped at a small LIMIT. Plan §10 fallback applies.');
  } else {
    console.log('  ❌ ERROR — AS OF SYSTEM TIME did not plan. See error above.');
  }
  console.log('='.repeat(62));
} finally {
  await pool.end();
}
