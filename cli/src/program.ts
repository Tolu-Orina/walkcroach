/**
 * The command surface, built as a value so it can be inspected.
 *
 * This used to live in `bin.ts`, which called `parseAsync` at module scope —
 * importing it ran the CLI, so nothing could assert what the surface *is*.
 * `surface.test.ts` now walks the tree this returns and holds every command,
 * flag and default to a written contract (C0.1).
 */
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
import { createCommand, type EditorId } from './commands/create.js';
import { revertCommand } from './commands/revert.js';
import { memoryList } from './commands/memory.js';
import { skillsList } from './commands/skills.js';
import { secretsList, secretsRemove, secretsSet } from './commands/secrets.js';
import {
  authState,
  ccloudProbe,
  inferenceProbe,
  mcpProbe,
  ptyBackend,
} from './lib/diagnostics.js';
import { credentialBackend } from './lib/credential-store.js';
import { resolveOutputMode, OutputSink } from './lib/output.js';
import { ideHealth } from './lib/api.js';
import {
  findProjectConfig,
  resolveApiBaseUrl,
  walkcroachHome,
} from './lib/config.js';
import { EXIT, exitCodeForError } from './lib/exit-codes.js';
import { colorEnabled, inputAllowed, setRuntimeFlags } from './lib/runtime.js';
import { CLI_VERSION } from './lib/version.js';
import { SHELLS, generateCompletion, isShell } from './lib/completion.js';

export type GlobalOptions = {
  json?: boolean;
  plain?: boolean;
  tui?: boolean;
  /** Commander's negated flags: `--no-color` → `color: false`. */
  color?: boolean;
  input?: boolean;
  apiUrl?: string;
};

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('walkcroach')
    .description(
      'WalkCroach CLI — same agent engine as the IDE. Interactive TUI by default on a TTY.',
    )
    .version(CLI_VERSION)
    .option('--json', 'JSON / NDJSON output on every command (FR-D24)', false)
    .option('--plain', 'Disable Ink TUI; use plain text streaming', false)
    .option('--tui', 'Force Ink TUI even if heuristics say otherwise', false)
    .option('--no-color', 'Disable ANSI colour (also honours NO_COLOR)')
    .option('--no-input', 'Never prompt, even on a TTY')
    .option('--api-url <url>', 'Override the WalkCroach API base URL for this run')
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach run "Add a health route"
  $ walkcroach run --yes --plain "Fix the failing test"   # CI
  $ walkcroach --json doctor
  $ walkcroach auth login
  $ walkcroach link 3f9c…  # connect this folder to a Web project

Exit codes:
  0 ok · 1 usage · 2 auth required · 3 run failed · 4 network · 130 interrupted

Configuration precedence:
  --api-url > WALKCROACH_API_BASE_URL > .walkcroach/config.json > ~/.walkcroach/config.json
