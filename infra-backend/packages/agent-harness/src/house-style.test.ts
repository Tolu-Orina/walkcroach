import { describe, expect, it } from 'vitest';
import {
  discoverHouseStyle,
  inferRepoRules,
  mergeHouseStyle,
  parseMemoryRules,
  renderHouseStyle,
  ruleToMemoryText,
  skillRules,
  type StyleRule,
} from './house-style.js';

const file = (path: string, content: string) => ({ path, content });

describe('inferRepoRules', () => {
  it('picks up the tsconfig path alias', () => {
    const rules = inferRepoRules([
      file('tsconfig.json', '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}'),
    ]);
    expect(rules.find((r) => r.key === 'import.alias')?.value).toBe('@/');
  });

  it.each([
    ['cn', 'export const x = cn("a", "b")', 'cn'],
    ['clsx', 'import clsx from "clsx"; clsx("a")', 'clsx'],
    ['classNames', 'classNames("a", "b")', 'classNames'],
  ])('detects the %s class-name helper', (_label, src, expected) => {
    const rules = inferRepoRules([file('src/components/Card.tsx', src)]);
    expect(rules.find((r) => r.key === 'classnames.helper')?.value).toBe(expected);
  });

  it('detects tailwind from its config file', () => {
    const rules = inferRepoRules([file('tailwind.config.ts', 'export default {}')]);
    expect(rules.find((r) => r.key === 'styling.system')?.value).toBe('tailwind');
  });

  it('detects shadcn so generated code reuses the kit', () => {
    const rules = inferRepoRules([
      file('components.json', '{"$schema":"https://ui.shadcn.com/schema.json"}'),
    ]);
    expect(rules.find((r) => r.key === 'ui.kit')?.value).toBe('shadcn');
  });

  it('distinguishes the Next app router from the pages router', () => {
    const app = inferRepoRules([
      file('package.json', '{"dependencies":{"next":"15.0.0"}}'),
      file('src/app/page.tsx', ''),
    ]);
    expect(app.find((r) => r.key === 'routing')?.value).toBe('next-app-router');

    const pages = inferRepoRules([
      file('package.json', '{"dependencies":{"next":"15.0.0"}}'),
      file('pages/index.tsx', ''),
    ]);
    expect(pages.find((r) => r.key === 'routing')?.value).toBe('next-pages-router');
  });

  it('locates where content already lives', () => {
    // A post written to the wrong directory is invisible no matter how good it is.
    const rules = inferRepoRules([file('src/content/blog/first.mdx', '# hi')]);
    expect(rules.find((r) => r.key === 'content.dir')?.value).toBe('src/content/blog');
  });

  it('detects MDX, which changes what file gets generated', () => {
    const rules = inferRepoRules([file('src/content/a.mdx', '# hi')]);
    expect(rules.find((r) => r.key === 'content.format')?.value).toBe('mdx');
  });

  it('stays silent when nothing is detectable rather than guessing', () => {
    // An unset rule falls through to a considered skill default. A wrong guess
    // outranks that default and makes the output worse.
    const rules = inferRepoRules([file('README.md', '# project')]);
    expect(rules.find((r) => r.key === 'classnames.helper')).toBeUndefined();
    expect(rules.find((r) => r.key === 'framework')).toBeUndefined();
  });
});

