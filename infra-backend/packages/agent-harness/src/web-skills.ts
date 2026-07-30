/**
 * Progressive loader for WalkCroach Web Agent Skills (skills/web).
 *
 * Mirrors Anthropic's skills pattern: the system prompt gets a tiny catalog of
 * skill name+description (metadata only), and the model calls `load_skill` to
 * pull the full SKILL.md body when a task matches. Scripts inside each skill
 * are load-bearing and are executed later by Phase B/Creative Lambda — Phase A
 * only registers the skill catalog and body, not script execution.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SkillMeta = {
  name: string;
  description: string;
  /** Absolute path to the skill directory. */
  dir: string;
};

type ParsedFrontMatter = {
  name?: string;
  description?: string;
};

function parseFrontMatter(body: string): ParsedFrontMatter {
  // YAML-lite: only the first --- block, name:/description: keys.
  const m = /^---\n([\s\S]*?)\n---/.exec(body);
  if (!m) return {};
  const out: ParsedFrontMatter = {};
  for (const line of m[1]!.split('\n')) {
    const k = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!k) continue;
    const val = k[2]!.replace(/^["']|["']$/g, '').trim();
    if (k[1] === 'name') out.name = val;
    if (k[1] === 'description') out.description = val;
  }
  return out;
}

let cache: { root: string; metas: SkillMeta[] } | null = null;

function candidatesFromEnv(): string[] {
  const env = process.env.WALKCROACH_WEB_SKILLS_DIR;
  if (!env) return [];
  return [env];
}

function defaultCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    // dist/  →  packages/agent-harness/dist  →  repo/skills/web
    resolve(here, '../../../../skills/web'),
    // src/  →  packages/agent-harness/src  →  repo/skills/web
    resolve(here, '../../../skills/web'),
    // Lambda bundle cwd → /opt or code-adjacent copy
    resolve(process.cwd(), 'skills/web'),
  ];
}

function discoverRoot(): string | null {
  for (const c of [...candidatesFromEnv(), ...defaultCandidates()]) {
    if (existsSync(c) && existsSync(resolve(c, 'README.md'))) return c;
    if (existsSync(c)) return c;
  }
  return null;
}

export function listWebSkillMetas(): SkillMeta[] {
  if (cache) return cache.metas;
  const root = discoverRoot();
  if (!root) {
    cache = { root: '', metas: [] };
    return [];
  }
  const metas: SkillMeta[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('walkcroach-'))
      .map((d) => d.name)
      .sort();
  } catch {
    dirs = [];
  }
  for (const name of dirs) {
    const dir = resolve(root, name);
    const skillFile = resolve(dir, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      const body = readFileSync(skillFile, 'utf8');
      const fm = parseFrontMatter(body);
      metas.push({
        name: fm.name ?? name,
        description: fm.description ?? '',
        dir,
      });
    } catch {
      // ignore unreadable skill
    }
  }
  cache = { root, metas };
  return metas;
}

export function loadWebSkill(name: string): string | null {
  const meta = listWebSkillMetas().find(
    (m) => m.name === name || m.dir.endsWith(`/${name}`) || m.dir.endsWith(`\\${name}`),
  );
  if (!meta) return null;
  const file = resolve(meta.dir, 'SKILL.md');
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Compact catalog injected into the system prompt (progressive disclosure). */
export function webSkillsCatalogText(): string {
  const metas = listWebSkillMetas();
  if (metas.length === 0) return '';
  const lines = metas
    .map((m) => `- ${m.name}: ${m.description || '(no description)'}`)
    .join('\n');
  return (
    `Available WalkCroach creative skills (call load_skill with one of these names before the matching task):\n${lines}\n` +
    `Only load a skill when the user's request clearly matches its purpose.`
  );
}
