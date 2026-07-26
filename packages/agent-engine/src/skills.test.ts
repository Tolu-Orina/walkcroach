import { describe, expect, it } from 'vitest';
import { SkillsRegistry } from './skills.js';
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
});
