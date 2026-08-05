import { describe, expect, it } from 'vitest';
import {
  extractAgentsRules,
  isAgentsFile,
  renderAgentsInstructions,
  resolveAgentsChain,
  MAX_AGENTS_LINES,
} from './agents-md.js';
import { discoverHouseStyle } from './house-style.js';

const f = (path: string, content: string) => ({ path, content });

describe('isAgentsFile', () => {
  it.each([
    ['AGENTS.md', true],
    ['packages/web/AGENTS.md', true],
    ['CLAUDE.md', true],
    ['README.md', false],
    ['docs/AGENTS.md.bak', false],
  ])('%s -> %s', (path, expected) => {
    expect(isAgentsFile(path)).toBe(expected);
  });
});

describe('resolveAgentsChain', () => {
  const files = [
    f('AGENTS.md', 'root rules'),
    f('packages/api/AGENTS.md', 'api rules'),
    f('packages/web/AGENTS.md', 'web rules'),
    f('src/components/Card.tsx', 'unrelated'),
  ];

  it('returns root first and the closest file last', () => {
    // Callers concatenate, so the closest file must be able to override the root.
    const chain = resolveAgentsChain(files, 'packages/web/app/page.tsx');
    expect(chain.map((c) => c.path)).toEqual(['AGENTS.md', 'packages/web/AGENTS.md']);
  });

  it('excludes sibling packages', () => {
    // The commonest monorepo failure: applying packages/api rules to web.
    const chain = resolveAgentsChain(files, 'packages/web/app/page.tsx');
    expect(chain.map((c) => c.path)).not.toContain('packages/api/AGENTS.md');
  });

  it('applies the root file to a file at the repo root', () => {
    expect(resolveAgentsChain(files, 'index.ts').map((c) => c.path)).toEqual(['AGENTS.md']);
  });

  it('returns an empty chain when the repo has none', () => {
    expect(resolveAgentsChain([f('README.md', '#')], 'src/x.ts')).toEqual([]);
  });

  it('prefers AGENTS.md over CLAUDE.md in the same directory', () => {
    // A team that added the standard file is signalling which one they maintain.
    const both = [f('CLAUDE.md', 'old'), f('AGENTS.md', 'new')];
    expect(resolveAgentsChain(both, 'x.ts').at(-1)!.path).toBe('AGENTS.md');
  });
});

describe('renderAgentsInstructions', () => {
  it('presents the files verbatim and explains precedence', () => {
    const md = renderAgentsInstructions([
      f('AGENTS.md', 'Use pnpm.'),
      f('packages/web/AGENTS.md', 'Use Tailwind.'),
    ]);
    expect(md).toMatch(/Use pnpm\./);
    expect(md).toMatch(/Use Tailwind\./);
    expect(md).toMatch(/the \*last\* one wins/);
    expect(md.indexOf('Use pnpm')).toBeLessThan(md.indexOf('Use Tailwind'));
  });

  it('omits the precedence note for a single file', () => {
    expect(renderAgentsInstructions([f('AGENTS.md', 'x')])).not.toMatch(/last\* one wins/);
  });

  it('truncates loudly past the recommended length', () => {
    // Past ~150 lines these files show diminishing returns and raise cost.
    const long = f('AGENTS.md', Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n'));
    const md = renderAgentsInstructions([long]);
    expect(md).toMatch(new RegExp(`truncated at ${MAX_AGENTS_LINES} lines`));
    expect(md).not.toMatch(/line 300/);
  });

  it('is empty for an empty chain', () => {
    expect(renderAgentsInstructions([])).toBe('');
  });
});

describe('extractAgentsRules', () => {
  it('lifts the package manager, the commonest first-run failure', () => {
    const rules = extractAgentsRules([f('AGENTS.md', 'Install deps with `pnpm install`.')]);
    expect(rules.find((r) => r.key === 'package.manager')?.value).toBe('pnpm');
  });

  it('lifts test and build commands', () => {
    const rules = extractAgentsRules([
      f('AGENTS.md', '- Test: `pnpm test --run`\n- Build: `pnpm build`'),
    ]);
    expect(rules.find((r) => r.key === 'command.test')?.value).toBe('pnpm test --run');
    expect(rules.find((r) => r.key === 'command.build')?.value).toBe('pnpm build');
  });

  it('lifts explicit do-not-touch paths', () => {
    const rules = extractAgentsRules([
      f('AGENTS.md', 'Do not modify `src/generated/` or `schema.sql`.'),
    ]);
    expect(rules.find((r) => r.key === 'repo.doNotTouch')?.value).toMatch(/src\/generated/);
  });

  it('lets the closest file override the root', () => {
    const rules = extractAgentsRules([
      f('AGENTS.md', 'Use `npm install`.'),
      f('packages/web/AGENTS.md', 'Use `pnpm install` here.'),
    ]);
    expect(rules.find((r) => r.key === 'package.manager')?.value).toBe('pnpm');
  });

  it('attributes every rule to the file that stated it', () => {
    const rules = extractAgentsRules([f('packages/web/AGENTS.md', 'Use `bun install`.')]);
    expect(rules[0]).toMatchObject({ source: 'repo', because: 'stated in packages/web/AGENTS.md' });
  });

  it('extracts nothing from prose that states no conventions', () => {
    expect(extractAgentsRules([f('AGENTS.md', 'This project is a website.')])).toEqual([]);
  });
});

describe('discoverHouseStyle with AGENTS.md', () => {
  it('lets a stated rule outrank an inferred guess', () => {
    // The repo says pnpm; package.json alone would have told us nothing about
    // which manager the team actually uses.
    const style = discoverHouseStyle({
      repoFiles: [
        f('AGENTS.md', 'Always use `pnpm install`.'),
        f('package.json', '{"dependencies":{"next":"15.0.0"}}'),
      ],
      targetPath: 'src/app/page.tsx',
    });
    expect(style.get('package.manager')).toBe('pnpm');
    expect(style.get('framework')).toBe('next'); // inference still fills the gaps
  });

  it('still lets confirmed memory win over a stated repo rule', () => {
    const style = discoverHouseStyle({
      memoryRules: [
        { key: 'package.manager', value: 'npm', source: 'memory', because: 'decided' },
      ],
      repoFiles: [f('AGENTS.md', 'Use `pnpm install`.')],
      targetPath: 'x.ts',
    });
    expect(style.get('package.manager')).toBe('npm');
  });

  it('exposes the prose separately for the prompt', () => {
    const style = discoverHouseStyle({
      repoFiles: [f('AGENTS.md', 'Prefer server components. Keep pages under 200 lines.')],
      targetPath: 'src/app/page.tsx',
    });
    expect(style.agentsInstructions).toMatch(/server components/);
  });

  it('returns empty instructions when the repo has no AGENTS.md', () => {
    const style = discoverHouseStyle({ repoFiles: [f('package.json', '{}')] });
    expect(style.agentsInstructions).toBe('');
  });
});
