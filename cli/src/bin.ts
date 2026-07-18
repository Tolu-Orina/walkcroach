#!/usr/bin/env node
import { Command } from 'commander';
import { runAgentCommand } from './commands/run.js';
import {
  authLogin,
  authLogout,
  authStatus,
  configSet,
  configShow,
} from './commands/auth.js';
import {
  linkProject,
  linkStatus,
  listProjects,
  unlinkProject,
} from './commands/link.js';
import { resolveOutputMode } from './lib/output.js';
import { ideHealth } from './lib/api.js';
import { OutputSink } from './lib/output.js';
import { walkcroachHome } from './lib/config.js';

const program = new Command();

program
  .name('walkcroach')
  .description(
    'WalkCroach CLI — same agent engine as the IDE (Phase D). Interactive TUI by default on a TTY.',
  )
  .version('0.1.0')
  .option('--json', 'JSON / NDJSON output on every command (FR-D24)', false)
  .option('--plain', 'Disable Ink TUI; use plain text streaming', false)
  .option('--tui', 'Force Ink TUI even if heuristics say otherwise', false);

function globalOpts() {
  return program.opts<{
    json?: boolean;
    plain?: boolean;
    tui?: boolean;
  }>();
}

program
  .command('run')
  .description('Run the agent on a task in the current (or --cwd) workspace')
  .argument('<prompt...>', 'Task prompt')
  .option('--cwd <path>', 'Workspace root', process.cwd())
  .option(
    '--yes',
    'Non-interactive: auto-approve safe local tools only (FR-D25). Never ccloud/MCP write/infra.',
    false,
  )
  .option('--non-interactive', 'Alias for --yes (CI / scripts)', false)
  .option('--plan', 'Plan mode (read-only tools)', false)
  .option('--autonomy <level>', 'strict | low_friction', 'strict')
  .action(async (promptParts: string[], opts) => {
    const g = globalOpts();
    const nonInteractive = Boolean(opts.yes || opts.nonInteractive);
    const mode = resolveOutputMode({
      json: g.json,
      noTui: g.plain || nonInteractive,
      forceTui: g.tui && !g.json && !nonInteractive,
    });
    const code = await runAgentCommand({
      prompt: promptParts.join(' '),
      cwd: opts.cwd,
      mode,
      nonInteractive,
      plan: Boolean(opts.plan),
      autonomy: opts.autonomy === 'low_friction' ? 'low_friction' : 'strict',
    });
    process.exitCode = code;
  });

program
  .command('ping')
  .description('Smoke-test Bedrock connectivity via the agent ping path')
  .option('--cwd <path>', 'Workspace root', process.cwd())
  .action(async (opts) => {
    const g = globalOpts();
    const mode = resolveOutputMode({
      json: g.json,
      noTui: true,
      forceTui: false,
    });
    const code = await runAgentCommand({
      prompt: 'ping',
      cwd: opts.cwd,
      mode: mode === 'tui' ? 'text' : mode,
      nonInteractive: true,
    });
    process.exitCode = code;
  });

const auth = program
  .command('auth')
  .description('Cognito session (shared secret store under ~/.walkcroach)');

auth
  .command('login')
  .description('Store Cognito access token (paste or --token)')
  .option('--token <token>', 'Access token')
  .action(async (opts) => {
    process.exitCode = await authLogin({
      json: globalOpts().json,
      token: opts.token,
    });
  });

auth.command('logout').description('Clear stored tokens').action(async () => {
  process.exitCode = await authLogout({ json: globalOpts().json });
});

auth.command('status').description('Show auth + BFF health').action(async () => {
  process.exitCode = await authStatus({ json: globalOpts().json });
});

program
  .command('link')
  .description('Link cwd to a WalkCroach Web project')
  .argument('<projectId>', 'Project UUID')
  .option('--cwd <path>', 'Workspace root', process.cwd())
  .action(async (projectId: string, opts) => {
    process.exitCode = await linkProject({
      projectId,
      cwd: opts.cwd,
      json: globalOpts().json,
    });
  });

program
  .command('unlink')
  .description('Unlink cwd from its WalkCroach project')
  .option('--cwd <path>', 'Workspace root', process.cwd())
  .action(async (opts) => {
    process.exitCode = await unlinkProject({
      cwd: opts.cwd,
      json: globalOpts().json,
    });
  });

program
  .command('projects')
  .description('List linkable WalkCroach Web projects')
  .action(async () => {
    process.exitCode = await listProjects({ json: globalOpts().json });
  });

program
  .command('status')
  .description('Show link status for cwd')
  .option('--cwd <path>', 'Workspace root', process.cwd())
  .action(async (opts) => {
    process.exitCode = await linkStatus({
      cwd: opts.cwd,
      json: globalOpts().json,
    });
  });

program
  .command('config')
  .description('Show or set CLI config (~/.walkcroach/config.json)')
  .argument('[key]', 'Config key to set')
  .argument('[value]', 'Value')
  .action(async (key?: string, value?: string) => {
    if (key && value !== undefined) {
      process.exitCode = await configSet(key, value, {
        json: globalOpts().json,
      });
    } else {
      process.exitCode = await configShow({ json: globalOpts().json });
    }
  });

program
  .command('doctor')
  .description('Environment smoke checks (home, optional BFF)')
  .action(async () => {
    const sink = new OutputSink(globalOpts().json ? 'json' : 'text');
    let health: unknown = null;
    try {
      health = await ideHealth();
    } catch (err) {
      health = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    sink.command('doctor', {
      node: process.version,
      platform: process.platform,
      home: walkcroachHome(),
      tty: Boolean(process.stdout.isTTY && process.stdin.isTTY),
      ideBff: health,
    });
  });

await program.parseAsync(process.argv);
