#!/usr/bin/env node
/**
 * P0 moat demo: remember as chrome → recall as ide would.
 * Target: under 30s against local or staging ide-api.
 *
 * Usage:
 *   ALLOW_DEV_AUTH=true WALKCROACH_IDE_URL=http://localhost:3003 \
 *     node scripts/demo-chrome-to-ide-30s.mjs
 *
 * Human UI counterpart: docs/dual-funnel-messaging.md §4
 */
import { randomUUID } from 'node:crypto';

const ide = (process.env.WALKCROACH_IDE_URL ?? 'http://localhost:3003').replace(
  /\/$/,
  '',
);
const owner = `user:demo-p0-${randomUUID()}`;
const auth = {
  authorization: `Bearer dev:${owner}`,
  'content-type': 'application/json',
  accept: 'application/json',
};

function v1(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${ide}/v1${p}`;
}

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: auth,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

const started = Date.now();
const marker = `p0-${randomUUID().slice(0, 8)}`;
const decision = `Prefer Drizzle over Prisma for edge (${marker})`;

const created = await req('POST', `${ide}/ide/v1/projects`, {
  name: `P0 Chrome→IDE ${marker}`,
  surfaceOrigin: 'chrome',
});
const projectId = created.project?.id ?? created.id;
if (!projectId) throw new Error(`no project id: ${JSON.stringify(created)}`);

await req('POST', v1('/memory/entries'), {
  projectId,
  text: decision,
  kind: 'decision',
  surface: 'chrome',
});
process.stdout.write('wrote chrome decision\n');

const recall = await req('POST', v1('/memory/recall'), {
  projectId,
  query: marker,
  limit: 5,
  surfaces: ['chrome', 'ide'],
});

const hits = recall.hits ?? [];
const chromeHit = hits.find(
  (h) => h.surface === 'chrome' && String(h.text ?? '').includes(marker),
);
const ms = Date.now() - started;
const ok = Boolean(chromeHit) && ms < 30_000;

process.stdout.write(
  JSON.stringify(
    {
      ok,
      ms,
      projectId,
      marker,
      chromeSurfaceVisible: Boolean(chromeHit),
      hitSurfaces: [...new Set(hits.map((h) => h.surface))],
      hitCount: hits.length,
      narrative:
        'Chrome remember → IDE-scoped recall sees source_surface chrome (moat demo)',
    },
    null,
    2,
  ) + '\n',
);

if (!ok) process.exit(1);
