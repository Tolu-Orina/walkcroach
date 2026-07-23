/**
 * Sync official CockroachDB Agent Skills into this package and codegen a
 * bundlable TypeScript module (esbuild-safe for the IDE VSIX).
 *
 * Source: https://github.com/cockroachlabs/cockroachdb-skills (Apache-2.0)
 *
 * Usage:
 *   node scripts/sync-cockroachdb-skills.mjs [/path/to/checkout]
 * If no path is given, clones a shallow copy into .tmp/cockroachdb-skills.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  cp,
  readdir,
  stat,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = join(__dirname, '..');
const VENDOR = join(PKG, 'vendor', 'cockroachdb-skills');
const OUT_TS = join(PKG, 'src', 'skills', 'cockroachdb-official.generated.ts');
const NOTICE = join(PKG, 'vendor', 'cockroachdb-skills', 'NOTICE');

function parseSkillMd(raw) {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) return { body: trimmed };
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return { body: trimmed };
  const front = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
  return {
    name: matchFront(front, 'name'),
    description: matchFront(front, 'description'),
    body,
  };
}

function matchFront(front, key) {
  const lines = front.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = line.match(new RegExp(`^${key}:\\s*(.*)$`, 'i'));
    if (!m) continue;
    let v = (m[1] ?? '').trim();
    if (v === '|' || v === '>' || v === '|-' || v === '>-') {
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        const L = lines[j] ?? '';
        if (/^[A-Za-z0-9_-]+:\s*/.test(L) && !/^\s/.test(L)) break;
        block.push(L.replace(/^\s{2}/, ''));
      }
      v = block.join('\n').trim();
    } else if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v || undefined;
  }
  return undefined;
}

async function walkSkillMarkdown(root) {
  /** @type {Array<{ skillDir: string, skillMd: string, references: Record<string, string> }>} */
  const found = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const skillMd = entries.find(
      (e) => e.isFile() && e.name === 'SKILL.md',
    );
    if (skillMd) {
      const skillPath = join(dir, 'SKILL.md');
      const references = {};
      const refDir = join(dir, 'references');
      try {
        const refs = await readdir(refDir, { withFileTypes: true });
        for (const r of refs) {
          if (!r.isFile() || !/\.md$/i.test(r.name)) continue;
          references[r.name] = await readFile(join(refDir, r.name), 'utf8');
        }
      } catch {
        /* no references */
      }
      found.push({ skillDir: dir, skillMd: skillPath, references });
      return; // do not recurse into references/
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'references' && e.name !== 'scripts') {
        await walk(join(dir, e.name));
      }
    }
  }

  await walk(root);
  return found;
}

function esc(s) {
  return JSON.stringify(s);
}

async function ensureSource(srcArg) {
  if (srcArg) return srcArg;
  const tmp = join(PKG, '.tmp', 'cockroachdb-skills');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(dirname(tmp), { recursive: true });
  const r = spawnSync(
    'git',
    ['clone', '--depth', '1', 'https://github.com/cockroachlabs/cockroachdb-skills.git', tmp],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    throw new Error('git clone failed — pass a local checkout path instead');
  }
  return tmp;
}

async function main() {
  const srcRoot = await ensureSource(process.argv[2]);
  const skillsSrc = join(srcRoot, 'skills');
  await stat(skillsSrc);

  await rm(VENDOR, { recursive: true, force: true });
  await mkdir(VENDOR, { recursive: true });
  await cp(skillsSrc, join(VENDOR, 'skills'), { recursive: true });
  try {
    await cp(join(srcRoot, 'LICENSE'), join(VENDOR, 'LICENSE'));
  } catch {
    /* optional */
  }

  await writeFile(
    NOTICE,
    [
      'WalkCroach bundles Agent Skills from:',
      '  https://github.com/cockroachlabs/cockroachdb-skills',
      'Copyright Cockroach Labs, Inc. and contributors.',
      'Licensed under the Apache License, Version 2.0.',
      'See vendor/cockroachdb-skills/LICENSE.',
      '',
    ].join('\n'),
    'utf8',
  );

  const entries = await walkSkillMarkdown(join(VENDOR, 'skills'));
  entries.sort((a, b) => a.skillMd.localeCompare(b.skillMd));

  /** @type {Array<{ name: string, description: string, body: string, references: Record<string, string>, rel: string }>} */
  const skills = [];
  for (const e of entries) {
    const raw = await readFile(e.skillMd, 'utf8');
    const parsed = parseSkillMd(raw);
    const fallback = relative(join(VENDOR, 'skills'), e.skillDir)
      .replace(/\\/g, '/')
      .split('/')
      .pop();
    const name = (parsed.name ?? fallback ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!name) continue;
    const description =
      parsed.description?.trim() ||
      `CockroachDB skill from ${relative(VENDOR, e.skillMd)}`;
    skills.push({
      name,
      description: description.slice(0, 1024),
      body: parsed.body.trim(),
      references: e.references,
      rel: relative(VENDOR, e.skillMd).replace(/\\/g, '/'),
    });
  }

  // Dedupe by name (first wins — stable path order).
  const seen = new Set();
  const unique = skills.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  const lines = [];
  lines.push('/**');
  lines.push(' * AUTO-GENERATED — do not edit by hand.');
  lines.push(' * Source: cockroachlabs/cockroachdb-skills (Apache-2.0)');
  lines.push(' * Regenerate: node scripts/sync-cockroachdb-skills.mjs');
  lines.push(` * Skills: ${unique.length}`);
  lines.push(' */');
  lines.push('');
  lines.push("import type { BundledSkill } from './bundled.js';");
  lines.push('');
  lines.push(
    'export const COCKROACHDB_OFFICIAL_SKILLS: BundledSkill[] = [',
  );
  for (const s of unique) {
    lines.push('  {');
    lines.push(`    name: ${esc(s.name)},`);
    lines.push(`    description: ${esc(s.description)},`);
    lines.push(`    body: ${esc(s.body)},`);
    if (Object.keys(s.references).length) {
      lines.push('    references: {');
      for (const [k, v] of Object.entries(s.references).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        lines.push(`      ${esc(k)}: ${esc(v)},`);
      }
      lines.push('    },');
    }
    lines.push(`    origin: ${esc(`cockroachlabs/cockroachdb-skills:${s.rel}`)},`);
    lines.push('  },');
  }
  lines.push('];');
  lines.push('');

  await mkdir(dirname(OUT_TS), { recursive: true });
  await writeFile(OUT_TS, lines.join('\n'), 'utf8');
  console.log(
    `Synced ${unique.length} skills → vendor/ + ${relative(PKG, OUT_TS)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
