/**
 * `AGENTS.md` — the industry's universal agent instruction file.
 *
 * A Linux Foundation-stewarded open standard used by 60,000+ repositories and
 * read natively by Claude Code, Codex CLI, Cursor, Aider, Devin, GitHub Copilot,
 * Gemini CLI, Windsurf and Amazon Q. If a target repository has one, it *states*
 * the conventions we would otherwise infer from `tsconfig.json` heuristics.
 *
 * Reading it is not politeness — it is the difference between guessing a team's
 * rules and being told them. It therefore outranks repo inference in
 * `discoverHouseStyle`, and sits below memory, which was confirmed for this
 * project specifically.
 *
 * **Nesting is the part implementations get wrong.** The spec composes files
 * down the tree: a root `AGENTS.md`, then `packages/api/AGENTS.md`, then
 * `packages/web/AGENTS.md`. An agent editing `packages/web/x.tsx` walks *up* from
 * that file and combines every file it passes, with the **closest winning** on
 * conflict. Reading only the root file silently applies the wrong rules in a
 * monorepo, which is exactly where per-package rules matter most.
 */
import type { RepoFile } from './github-pr.js';
import type { StyleRule } from './house-style.js';

export const AGENTS_FILENAMES = ['AGENTS.md', 'CLAUDE.md'] as const;

/**
 * `CLAUDE.md` is accepted as a fallback because it predates the standard and is
 * still widespread. `AGENTS.md` wins when a repo has both — a team that added
 * the standard file is signalling which one they maintain.
 */
export function isAgentsFile(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return (AGENTS_FILENAMES as readonly string[]).includes(name);
}

/** Directory containing a file, '' for repo root. */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/**
 * Order the `AGENTS.md` files that apply to `targetPath`, furthest first.
 *
 * Furthest-first because callers concatenate, and the closest file must be able
 * to override what the root said.
 */
export function resolveAgentsChain(
  files: RepoFile[],
  targetPath: string,
): RepoFile[] {
  const targetDir = dirOf(targetPath);
  const applicable = files.filter((f) => {
    if (!isAgentsFile(f.path)) return false;
    const dir = dirOf(f.path);
    // Root applies to everything; otherwise the file's directory must be an
    // ancestor of (or equal to) the target's.
    return dir === '' || targetDir === dir || targetDir.startsWith(`${dir}/`);
  });

  const depth = (p: string) => (dirOf(p) === '' ? 0 : dirOf(p).split('/').length);
  return applicable.sort((a, b) => {
    const d = depth(a.path) - depth(b.path);
    if (d !== 0) return d;
    // Same directory with both files present: AGENTS.md is the maintained one.
    return a.path.endsWith('AGENTS.md') ? 1 : -1;
  });
}

/**
 * Guidance from the ecosystem: past roughly 150 lines these files show
 * diminishing returns and can raise inference cost 20–23% without improving
 * results. Truncating loudly beats silently paying for prose nobody benefits
 * from.
 */
export const MAX_AGENTS_LINES = 150;

export function renderAgentsInstructions(chain: RepoFile[]): string {
  if (chain.length === 0) return '';
  const sections: string[] = [];

  for (const file of chain) {
    const lines = file.content.split('\n');
    const truncated = lines.length > MAX_AGENTS_LINES;
    const body = lines.slice(0, MAX_AGENTS_LINES).join('\n').trim();
    if (!body) continue;
    sections.push(
      [
        `### From ${file.path}`,
        body,
        truncated
          ? `\n_(truncated at ${MAX_AGENTS_LINES} lines)_`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  if (sections.length === 0) return '';
  return [
    "## Repository instructions (AGENTS.md)",
    'These are this repository\'s own instructions to coding agents. Follow them.',
    chain.length > 1
      ? 'Files are listed from the repository root inwards; where they conflict, the *last* one wins.'
      : '',
    '',
    ...sections,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Extract machine-checkable rules from an `AGENTS.md` chain.
 *
 * Deliberately conservative. The file is prose written for a model, and most of
 * its value is delivered by putting it in the prompt verbatim — not by parsing
 * it. Only a few conventions are worth lifting into `StyleRule`s, where they can
 * override an inferred guess. Anything not recognised is left to the prose.
 */
export function extractAgentsRules(chain: RepoFile[]): StyleRule[] {
  const rules: StyleRule[] = [];
  const seen = new Set<string>();

  // Closest file last, so later matches overwrite earlier ones.
  for (const file of chain) {
    const text = file.content;
    const add = (key: string, value: string) => {
      seen.add(key);
      const existing = rules.findIndex((r) => r.key === key);
      const rule: StyleRule = {
        key,
        value,
        source: 'repo',
        because: `stated in ${file.path}`,
      };
      if (existing >= 0) rules[existing] = rule;
      else rules.push(rule);
    };

    // Package manager — the single most common cause of a generated command
    // that fails on the first run.
    const pm = /\b(pnpm|yarn|bun|npm)\s+(install|i|add)\b/i.exec(text);
    if (pm?.[1]) add('package.manager', pm[1].toLowerCase());

    // Test and build commands, when stated as a command line.
    const test = /^\s*(?:[-*]\s*)?(?:test|tests?):?\s*[`"']?((?:npm|pnpm|yarn|bun|make)\s[^\n`"']+)/im.exec(
      text,
    );
    if (test?.[1]) add('command.test', test[1].trim());

    const build = /^\s*(?:[-*]\s*)?build:?\s*[`"']?((?:npm|pnpm|yarn|bun|make)\s[^\n`"']+)/im.exec(
      text,
    );
    if (build?.[1]) add('command.build', build[1].trim());

    // Explicit no-go areas. Recorded as a rule so it can be surfaced next to the
    // write scope rather than relying on the model to notice it in prose.
    const dontTouch = /(?:do not (?:touch|modify|edit)|never (?:touch|modify|edit))[^\n]*?[`"']([^`"'\n]+)[`"']/gi;
    const paths: string[] = [];
    for (const m of text.matchAll(dontTouch)) if (m[1]) paths.push(m[1].trim());
    if (paths.length > 0) add('repo.doNotTouch', paths.join(', '));
  }

  return rules.filter((r) => seen.has(r.key));
}
