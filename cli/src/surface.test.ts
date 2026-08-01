/**
 * The CLI's public surface, pinned (C0.1).
 *
 * Once someone writes `walkcroach run --json` into a script, the command names,
 * the flag spellings and the JSON envelope shapes are a contract — clig.dev's
 * rule is that changes stay additive and non-additive ones get warned about
 * first. This suite is what makes that enforceable instead of aspirational:
 * adding a command or a flag needs a line here, and renaming or removing one
 * fails loudly, in the same commit that did it.
 *
 * The expectation is written out in full rather than snapshotted, so a diff
 * shows what the surface *is*, not just that it moved.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { buildProgram } from './program.js';
import { CLI_VERSION } from './lib/version.js';
import { DEFAULT_API_BASE_URL } from './lib/config.js';
import { EXIT } from './lib/exit-codes.js';

type SurfaceNode = {
  name: string;
  options: string[];
  args: string[];
  commands: SurfaceNode[];
};

/** Exactly what `walkcroach --help` prints, including the trailing sections. */
function renderHelp(): string {
  let out = '';
  const program = buildProgram();
  program.configureOutput({ writeOut: (str) => { out += str; } });
  program.outputHelp();
  return out;
}

function describeCommand(cmd: Command): SurfaceNode {
  return {
    name: cmd.name(),
    options: cmd.options.map((o) => o.flags).sort(),
    args: cmd.registeredArguments.map((a) => a.name()),
    commands: cmd.commands
      .map((c) => describeCommand(c as Command))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

describe('command surface', () => {
  it('matches the documented tree, flag for flag', () => {
    expect(describeCommand(buildProgram())).toEqual({
      name: 'walkcroach',
      args: [],
      options: [
        '-V, --version',
        '--api-url <url>',
        '--json',
        '--no-color',
        '--no-input',
        '--plain',
        '--tui',
      ].sort(),
      commands: [
        {
          name: 'auth',
          args: [],
          options: [],
          commands: [
            {
              name: 'login',
              args: [],
              options: ['--no-browser', '--token <token>'],
              commands: [],
            },
            { name: 'logout', args: [], options: [], commands: [] },
            { name: 'status', args: [], options: [], commands: [] },
          ],
        },
        {
          name: 'completion',
          args: ['shell'],
          options: [],
          commands: [],
        },
        {
          name: 'config',
          args: ['key', 'value'],
          options: [],
          commands: [],
        },
        {
          name: 'create',
          args: ['name'],
          options: [
            '--cwd <path>',
            '--force',
            '--no-git',
            '--no-register',
            '--open <editor>',
            '--template <id>',
          ].sort(),
          commands: [],
        },
        {
          name: 'doctor',
          args: [],
          options: ['--cwd <path>'],
          commands: [],
        },
        {
          name: 'link',
          args: ['projectId'],
          options: ['--cwd <path>'],
          commands: [],
        },
        {
          name: 'mcp',
          args: [],
          options: [],
          commands: [
            {
              name: 'list',
              args: [],
              options: ['--cwd <path>'],
              commands: [],
            },
            {
              name: 'revoke',
              args: ['server'],
              options: ['--all'],
              commands: [],
            },
          ],
        },
        {
          name: 'memory',
          args: [],
          options: [],
          commands: [
            {
              name: 'list',
              args: [],
              options: ['--cwd <path>', '--limit <n>', '--query <text>'],
              commands: [],
            },
          ],
        },
        {
          name: 'ping',
          args: [],
          options: ['--cwd <path>'],
          commands: [],
        },
        {
          name: 'projects',
          args: [],
          options: [],
          commands: [],
        },
        {
          name: 'revert',
          args: [],
          options: ['--cwd <path>', '--dry-run', '--turn <id>', '--yes'],
          commands: [],
        },
        {
          name: 'run',
          args: ['prompt'],
          options: [
            '--autonomy <level>',
            '--cwd <path>',
            '--non-interactive',
            '--plan',
            '--yes',
          ].sort(),
          commands: [],
        },
        {
          name: 'secrets',
          args: [],
          options: [],
          commands: [
            { name: 'list', args: [], options: [], commands: [] },
            { name: 'rm', args: ['key'], options: [], commands: [] },
            { name: 'set', args: ['key'], options: ['--stdin'], commands: [] },
          ],
        },
        {
          name: 'skills',
          args: [],
          options: [],
          commands: [
            {
              name: 'list',
              args: [],
              options: ['--cwd <path>', '--shared'],
              commands: [],
            },
          ],
        },
        {
          name: 'status',
          args: [],
          options: ['--cwd <path>'],
          commands: [],
        },
        {
          name: 'unlink',
          args: [],
          options: ['--cwd <path>'],
          commands: [],
        },
      ],
    });
  });

  it('keeps every long flag paired with a description', () => {
    // clig.dev: help text is the interface for anyone who has not read the
    // README, which is nearly everyone.
    const walk = (cmd: Command): void => {
      for (const opt of cmd.options) {
        expect(opt.description, `${cmd.name()} ${opt.flags}`).toBeTruthy();
      }
      expect(cmd.description(), cmd.name()).toBeTruthy();
      cmd.commands.forEach((c) => walk(c as Command));
    };
    walk(buildProgram());
  });

  it('leads its help with examples', () => {
    // "Users tend to use examples over other forms of documentation, so show
    // them first" — clig.dev.
    const help = renderHelp();
    expect(help).toContain('Examples:');
    expect(help).toContain('$ walkcroach run');
    expect(help).toContain('Exit codes:');
  });
});

describe('version', () => {
  it('reports package.json, with no second copy to drift', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
    expect(buildProgram().version()).toBe(pkg.version);
  });

  it('never reports the unknown-version placeholder from a real install', () => {
    expect(CLI_VERSION).not.toBe('0.0.0-unknown');
  });
});

describe('shipped defaults', () => {
  it('does not point a published CLI at localhost', () => {
    // The defect this replaced: `apiBaseUrl` defaulted to localhost:3003, so
    // the first command on a fresh machine failed against nothing at all.
    expect(DEFAULT_API_BASE_URL).toMatch(/^https:\/\//);
    expect(DEFAULT_API_BASE_URL).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});

describe('exit-code contract', () => {
  it('pins the documented codes', () => {
    expect(EXIT).toEqual({
      OK: 0,
      USAGE: 1,
      AUTH_REQUIRED: 2,
      RUN_FAILED: 3,
      NETWORK: 4,
      INTERRUPTED: 130,
    });
  });

  it('documents them where a user will look', () => {
    const help = renderHelp();
    for (const line of [
      '0 ok',
      '1 usage',
      '2 auth required',
      '3 run failed',
      '4 network',
      '130 interrupted',
    ]) {
      expect(help).toContain(line);
    }
  });
});
