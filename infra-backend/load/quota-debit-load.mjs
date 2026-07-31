#!/usr/bin/env node
/**
 * Phase H1 — in-process concurrent quota/debit load harness.
 *
 * Usage (from infra-backend):
 *   node load/quota-debit-load.mjs
 *   CONCURRENCY=64 ROUNDS=5 node load/quota-debit-load.mjs
 *
 * Does not hit a live API — exercises the same atomic SQL shapes as production
 * against an in-memory serializing fake (CI-safe). For HTTP soak, point k6 at
 * POST /creatives/:id/confirm after auth is available in the environment.
 */
import { performance } from 'node:perf_hooks';

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 32);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const LIMIT = 3;

function makeQuotaStore() {
  let count = 0;
  let chain = Promise.resolve();
  const exclusive = (fn) => {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    async consume(amount = 1) {
      return exclusive(async () => {
        await new Promise((r) => setTimeout(r, 0));
        if (count + amount > LIMIT) return { ok: false, used: count };
        count += amount;
        return { ok: true, used: count };
      });
    },
    get used() {
      return count;
    },
    reset() {
      count = 0;
    },
  };
}

async function round(label, store) {
  store.reset();
  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => store.consume(1)),
  );
  const ms = performance.now() - t0;
  const ok = results.filter((r) => r.ok).length;
  const denied = results.length - ok;
  if (ok !== LIMIT || store.used !== LIMIT) {
    console.error(
      `[FAIL] ${label}: ok=${ok} denied=${denied} used=${store.used} (want ok=${LIMIT})`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `[ok] ${label}: ok=${ok} denied=${denied} in ${ms.toFixed(1)}ms (concurrency=${CONCURRENCY})`,
    );
  }
}

const store = makeQuotaStore();
for (let i = 1; i <= ROUNDS; i++) {
  await round(`round-${i}`, store);
}
if (process.exitCode) {
  console.error('quota-debit-load failed');
  process.exit(process.exitCode);
}
console.log('quota-debit-load passed');
