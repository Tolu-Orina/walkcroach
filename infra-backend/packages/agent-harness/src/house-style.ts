/**
 * House style — the "predefined standards" a CMS workflow enforces.
 *
 * Three sources, layered, highest precedence first:
 *
 *   1. **memory**  — conventions confirmed for this project. Learned, durable,
 *                    and the only layer a human has explicitly agreed to.
 *   2. **repo**    — inferred from the target codebase. Ground truth for what
 *                    the code actually does, which beats any default we ship.
 *   3. **skill**   — WalkCroach design skills. Sensible defaults so the very
 *                    first post is good rather than a guess.
 *
 * Every rule carries its `source`, which is what makes the propose→confirm step
 * meaningful: a human reviewing "headings are sentence case" needs to know
 * whether that came from their own `tailwind.config.ts` or from a default we
 * invented. Without provenance the confirmation is theatre.
 *
 * Nothing here writes to memory. `proposeHouseStyle` returns a proposal;
 * `confirmedRulesToMemory` turns an approved proposal into memory writes. The
 * split is deliberate — inference must never silently become policy.
 */
import {
  extractAgentsRules,
  renderAgentsInstructions,
  resolveAgentsChain,
} from './agents-md.js';
import type { RepoFile } from './github-pr.js';

export type RuleSource = 'memory' | 'repo' | 'skill';

export type StyleRule = {
  key: string;
  value: string;
  source: RuleSource;
  /** Human-readable justification, shown in the proposal. */
  because: string;
};

export type HouseStyle = {
  rules: StyleRule[];
  /** Convenience lookup; last writer per key after precedence is applied. */
  get(key: string): string | undefined;
};

/**
 * Defaults from the WalkCroach design skills.
 *
 * These are intentionally opinions, not neutral placeholders — a neutral
 * default produces neutral output, and the whole point of shipping design
 * skills is that the first post looks considered.
 */
export const SKILL_DEFAULTS: ReadonlyArray<Omit<StyleRule, 'source'>> = [
  {
    key: 'heading.case',
    value: 'sentence',
    because: 'walkcroach-visual-hierarchy-typography prefers sentence case for scanability',
  },
  {
    key: 'imagery.style',
    value: 'muted, editorial, non-salesy; natural light; no stock-photo gloss',
    because: 'walkcroach-photography-imagery-language',
  },
  {
    key: 'layout.measure',
    value: '65-75ch for body copy',
    because: 'walkcroach-spacing-layout-system',
  },
  {
    key: 'component.card',
    value: 'use the design system card; do not hand-roll surfaces',
    because: 'walkcroach-card-design-system',
  },
  {
    key: 'a11y.contrast',
    value: 'WCAG AA minimum on all text over imagery',
    because: 'walkcroach-accessibility-contrast-standards',
  },
  {
    key: 'motion.policy',
    value: 'entrance only, under 300ms, respect prefers-reduced-motion',
    because: 'walkcroach-framer-motion-micro-interactions',
  },
];

/**
 * Infer conventions from the target repo.
 *
 * Heuristics, deliberately shallow. The goal is to catch the handful of choices
 * that make generated code look foreign — import alias, class-name helper,
 * where content lives — not to build a static analyser. Anything ambiguous is
 * left unset so the skill default applies rather than a bad guess winning.
 */