`,
    );

  // Global options must land before any command body reads them.
  program.hook('preAction', () => {
    const g = program.opts<GlobalOptions>();
    setRuntimeFlags({
      apiBaseUrl: g.apiUrl,
      noColor: g.color === false,
      noInput: g.input === false,
    });
  });

  function globalOpts(): GlobalOptions {
    return program.opts<GlobalOptions>();
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
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach run "Add a /health route and a test for it"
  $ walkcroach run --plan "How would you add rate limiting?"
  $ walkcroach run --yes --plain "Fix the failing test"   # CI, no prompts
`,
    )
    .action(async (promptParts: string[], opts) => {
      const g = globalOpts();
      const nonInteractive = Boolean(
        opts.yes || opts.nonInteractive || g.input === false,
      );
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
    .description('Sign in through your browser (or pass --token for CI)')
    .option('--token <token>', 'Use an existing access token instead of a browser')
    .option('--no-browser', 'Print the sign-in URL instead of opening a browser')
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach auth login                 # opens your browser
  $ walkcroach auth login --no-browser    # prints the URL (SSH / headless)
  $ walkcroach auth login --token "$WALKCROACH_ACCESS_TOKEN"   # CI
`,
    )
    .action(async (opts) => {
      process.exitCode = await authLogin({
        json: globalOpts().json,
        token: opts.token,
        browser: opts.browser,
      });
    });

  auth
    .command('logout')
    .description('Clear stored tokens')
    .action(async () => {
      process.exitCode = await authLogout({ json: globalOpts().json });
    });

  auth
    .command('status')
    .description('Show auth + BFF health')
    .action(async () => {
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
    .command('create')
    .description('Scaffold a project from a WalkCroach template and open it')
    .argument('<name>', 'Project name — becomes a directory here')
    .option('--cwd <path>', 'Where to create it', process.cwd())
    .option('--template <id>', 'Template id (see --help for the list)')
    .option('--open <editor>', 'vscode | cursor | none', 'none')
    .option('--no-git', 'Skip git init and the initial commit')
    .option('--no-register', 'Do not register the project with WalkCroach')
    .option('--force', 'Scaffold into a directory that is not empty', false)
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach create "Invoice Tracker"                  # pick a template
  $ walkcroach create my-app --template todo --open cursor
  $ walkcroach create my-app --no-git --no-register      # fully offline
`,
    )
    .action(async (name: string, opts) => {
      process.exitCode = await createCommand({
        name,
        cwd: opts.cwd,
        template: opts.template,
        open: opts.open as EditorId,
        git: opts.git,
        register: opts.register,
        force: Boolean(opts.force),
        json: globalOpts().json,
      });
    });

  program
    .command('revert')
    .description('Restore files changed by a previous agent turn')
    .option('--cwd <path>', 'Workspace root', process.cwd())
    .option('--turn <id>', 'Turn to revert (defaults to the most recent)')
    .option('--dry-run', 'Show what would be restored and change nothing', false)
    .option('--yes', 'Skip the confirmation (requires --turn)', false)
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach revert --dry-run           # show what would change
  $ walkcroach revert                     # confirm, then restore
  $ walkcroach revert --turn t_42 --yes   # unattended, explicit turn
`,
    )
    .action(async (opts) => {
      process.exitCode = await revertCommand({
        cwd: opts.cwd,
        turn: opts.turn,
        dryRun: Boolean(opts.dryRun),
        yes: Boolean(opts.yes),
        json: globalOpts().json,
      });
    });

  const memory = program
    .command('memory')
    .description('Project memory — local WALKCROACH.md and the shared store');

  memory
    .command('list')
    .description('Show local memory, and recall from the linked project')
    .option('--cwd <path>', 'Workspace root', process.cwd())
    .option('--query <text>', 'Recall query for the shared store')
    .option('--limit <n>', 'Maximum recall hits', '10')
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach memory list
  $ walkcroach memory list --query "why did we choose Cognito?"
`,
    )
    .action(async (opts) => {
      process.exitCode = await memoryList({
        cwd: opts.cwd,
        query: opts.query,
        limit: Number(opts.limit) || 10,
        json: globalOpts().json,
      });
    });

  const skills = program
    .command('skills')
    .description('Agent Skills available to a run');

  skills
    .command('list')
    .description('List effective skills (workspace > shared > bundled)')
    .option('--cwd <path>', 'Workspace root', process.cwd())
    .option('--shared', 'List account-scoped shared skills only', false)
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach skills list            # effective: workspace > shared > bundled
  $ walkcroach skills list --shared   # account-scoped only
