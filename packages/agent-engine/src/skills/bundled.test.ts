import { describe, expect, it } from 'vitest';
import { SkillsRegistry } from '../skills.js';
import { BUNDLED_SKILLS, WALKCROACH_CODING_SKILLS } from './bundled.js';

const BATCH_1_2_NAMES = [
  'scaffolding-vite-react-ts-tailwind',
  'avoiding-vite-type-only-export-errors',
  'avoiding-vite-env-var-runtime-pitfalls',
  'systematic-debugging-discipline',
  'connecting-scaffolded-app-to-cockroachdb',
  'security-checklist-for-new-code',
];

const BATCH_3_NAMES = [
  'test-driven-development',
  'condition-based-waiting',
  'testing-anti-patterns',
  'webapp-testing-with-playwright',
  'root-cause-tracing',
  'verification-before-completion',
  'defense-in-depth-validation',
  'using-git-worktrees',
  'finishing-a-development-branch',
  'requesting-code-review',
  'receiving-code-review-feedback',
  'writing-clear-commit-messages',
  'writing-implementation-plans',
  'executing-plans-with-checkpoints',
  'brainstorming-before-building',
  'dispatching-parallel-subagents',
  'building-mcp-servers',
  'frontend-design-quality-bar',
  'defensive-api-error-handling',
  'safe-dependency-upgrades',
];

describe('WALKCROACH_CODING_SKILLS', () => {
  it('defines exactly the 26 general-purpose coding skills, with non-empty content', () => {
    expect(WALKCROACH_CODING_SKILLS.map((s) => s.name)).toEqual([
      ...BATCH_1_2_NAMES,
      ...BATCH_3_NAMES,
    ]);
    for (const skill of WALKCROACH_CODING_SKILLS) {
      expect(skill.description.trim().length).toBeGreaterThan(0);
      expect(skill.body.trim().length).toBeGreaterThan(0);
      expect(skill.origin).toBe('walkcroach:builtin');
    }
  });

  it('has no duplicate skill names', () => {
    const names = WALKCROACH_CODING_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('batch 3 skills each reference why/when to use them (non-trivial descriptions)', () => {
    for (const name of BATCH_3_NAMES) {
      const skill = WALKCROACH_CODING_SKILLS.find((s) => s.name === name);
      expect(skill, `missing skill: ${name}`).toBeDefined();
      // Every description should include explicit "use when/for/after/..."
      // guidance on top of what the skill does — the discovery-ready
      // convention this codebase's skills follow.
      expect(skill!.description.toLowerCase()).toMatch(/\buse [a-z]+/);
    }
  });

  it('is included in BUNDLED_SKILLS, appended after the existing groups', () => {
    const names = BUNDLED_SKILLS.map((s) => s.name);
    for (const skill of WALKCROACH_CODING_SKILLS) {
      expect(names).toContain(skill.name);
    }
    // Ordering contract: coding skills come after companion skills in BUNDLED_SKILLS
    // (official Cockroach skills load separately from JSON in SkillsRegistry.init).
    const codingStart = names.indexOf('scaffolding-vite-react-ts-tailwind');
    const lastNonCodingIndex =
      BUNDLED_SKILLS.length - WALKCROACH_CODING_SKILLS.length - 1;
    expect(codingStart).toBe(lastNonCodingIndex + 1);
  });

  it('round-trips through SkillsRegistry.init/listMeta/load like any other bundled skill', async () => {
    const registry = new SkillsRegistry();
    await registry.init([]);

    const metas = registry.listMeta();
    for (const skill of WALKCROACH_CODING_SKILLS) {
      const meta = metas.find((m) => m.name === skill.name);
      expect(meta).toBeDefined();
      expect(meta?.source).toBe('bundled');

      const full = registry.load(skill.name);
      expect(full).not.toBeNull();
      expect(full?.body).toBe(skill.body);

      const formatted = registry.formatForModel(full!);
      expect(formatted).toContain(`# Skill: ${skill.name}`);
    }
  });

  it('surfaces all 26 skills in the cheap catalog text', async () => {
    const registry = new SkillsRegistry();
    await registry.init([]);
    const catalog = registry.catalogText();
    for (const skill of WALKCROACH_CODING_SKILLS) {
      expect(catalog).toContain(skill.name);
    }
  });

  it('encodes the specific prevention this was seeded for: verbatimModuleSyntax', () => {
    const pitfallSkill = WALKCROACH_CODING_SKILLS.find(
      (s) => s.name === 'avoiding-vite-type-only-export-errors',
    );
    expect(pitfallSkill?.body).toContain('verbatimModuleSyntax');

    const scaffoldSkill = WALKCROACH_CODING_SKILLS.find(
      (s) => s.name === 'scaffolding-vite-react-ts-tailwind',
    );
    expect(scaffoldSkill?.body).toContain('@tailwindcss/vite');
    expect(scaffoldSkill?.body).toContain('verbatimModuleSyntax');
  });
});
