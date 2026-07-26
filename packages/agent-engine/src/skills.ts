/**
 * Agent Skills progressive loader (FR-D20–D21, NFR-D13).
 * Metadata always cheap; full body on load_skill match.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUNDLED_SKILLS,
  type BundledSkill,
} from './skills/bundled.js';
import type { SharedSkillsBridge } from './shared-skills.js';

export type SkillMeta = {
  name: string;
  description: string;
  source: 'bundled' | 'workspace' | 'shared';
  path?: string;
  origin?: string;
};

export type SkillFull = SkillMeta & {
  body: string;
  references?: Record<string, string>;
};

const OFFICIAL_JSON_NAME = 'cockroachdb-official.generated.json';

/**
 * Load official CockroachDB skills from JSON (not inlined in the IDE JS bundle).
 * Resolve order: explicit path → env → next to this module → cwd fallbacks.
 */
export function loadOfficialCockroachSkills(
  explicitPath?: string,
): BundledSkill[] {
  let moduleDir: string | undefined;
  try {
    // Works in ESM (CLI / vitest). Under the IDE's esbuild CJS bundle,
    // import.meta.url is empty — callers must pass officialSkillsJsonPath.
    const metaUrl = import.meta.url;
    if (metaUrl) moduleDir = dirname(fileURLToPath(metaUrl));
  } catch {
    moduleDir = undefined;
  }

  const candidates = [
    explicitPath,
    process.env.WALKCROACH_COCKROACH_SKILLS_JSON,
    moduleDir ? join(moduleDir, 'skills', OFFICIAL_JSON_NAME) : undefined,
    moduleDir ? join(moduleDir, OFFICIAL_JSON_NAME) : undefined,
    join(process.cwd(), 'dist', OFFICIAL_JSON_NAME),
    join(process.cwd(), 'dist', 'skills', OFFICIAL_JSON_NAME),
    join(process.cwd(), OFFICIAL_JSON_NAME),
  ].filter((p): p is string => Boolean(p && p.trim()));

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (!Array.isArray(raw)) continue;
      return raw.filter(
        (s): s is BundledSkill =>
          Boolean(
            s &&
              typeof s === 'object' &&
              typeof (s as BundledSkill).name === 'string' &&
              typeof (s as BundledSkill).description === 'string' &&
              typeof (s as BundledSkill).body === 'string',
          ),
      );
    } catch {
      /* try next */
    }
  }
  return [];
}

export function parseSkillMd(raw: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const trimmed = raw.replace(/^\uFEFF/, '');
  if (!trimmed.startsWith('---')) {
    return { body: trimmed };
  }
  const end = trimmed.indexOf('\n---', 3);
  if (end < 0) return { body: trimmed };
  const front = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '');
  const name = matchFront(front, 'name');
  const description = matchFront(front, 'description');
  return { name, description, body };
}

