/**
 * Shell completions (C5.3).
 *
 * Generated from the live Commander tree, so the property worth asserting is
 * that they *stay* generated: a completion script listing a command that no
 * longer exists is worse than none, because Tab silently teaches the wrong
 * thing.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SHELLS, describeTree, generateCompletion, isShell } from './completion.js';
import { buildProgram } from '../program.js';

const program = buildProgram();

describe('isShell', () => {
  it('accepts the three supported shells and nothing else', () => {
    for (const shell of SHELLS) expect(isShell(shell)).toBe(true);
    expect(isShell('powershell')).toBe(false);
    expect(isShell('')).toBe(false);
  });
});

describe('describeTree', () => {
  it('mirrors the real command tree', () => {
    const tree = describeTree(program);
    const names = tree.subcommands.map((c) => c.name);
    for (const expected of ['run', 'auth', 'create', 'revert', 'secrets', 'doctor']) {
      expect(names).toContain(expected);
    }
    // Commander's built-in `help` is not a command anyone completes.
    expect(names).not.toContain('help');
  });

  it('carries nested subcommands', () => {
    const auth = describeTree(program).subcommands.find((c) => c.name === 'auth');
    expect(auth?.subcommands.map((s) => s.name)).toEqual(['login', 'logout', 'status']);
  });

  it('offers long flags only', () => {
    // `-V` is not worth completing, and short flags add noise to every Tab.
    const tree = describeTree(program);
    for (const flag of tree.options) expect(flag.startsWith('--'), flag).toBe(true);
    expect(tree.options).toContain('--json');
    expect(tree.options).toContain('--help');
  });
});

describe.each(SHELLS)('%s script', (shell) => {
  const script = generateCompletion(shell, program);

  it('names every top-level command', () => {
    for (const cmd of describeTree(program).subcommands) {
      expect(script, `${shell} completion omits ${cmd.name}`).toContain(cmd.name);
    }
  });

  it('tells the user where to install it', () => {
    expect(script).toMatch(/Install:|complete -c walkcroach/);
  });

  it('is not empty and mentions the binary', () => {
    expect(script.length).toBeGreaterThan(200);
    expect(script).toContain('walkcroach');
  });
});

describe('bash script', () => {
  it('parses as bash', () => {
    // The only assertion that catches a quoting mistake in the generator.
    const dir = mkdtempSync(join(tmpdir(), 'wc-completion-'));
    try {
      const file = join(dir, 'walkcroach.bash');
      writeFileSync(file, generateCompletion('bash', program), 'utf8');
      expect(() =>
        execFileSync('bash', ['-n', file], { stdio: 'pipe' }),
      ).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('quoting', () => {
  it('escapes a description containing an apostrophe', () => {
    // zsh and fish both single-quote descriptions; an unescaped apostrophe
    // would end the string and produce a script that fails to load.
    for (const shell of ['zsh', 'fish'] as const) {
      const script = generateCompletion(shell, program);
      // No bare apostrophe immediately followed by another quote-delimiter.
      expect(script).not.toMatch(/[^\\]''[^)]/);
    }
  });

  it('does not let a colon in a description break zsh completion syntax', () => {
    // zsh uses `name:description`; a colon inside the description would be
    // read as a second field.
    const script = generateCompletion('zsh', program);
    for (const line of script.split('\n')) {
      const match = /^\s+'([^:]+):(.*)'$/.exec(line);
      if (match) expect(match[2]).not.toContain(':');
    }
  });
});