export function inferRepoRules(files: RepoFile[]): StyleRule[] {
  const rules: StyleRule[] = [];
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const all = files.map((f) => f.content).join('\n');
  const add = (key: string, value: string, because: string) =>
    rules.push({ key, value, source: 'repo', because });

  // Import alias — a generated `../../components/Card` in a repo that uses
  // `@/components/Card` reads as foreign on the first line.
  const tsconfig = byPath.get('tsconfig.json') ?? byPath.get('tsconfig.base.json') ?? '';
  const alias = /"(@\/?\*?|~\/?\*?)"\s*:/.exec(tsconfig);
  if (alias?.[1]) {
    add('import.alias', alias[1].replace(/\*$/, ''), 'path alias declared in tsconfig.json');
  }

  // Class-name helper.
  if (/\bfrom ['"].*\/utils['"][\s\S]{0,200}\bcn\b/.test(all) || /\bcn\(/.test(all)) {
    add('classnames.helper', 'cn', '`cn(...)` is used across existing components');
  } else if (/\bclsx\(/.test(all)) {
    add('classnames.helper', 'clsx', '`clsx(...)` is used across existing components');
  } else if (/\bclassNames\(/.test(all)) {
    add('classnames.helper', 'classNames', '`classNames(...)` is used in existing components');
  }

  // Styling system.
  if (files.some((f) => /^tailwind\.config\./.test(f.path))) {
    add('styling.system', 'tailwind', 'tailwind.config present');
  } else if (/\.module\.css['"]/.test(all)) {
    add('styling.system', 'css-modules', 'CSS modules imported in existing components');
  } else if (/styled\.[a-z]+`/.test(all)) {
    add('styling.system', 'styled-components', 'styled-components usage found');
  }

  // shadcn/ui — worth detecting explicitly because it implies a whole component
  // vocabulary the generated page should reuse rather than reinvent.
  if (byPath.has('components.json') && /shadcn/i.test(byPath.get('components.json') ?? '')) {
    add('ui.kit', 'shadcn', 'components.json declares a shadcn/ui install');
  }

  // Framework and routing shape decide where a post file goes.
  const pkg = byPath.get('package.json') ?? '';
  if (/"next"\s*:/.test(pkg)) {
    const appRouter = files.some((f) => /^(src\/)?app\//.test(f.path));
    add('framework', 'next', 'next is a dependency in package.json');
    add(
      'routing',
      appRouter ? 'next-app-router' : 'next-pages-router',
      appRouter ? 'app/ directory present' : 'pages/ directory present',
    );
  } else if (/"astro"\s*:/.test(pkg)) {
    add('framework', 'astro', 'astro is a dependency in package.json');
  } else if (/"react-router(-dom)?"\s*:/.test(pkg)) {
    add('framework', 'react-spa', 'react-router is a dependency in package.json');
  }

  // Content location — inferred from where content already lives, because a post
  // written to the wrong directory is invisible no matter how good it is.
  const contentDir = files
    .map((f) => f.path)
    .find((p) => /(^|\/)(content|posts|blog)\//.test(p));
  if (contentDir) {
    const dir = contentDir.slice(0, contentDir.lastIndexOf('/'));
    add('content.dir', dir, `existing content found under ${dir}`);
  }

  // MDX changes what the generated file even is.
  if (/"@mdx-js|"@next\/mdx|\.mdx['"]/.test(all) || files.some((f) => f.path.endsWith('.mdx'))) {
    add('content.format', 'mdx', 'MDX tooling or .mdx files present');
  }

  return rules;
}

/**
 * Merge the three layers into one effective style.
 *
 * Later sources never override earlier ones — memory wins over repo, repo wins
 * over skill defaults. The full list is retained (not just the winners) so a
 * proposal can show what was overridden and by what.
 */
export function mergeHouseStyle(params: {
  memoryRules?: StyleRule[];
  repoRules?: StyleRule[];
  skillRules?: StyleRule[];
}): HouseStyle {
  const ordered = [
    ...(params.memoryRules ?? []),
    ...(params.repoRules ?? []),
    ...(params.skillRules ?? []),
  ];
  const winners = new Map<string, StyleRule>();
  for (const rule of ordered) {
    if (!winners.has(rule.key)) winners.set(rule.key, rule);
  }
  const rules = [...winners.values()];
  return { rules, get: (key) => winners.get(key)?.value };
}

/** Skill defaults as rules. */
export function skillRules(): StyleRule[] {
  return SKILL_DEFAULTS.map((r) => ({ ...r, source: 'skill' as const }));
}

/**
 * Parse rules previously confirmed into memory.
 *
 * Stored as `house-style: <key> = <value>` so they are human-readable in the
 * memory UI and greppable in an export, rather than an opaque JSON blob a user
 * cannot audit.
 */
export const MEMORY_RULE_PREFIX = 'house-style:';

export function parseMemoryRules(
  entries: Array<{ text: string }>,
): StyleRule[] {
  const rules: StyleRule[] = [];
  for (const entry of entries) {
    const m = new RegExp(`^${MEMORY_RULE_PREFIX}\\s*([^=]+?)\\s*=\\s*(.+)$`, 's').exec(
      entry.text.trim(),
    );
    if (!m) continue;
    rules.push({
      key: m[1]!.trim(),
      value: m[2]!.trim(),
      source: 'memory',
      because: 'confirmed for this project',
    });
  }
  return rules;
}

export function ruleToMemoryText(rule: StyleRule): string {
  return `${MEMORY_RULE_PREFIX} ${rule.key} = ${rule.value}`;
}

/**
 * Discover the effective style for a run.
 *
 * There is deliberately no human confirmation step. This is an IDE agent
 * looking around before it writes: it reads the repo and matches what is
 * already there, the same way it would if a developer had opened the folder.
 * Asking someone to approve "your tsconfig declares the `@/` alias, shall I use
 * it?" is not a safety gate, it is a dialog nobody reads.
 *
 * The review that matters happens at the end, on the pull request, where a
 * human sees the actual diff rather than a list of inferred adjectives.
 */
export function discoverHouseStyle(params: {
  memoryRules?: StyleRule[];
  repoFiles?: RepoFile[];
  /** Path being written, used to resolve the nested AGENTS.md chain. */
  targetPath?: string;
}): HouseStyle & { agentsInstructions: string } {
  const repoFiles = params.repoFiles ?? [];
  const chain = resolveAgentsChain(repoFiles, params.targetPath ?? '');

  const merged = mergeHouseStyle({
    memoryRules: params.memoryRules,
    // AGENTS.md before inference: a repository that states a rule outranks our
    // heuristic guess at the same rule. Both are `source: 'repo'`, and
    // mergeHouseStyle keeps the first occurrence per key.
    repoRules: [...extractAgentsRules(chain), ...inferRepoRules(repoFiles)],
    skillRules: skillRules(),
  });

  return {
    ...merged,
    /** Verbatim prose for the prompt — most of an AGENTS.md's value is unparsed. */
    agentsInstructions: renderAgentsInstructions(chain),
  };
}

/** Render the effective style for a code-generation prompt. */
export function renderHouseStyle(style: HouseStyle): string {
  if (style.rules.length === 0) return '';
  const lines = style.rules
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((r) => `- ${r.key}: ${r.value}  (${r.source})`);
  return [
    'House style for this project. These are binding — match them exactly.',
    'Where a rule came from memory, it was explicitly confirmed by this team; do not override it.',
    ...lines,
  ].join('\n');
}