function matchFront(front: string, key: string): string | undefined {
  const lines = front.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = line.match(new RegExp(`^${key}:\\s*(.*)$`, 'i'));
    if (!m) continue;
    let v = (m[1] ?? '').trim();
    if (v === '|' || v === '>' || v === '|-' || v === '>-') {
      const block: string[] = [];
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

export class SkillsRegistry {
  private metas: SkillMeta[] = [];
  private bodies = new Map<string, string>();
  private references = new Map<string, Record<string, string>>();

  /**
   * Load bundled + optional CockroachDB-synced shared skills + optional
   * workspace skill roots. Precedence on name collision: workspace overrides
   * shared, shared overrides bundled — so a local file always wins.
   */
  async init(
    workspaceRoots: string[] = [],
    opts?: {
      sharedSkills?: SharedSkillsBridge;
      /** Absolute path to cockroachdb-official.generated.json (IDE sets this). */
      officialSkillsJsonPath?: string;
    },
  ): Promise<void> {
    this.metas = [];
    this.bodies.clear();
    this.references.clear();

    const bundled: BundledSkill[] = [
      ...loadOfficialCockroachSkills(opts?.officialSkillsJsonPath),
      ...BUNDLED_SKILLS,
    ];

    for (const s of bundled) {
      this.upsert({
        name: s.name,
        description: s.description,
        source: 'bundled',
        origin: s.origin,
        body: s.body,
        references: s.references,
      });
    }

    if (opts?.sharedSkills) {
      try {
        const shared = await opts.sharedSkills.list();
        for (const s of shared) {
          this.upsert({
            name: s.name,
            description: s.description,
            source: 'shared',
            origin: s.sourceSurface ? `walkcroach:shared:${s.sourceSurface}` : 'walkcroach:shared',
            body: s.body,
            overwrite: true,
          });
        }
      } catch {
        // Sync failure just means fewer skills this run, not a hard error —
        // matches scanDir's own silent-catch resilience below.
      }
    }

    for (const root of workspaceRoots) {
      await this.scanDir(root, { overwrite: true });
    }
  }

  listMeta(): SkillMeta[] {
    return [...this.metas];
  }

  /** Cheap catalog for system prompt (~100 tokens each). */
  catalogText(): string {
    if (!this.metas.length) return '(no skills loaded)';
    return this.metas
      .map((m) => `- ${m.name}: ${m.description}`)
      .join('\n');
  }

  load(name: string): SkillFull | null {
    const meta = this.metas.find((m) => m.name === name);
    const body = this.bodies.get(name);
    if (!meta || body === undefined) return null;
    const refs = this.references.get(name);
    return {
      ...meta,
      body,
      ...(refs && Object.keys(refs).length ? { references: refs } : {}),
    };
  }

  /** Format full skill for the model (body + optional references). */
  formatForModel(full: SkillFull): string {
    const parts = [`# Skill: ${full.name}\n\n${full.body.trim()}`];
    if (full.references && Object.keys(full.references).length) {
      parts.push('\n# References\n');
      for (const [file, text] of Object.entries(full.references).sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        parts.push(`## ${file}\n\n${text.trim()}\n`);
      }
    }
    return parts.join('\n');
  }

  /** Match by name substring or description keywords. */
  match(query: string): SkillMeta[] {
    const q = query.toLowerCase();
    return this.metas.filter(
      (m) =>
        m.name.includes(q) ||
        m.description.toLowerCase().includes(q) ||
        q
          .split(/\s+/)
          .some(
            (w) => w.length > 3 && m.description.toLowerCase().includes(w),
          ),
    );
  }

  private upsert(params: {
    name: string;
    description: string;
    source: 'bundled' | 'workspace' | 'shared';
    body: string;
    path?: string;
    origin?: string;
    references?: Record<string, string>;
    overwrite?: boolean;
  }): void {
    const name = params.name;
    if (this.bodies.has(name) && !params.overwrite) return;
    const existing = this.metas.findIndex((m) => m.name === name);
    const meta: SkillMeta = {
      name,
      description: params.description,
      source: params.source,
      path: params.path,
      origin: params.origin,
    };
    if (existing >= 0) this.metas[existing] = meta;
    else this.metas.push(meta);
    this.bodies.set(name, params.body);
    if (params.references && Object.keys(params.references).length) {
      this.references.set(name, params.references);
    } else {
      this.references.delete(name);
    }
  }

  private async scanDir(
    dir: string,
    opts: { overwrite?: boolean } = {},
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'references' || e.name === 'scripts') continue;
        const skillMd = join(full, 'SKILL.md');
        try {
          await this.loadFile(skillMd, e.name, opts);
        } catch {
          await this.scanDir(full, opts);
        }
      } else if (e.name === 'SKILL.md') {
        await this.loadFile(full, basename(dir), opts);
      }
    }
  }

  private async loadFile(
    path: string,
    fallbackName: string,
    opts: { overwrite?: boolean } = {},
  ): Promise<void> {
    const st = await stat(path);
    if (!st.isFile()) return;
    const raw = await readFile(path, 'utf8');
    const parsed = parseSkillMd(raw);
    const name = (parsed.name ?? fallbackName)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!name) return;
    const description =
      parsed.description ?? `Workspace skill from ${path}`;

    const references: Record<string, string> = {};
    const refDir = join(dirname(path), 'references');
    try {
      const refs = await readdir(refDir, { withFileTypes: true });
      for (const r of refs) {
        if (!r.isFile() || !/\.md$/i.test(r.name)) continue;
        references[r.name] = await readFile(join(refDir, r.name), 'utf8');
      }
    } catch {
      /* no references */
    }

    this.upsert({
      name,
      description,
      source: 'workspace',
      body: parsed.body,
      path,
      references,
      overwrite: opts.overwrite,
    });
  }
}

/** Default workspace skill search roots under a repo. */
export function defaultSkillRoots(workspaceRoot?: string): string[] {
  if (!workspaceRoot) return [];
  return [
    join(workspaceRoot, '.walkcroach', 'skills'),
    join(workspaceRoot, '.agents', 'skills'),
    join(workspaceRoot, 'skills'),
    join(workspaceRoot, '.claude', 'skills'),
  ];
}
