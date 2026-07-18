/**
 * Agent Skills progressive loader (FR-D20–D21, NFR-D13).
 * Metadata always cheap; full body on load_skill match.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { BUNDLED_SKILLS } from './skills/bundled.js';

export type SkillMeta = {
  name: string;
  description: string;
  source: 'bundled' | 'workspace';
  path?: string;
};

export type SkillFull = SkillMeta & {
  body: string;
};

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
  // Supports multiline YAML `|` / `>` lightly by taking rest of line only
  const re = new RegExp(`^${key}:\\s*[>"|]?\\s*(.*)$`, 'mi');
  const m = front.match(re);
  if (!m?.[1]) return undefined;
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v || undefined;
}

export class SkillsRegistry {
  private metas: SkillMeta[] = [];
  private bodies = new Map<string, string>();

  /** Load bundled + optional workspace skill roots. */
  async init(workspaceRoots: string[] = []): Promise<void> {
    this.metas = [];
    this.bodies.clear();

    for (const s of BUNDLED_SKILLS) {
      this.metas.push({
        name: s.name,
        description: s.description,
        source: 'bundled',
      });
      this.bodies.set(s.name, s.body);
    }

    for (const root of workspaceRoots) {
      await this.scanDir(root);
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
    return { ...meta, body };
  }

  /** Match by name substring or description keywords. */
  match(query: string): SkillMeta[] {
    const q = query.toLowerCase();
    return this.metas.filter(
      (m) =>
        m.name.includes(q) ||
        m.description.toLowerCase().includes(q) ||
        q.split(/\s+/).some((w) => w.length > 3 && m.description.toLowerCase().includes(w)),
    );
  }

  private async scanDir(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        const skillMd = join(full, 'SKILL.md');
        try {
          await this.loadFile(skillMd, e.name);
        } catch {
          await this.scanDir(full);
        }
      } else if (e.name === 'SKILL.md') {
        await this.loadFile(full, basename(dir));
      }
    }
  }

  private async loadFile(path: string, fallbackName: string): Promise<void> {
    const st = await stat(path);
    if (!st.isFile()) return;
    const raw = await readFile(path, 'utf8');
    const parsed = parseSkillMd(raw);
    const name = (parsed.name ?? fallbackName)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!name || this.bodies.has(name)) return;
    const description =
      parsed.description ?? `Workspace skill from ${path}`;
    this.metas.push({
      name,
      description,
      source: 'workspace',
      path,
    });
    this.bodies.set(name, parsed.body);
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
