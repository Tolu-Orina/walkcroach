#!/usr/bin/env node
/**
 * P4 coding-surface moat demo: remember as chrome → format/assert as CLI would.
 *
 * Exit criteria: a coding surface demo leads with cross-surface recall showing
 * source_surface. Seeds via API (same graph IDE/CLI use), then formats hits with
 * the same provenance contract as `cli/src/lib/memory-format.ts`.
 *
 * Usage:
 *   ALLOW_DEV_AUTH=true WALKCROACH_IDE_URL=http://localhost:3003 \
 *     node scripts/demo-coding-surface-recall.mjs
 *
 * Human UI: IDE recall chips; CLI `walkcroach memory list`.
 * Companion: docs/dual-funnel-messaging.md §4 · docs/coding-wedge-p4.md
 */
import { randomUUID } from 'node:crypto';

/** Mirrors cli/src/lib/memory-format.ts — keep in sync. */
function formatMemoryHitsText(hits) {
  if (!hits.length) return '(no matching project memory)';
  return hits
    .map((h, i) => {
      const surface = (h.sourceSurface ?? '?').toLowerCase();
      const kind = h.kind ? ` · ${h.kind}` : '';
      const score =
        typeof h.relevance === 'number' ? ` · ${h.relevance.toFixed(2)}` : '';
      const text = String(h.text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return `${i + 1}. [${surface}${kind}${score}] ${text}`;
    })
    .join('\n');
}

const ide = (process.env.WALKCROACH_IDE_URL ?? 'http://localhost:3003').replace(
  /\/$/,
  '',
);
const owner = `user:demo-p4-${randomUUID()}`;
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
const marker = `p4-${randomUUID().slice(0, 8)}`;
const decision = `Prefer Drizzle over Prisma for edge (${marker})`;

const created = await req('POST', `${ide}/ide/v1/projects`, {
  name: `P4 CLI recall ${marker}`,
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
});

const hits = (recall.hits ?? []).map((h) => ({
  sourceSurface: h.surface ?? h.sourceSurface,
  kind: h.kind,
  text: h.text,
  relevance: h.relevance,
}));

const formatted = formatMemoryHitsText(hits);
process.stdout.write(`${formatted}\n`);

const chromeHit = hits.find(
  (h) =>
    String(h.sourceSurface).toLowerCase() === 'chrome' &&
    String(h.text ?? '').includes(marker),
);
const formattedHasChrome = /\[chrome\b/i.test(formatted);
const ms = Date.now() - started;
const ok = Boolean(chromeHit) && formattedHasChrome && ms < 60_000;

process.stdout.write(
  `${JSON.stringify(
    {
      ok,
      ms,
      projectId,
      marker,
      surface: chromeHit?.sourceSurface ?? null,
      formattedPreview: formatted.slice(0, 200),
      note: 'Coding-surface contract: CLI memory list / IDE recall chips show source_surface',
    },
    null,
    2,
  )}\n`,
);

process.exit(ok ? 0 : 1);
