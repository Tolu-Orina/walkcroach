import { describe, expect, it } from 'vitest';
import {
  listWebSkillMetas,
  loadWebSkill,
  webSkillsCatalogText,
} from './web-skills.js';

describe('web skills loader (Phase A)', () => {
  it('discovers walkcroach-* skills under skills/web', () => {
    const metas = listWebSkillMetas();
    expect(metas.length).toBeGreaterThan(0);
    expect(metas.some((m) => m.name === 'walkcroach-image-gen')).toBe(true);
  });

  it('loads a skill body by name', () => {
    const body = loadWebSkill('walkcroach-image-gen');
    expect(body).toBeTruthy();
    expect(body).toContain('Nova Canvas');
  });

  it('returns null for an unknown skill', () => {
    expect(loadWebSkill('walkcroach-does-not-exist')).toBeNull();
  });

  it('produces a catalog text naming creative skills', () => {
    const catalog = webSkillsCatalogText();
    expect(catalog).toContain('walkcroach-image-gen');
    expect(catalog).toContain('load_skill');
  });
});