describe('precedence', () => {
  const mem: StyleRule[] = [
    { key: 'heading.case', value: 'title', source: 'memory', because: 'confirmed' },
  ];
  const repo: StyleRule[] = [
    { key: 'heading.case', value: 'upper', source: 'repo', because: 'inferred' },
    { key: 'import.alias', value: '@/', source: 'repo', because: 'tsconfig' },
  ];

  it('memory beats repo beats skill', () => {
    const style = mergeHouseStyle({
      memoryRules: mem,
      repoRules: repo,
      skillRules: skillRules(),
    });
    // Confirmed by a human — must not be overridden by inference or a default.
    expect(style.get('heading.case')).toBe('title');
    expect(style.get('import.alias')).toBe('@/');
    // Untouched by the other layers, so the skill default stands.
    expect(style.get('imagery.style')).toMatch(/muted/);
  });

  it('repo beats skill when memory is empty', () => {
    const style = mergeHouseStyle({ repoRules: repo, skillRules: skillRules() });
    expect(style.get('heading.case')).toBe('upper');
  });

  it('falls back entirely to skill defaults on a first run', () => {
    // Empty memory and an unreadable repo must still produce a considered style.
    const style = mergeHouseStyle({ skillRules: skillRules() });
    expect(style.rules.length).toBe(skillRules().length);
    expect(style.get('a11y.contrast')).toMatch(/AA/);
  });
});

describe('memory round-trip', () => {
  it('serialises to a human-readable, greppable line', () => {
    const text = ruleToMemoryText({
      key: 'heading.case',
      value: 'sentence',
      source: 'repo',
      because: 'x',
    });
    expect(text).toBe('house-style: heading.case = sentence');
  });

  it('parses its own format back', () => {
    const rules = parseMemoryRules([{ text: 'house-style: heading.case = sentence' }]);
    expect(rules[0]).toMatchObject({
      key: 'heading.case',
      value: 'sentence',
      source: 'memory',
    });
  });

  it('ignores ordinary memory entries', () => {
    const rules = parseMemoryRules([
      { text: 'User prefers muted tones' },
      { text: 'house-style: imagery.style = muted, editorial' },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.key).toBe('imagery.style');
  });

  it('handles values containing = signs', () => {
    const rules = parseMemoryRules([{ text: 'house-style: layout.measure = width=65ch' }]);
    expect(rules[0]!.value).toBe('width=65ch');
  });
});

describe('discoverHouseStyle', () => {
  it('reads the repo and applies it without asking anyone', () => {
    const style = discoverHouseStyle({
      repoFiles: [
        file('tsconfig.json', '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}'),
        file('tailwind.config.ts', 'export default {}'),
      ],
    });
    expect(style.get('import.alias')).toBe('@/');
    expect(style.get('styling.system')).toBe('tailwind');
    // Skill defaults still cover what the repo does not state.
    expect(style.get('imagery.style')).toMatch(/muted/);
  });

  it('lets confirmed memory override what the repo says', () => {
    const style = discoverHouseStyle({
      memoryRules: [
        { key: 'styling.system', value: 'css-modules', source: 'memory', because: 'decided' },
      ],
      repoFiles: [file('tailwind.config.ts', 'export default {}')],
    });
    expect(style.get('styling.system')).toBe('css-modules');
  });

  it('works with no repo access at all', () => {
    const style = discoverHouseStyle({});
    expect(style.rules.length).toBe(skillRules().length);
  });

  it('keeps provenance so a diff reviewer can trace any rule', () => {
    const style = discoverHouseStyle({
      repoFiles: [file('components.json', '{"$schema":"https://ui.shadcn.com/schema.json"}')],
    });
    const kit = style.rules.find((r) => r.key === 'ui.kit');
    expect(kit).toMatchObject({ source: 'repo', because: expect.stringMatching(/components\.json/) });
  });
});

describe('renderHouseStyle', () => {
  it('renders deterministically and marks memory rules as binding', () => {
    const style = mergeHouseStyle({
      memoryRules: [
        { key: 'heading.case', value: 'title', source: 'memory', because: 'confirmed' },
      ],
      skillRules: skillRules(),
    });
    const a = renderHouseStyle(style);
    const b = renderHouseStyle(style);
    expect(a).toBe(b); // stable ordering keeps the prompt prefix cacheable
    expect(a).toMatch(/heading\.case: title\s+\(memory\)/);
    expect(a).toMatch(/do not override/i);
  });

  it('returns empty string for an empty style', () => {
    expect(renderHouseStyle(mergeHouseStyle({}))).toBe('');
  });
});
