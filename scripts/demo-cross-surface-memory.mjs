#!/usr/bin/env node
/**
 * Demo: one remember per surface (web, chrome, ide, cli, desktop), then one recall.
 * Phase P2 exit criterion — target under 60s against a local or staging API.
 *
 * Usage (ide-api local on :3003 with ALLOW_DEV_AUTH):
 *   ALLOW_DEV_AUTH=true WALKCROACH_IDE_URL=http://localhost:3003 \
 *     node scripts/demo-cross-surface-memory.mjs
 */
import { randomUUID } from 'node:crypto';

const ide = (process.env.WALKCROACH_IDE_URL ?? 'http://localhost:3003').replace(
  /\/$/,
  '',
);
const owner = `user:demo-${randomUUID()}`;
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
const marker = `demo-${randomUUID().slice(0, 8)}`;

const created = await req('POST', `${ide}/ide/v1/projects`, {
  name: `Demo ${marker}`,
  surfaceOrigin: 'cli',
});
const projectId = created.project?.id ?? created.id;
if (!projectId) throw new Error(`no project id: ${JSON.stringify(created)}`);

const surfaces = [
  ['web', 'decision'],
  ['chrome', 'capture'],
  ['ide', 'preference'],
  ['cli', 'convention'],
  ['desktop', 'summary'],
];
for (const [surface, kind] of surfaces) {
  await req('POST', v1('/memory/entries'), {
    projectId,
    text: `${surface} remembers Cockroach-backed memory (${marker})`,
    kind,
    surface,
  });
  process.stdout.write(`wrote ${surface}\n`);
}

const recall = await req('POST', v1('/memory/recall'), {
  projectId,
  query: marker,
  limit: 10,
  surfaces: surfaces.map(([s]) => s),
});

const hits = recall.hits ?? [];
const found = new Set(hits.map((h) => h.surface));
const missing = surfaces.map(([s]) => s).filter((s) => !found.has(s));
const ms = Date.now() - started;

process.stdout.write(
  JSON.stringify(
    {
      ok: missing.length === 0 && ms < 60_000,
      ms,
      projectId,
      marker,
      hitSurfaces: [...found],
      missing,
      hitCount: hits.length,
    },
    null,
    2,
  ) + '\n',
);

if (missing.length > 0 || ms >= 60_000) process.exit(1);
