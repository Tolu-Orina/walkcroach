import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SkillsRegistry,
  defaultSkillRoots,
  resolveSkillRoots,
  userGlobalSkillRoots,
} from './skills.js';
import type { SharedSkillsBridge } from './shared-skills.js';

function fakeBridge(
  records: Array<{ name: string; description: string; body: string; sourceSurface?: string }>,
): SharedSkillsBridge {
  return {
    async list() {
      return records;
    },
    async mirror() {
      return { id: 'unused' };
    },
  };
}

describe('SkillsRegistry — shared skills sync', () => {
  it('upserts shared skills with source "shared" when a bridge is provided', async () => {
    const registry = new SkillsRegistry();
    const bridge = fakeBridge([
      { name: 'my-shared-skill', description: 'desc', body: 'body text', sourceSurface: 'ide' },
    ]);
    await registry.init([], { sharedSkills: bridge });

    const meta = registry.listMeta().find((m) => m.name === 'my-shared-skill');
    expect(meta).toBeDefined();
    expect(meta?.source).toBe('shared');
    expect(meta?.origin).toBe('walkcroach:shared:ide');

    const full = registry.load('my-shared-skill');
    expect(full?.body).toBe('body text');
  });

  it('does not crash init when the bridge fails, and loads bundled skills anyway', async () => {
    const registry = new SkillsRegistry();
    const failingBridge: SharedSkillsBridge = {
      async list() {
        throw new Error('network down');
      },
      async mirror() {
        return { id: 'unused' };
      },
    };
    await expect(
      registry.init([], { sharedSkills: failingBridge }),
    ).resolves.toBeUndefined();
    expect(registry.listMeta().length).toBeGreaterThan(0);
  });

  it('loads normally when no bridge is provided', async () => {
    const registry = new SkillsRegistry();
    await registry.init([]);
    expect(registry.listMeta().some((m) => m.source === 'shared')).toBe(false);
  });

  it('catalogText tags each skill with its source', async () => {
    const registry = new SkillsRegistry();
    const bridge = fakeBridge([
      { name: 'my-shared-skill', description: 'desc', body: 'body' },
    ]);
    await registry.init([], { sharedSkills: bridge });
    const catalog = registry.catalogText();
    expect(catalog).toMatch(/my-shared-skill \[shared\]:/);
    expect(catalog).toMatch(/\[bundled\]:/);
  });
});

describe('resolveSkillRoots', () => {
  it('includes workspace defaults and user-global roots', () => {
    const home = '/tmp/fake-home';
    const ws = '/tmp/repo';
    const plan = resolveSkillRoots(ws, { homeDir: home });
    for (const r of defaultSkillRoots(ws)) {
      expect(plan.roots).toContain(r);
    }
    for (const r of userGlobalSkillRoots(home)) {
      expect(plan.roots).toContain(r);
      expect(plan.userGlobalRoots).toContain(r);
    }
    expect(plan.userGlobalRoots).not.toContain(
      join(ws, '.walkcroach', 'skills'),
    );
  });

  it('honors includeUserGlobal=false and relative extraRoots', () => {
    const plan = resolveSkillRoots('/tmp/repo', {
      includeUserGlobal: false,
      extraRoots: ['custom-skills', ''],
      homeDir: '/tmp/fake-home',
    });
    expect(plan.userGlobalRoots).toEqual([]);
    expect(plan.roots).toContain(join('/tmp/repo', 'custom-skills'));
    expect(plan.roots.every((r) => !r.includes('.cursor'))).toBe(true);
  });

  it('tags disk skills from user-global roots as source=user', async () => {
    const base = await mkdtemp(join(tmpdir(), 'wc-skills-'));
    const home = join(base, 'home');
    const userSkillDir = join(home, '.cursor', 'skills', 'my-user-skill');
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(
      join(userSkillDir, 'SKILL.md'),
      `---\nname: my-user-skill\ndescription: From cursor home\n---\n\nDo the thing.\n`,
      'utf8',
    );

    const plan = resolveSkillRoots(undefined, {
      homeDir: home,
      includeUserGlobal: true,
    });
    const registry = new SkillsRegistry();
    await registry.init(plan.roots, { userGlobalRoots: plan.userGlobalRoots });
    const meta = registry.listMeta().find((m) => m.name === 'my-user-skill');
    expect(meta?.source).toBe('user');
    expect(registry.catalogText()).toMatch(/my-user-skill \[user\]:/);
  });
});
