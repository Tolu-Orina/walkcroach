#!/usr/bin/env node
/**
 * P1 APIGW fitness — public SDK routes reach lambda-ide (not 404).
 *
 * Shared GW stage is already `v1` → probe /sdk-health, /keys, /memory/recall.
 * ide-local (:3003) uses /v1/sdk-health, /v1/keys, /v1/memory/recall.
 *
 * Usage:
 *   WALKCROACH_API_URL=https://api…/v1 node scripts/verify-sdk-apigw.mjs
 *   WALKCROACH_IDE_URL=http://localhost:3003 node scripts/verify-sdk-apigw.mjs
 */
const raw =
  process.env.WALKCROACH_API_URL ??
  process.env.WALKCROACH_IDE_URL ??
  'http://localhost:3003';

const base = raw.replace(/\/$/, '');
const sharedStage = /\/v1$/i.test(base) || base.includes('execute-api');

function url(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (sharedStage) return `${base}${p}`;
  return `${base}/v1${p}`;
}

async function probe(method, path, expectStatus) {
  const target = url(path);
  const res = await fetch(target, {
    method,
    headers:
      method === 'POST'
        ? { 'content-type': 'application/json', accept: 'application/json' }
        : { accept: 'application/json' },
    body:
      method === 'POST'
        ? JSON.stringify({
            projectId: '00000000-0000-4000-8000-000000000000',
            query: 'fitness',
            limit: 1,
          })
        : undefined,
  });
  const ok = expectStatus.includes(res.status);
  return {
    ok,
    method,
    path,
    target,
    status: res.status,
    expectStatus,
  };
}

const checks = [];
try {
  checks.push(await probe('GET', '/sdk-health', [200]));
  checks.push(await probe('GET', '/keys', [401, 403]));
  checks.push(await probe('POST', '/memory/recall', [401, 403]));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        base,
        sharedStage,
        error: message,
        note:
          'Could not reach API — start ide-local (:3003) or set WALKCROACH_API_URL to the shared stage',
      },
      null,
      2,
    ) + '\n',
  );
  process.exit(1);
}

const failed = checks.filter((c) => !c.ok);
process.stdout.write(
  JSON.stringify(
    {
      ok: failed.length === 0,
      base,
      sharedStage,
      checks,
      note:
        failed.length === 0
          ? 'APIGW /v1 SDK routes look wired (health 200; auth endpoints not 404)'
          : 'One or more probes failed — apply apigw-rest/sdk.tf or fix base URL',
    },
    null,
    2,
  ) + '\n',
);

if (failed.length) process.exit(1);