`,
    )
    .action(async (opts) => {
      process.exitCode = await skillsList({
        cwd: opts.cwd,
        shared: Boolean(opts.shared),
        json: globalOpts().json,
      });
    });

  const secrets = program
    .command('secrets')
    .description('MCP / ccloud / Bedrock credentials (~/.walkcroach/secrets.json)');

  secrets
    .command('set')
    .description('Store a secret, read from a prompt or --stdin (never a flag)')
    .argument('<key>', 'Secret key, e.g. mcp.apiKey')
    .option('--stdin', 'Read the value from stdin', false)
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach secrets set bedrock.apiKey            # prompts, not echoed
  $ echo "$KEY" | walkcroach secrets set mcp.apiKey --stdin

A secret is never taken from a flag: flags land in shell history and in CI logs.
`,
    )
    .action(async (key: string, opts) => {
      process.exitCode = await secretsSet(key, {
        stdin: Boolean(opts.stdin),
        json: globalOpts().json,
      });
    });

  secrets
    .command('list')
    .description('Show which secrets are configured — never their values')
    .action(async () => {
      process.exitCode = await secretsList({ json: globalOpts().json });
    });

  secrets
    .command('rm')
    .description('Remove a stored secret')
    .argument('<key>', 'Secret key')
    .action(async (key: string) => {
      process.exitCode = await secretsRemove(key, { json: globalOpts().json });
    });

  program
    .command('config')
    .description('Show or set CLI config (~/.walkcroach/config.json)')
    .argument('[key]', 'Config key to set')
    .argument('[value]', 'Value')
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach config
  $ walkcroach config bedrockRegion us-east-1
  $ walkcroach config apiBaseUrl http://localhost:3003   # local development
`,
    )
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
    .command('completion')
    .description(`Print a shell completion script (${SHELLS.join(' | ')})`)
    .argument('<shell>', `Shell to generate for: ${SHELLS.join(', ')}`)
    .addHelpText(
      'after',
      `
Examples:
  $ walkcroach completion bash > /etc/bash_completion.d/walkcroach
  $ walkcroach completion zsh > "\${fpath[1]}/_walkcroach"
  $ walkcroach completion fish > ~/.config/fish/completions/walkcroach.fish
`,
    )
    .action((shell: string) => {
      const sink = new OutputSink(globalOpts().json ? 'json' : 'text');
      if (!isShell(shell)) {
        sink.result(false, {
          error: `Unsupported shell "${shell}". Supported: ${SHELLS.join(', ')}`,
          code: 'usage',
          hint: `Try: walkcroach completion ${SHELLS[0]}`,
        });
        process.exitCode = EXIT.USAGE;
        return;
      }
      // Straight to stdout, unwrapped: this is a file the user redirects.
      // Wrapping it in a JSON envelope would make `> file` produce something
      // no shell can source.
      process.stdout.write(generateCompletion(shell, program));
      process.exitCode = EXIT.OK;
    });

  program
    .command('doctor')
    .description('Environment smoke checks (home, config source, API health)')
    .option('--cwd <path>', 'Workspace root', process.cwd())
    .action(async (opts) => {
      const sink = new OutputSink(globalOpts().json ? 'json' : 'text');
      const api = await resolveApiBaseUrl({ cwd: opts.cwd });
      // A rejected project override is a real finding, not a footnote: it is
      // why the API URL is not what the repo says it should be.
      if (api.note) process.stderr.write(`${api.note}\n`);

      let health: unknown = null;
      let exitCode: number = EXIT.OK;
      try {
        health = await ideHealth();
      } catch (err) {
        health = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
        exitCode = exitCodeForError(err);
      }

      const project = findProjectConfig(opts.cwd);
      // Probes run together: doctor is a report, and three sequential
      // subprocess timeouts would make it feel broken itself.
      const [auth, ccloud, mcp, pty, inference] = await Promise.all([
        authState(),
        ccloudProbe(),
        mcpProbe(),
        ptyBackend(),
        inferenceProbe(),
      ]);
      sink.command('doctor', {
        version: CLI_VERSION,
        node: process.version,
        platform: process.platform,
        home: walkcroachHome(),
        apiBaseUrl: api.value,
        apiBaseUrlSource: api.source,
        projectConfig: project?.path ?? null,
        configNote: api.note ?? null,
        tty: Boolean(process.stdout.isTTY && process.stdin.isTTY),
        color: colorEnabled(),
        interactive: inputAllowed(),
        auth,
        inference,
        ccloud,
        mcp,
        terminalBackend: pty,
        credentialBackend: credentialBackend(),
        ideBff: health,
      });
      process.exitCode = exitCode;
    });

  return program;
}
