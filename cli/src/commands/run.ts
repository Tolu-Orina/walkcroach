import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  runAgentLoop,
  loadMcpConfigFromSecrets,
  SECRET_KEYS,
  describeMissingCredentials,
  normalizeLocalRepoKey,
  resolveInferenceCredentials,
  withInferenceCredentials,
  type AgentEvent,
  type ProjectMemoryBridge,
  type SharedSkillsBridge,
} from '@walkcroach/agent-engine';
import { CliHostAdapter } from '../host/CliHostAdapter.js';
import {
  createProjectMemoryBridge,
  createSharedSkillsBridge,
  ideMe,
} from '../lib/api.js';
import { getSecret, loadConfig } from '../lib/config.js';
import { EXIT, NoCredentialsError } from '../lib/exit-codes.js';
import { OutputSink, type OutputMode } from '../lib/output.js';

const execFileAsync = promisify(execFile);

export type RunCommandOpts = {
  prompt: string;
  cwd?: string;
  mode: OutputMode;
  nonInteractive?: boolean;
  autonomy?: 'strict' | 'low_friction';
  plan?: boolean;
};

export async function runAgentCommand(opts: RunCommandOpts): Promise<number> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const sink = new OutputSink(opts.mode);
  const listeners = new Set<(e: AgentEvent) => void>();

  if (opts.mode === 'json' && !opts.nonInteractive) {
    const message =
      'JSON mode requires --yes or --non-interactive so approvals are not silent-rejected (FR-D24/D25).';
    sink.result(false, { error: message });
    return 1;
  }

  const host = new CliHostAdapter({
    cwd,
    nonInteractive: opts.nonInteractive,
    autonomy: opts.autonomy ?? 'strict',
    promptApprovals: opts.mode === 'text' && !opts.nonInteractive,
    externalApprovals: opts.mode === 'tui',
    onEvent: (event) => {
      sink.event(event);
      for (const fn of listeners) fn(event);
    },
  });

  const abort = new AbortController();
  host.setRunSignal(abort.signal);

  const token = await getSecret(SECRET_KEYS.cognitoAccessToken);
  const mcpConfig = await loadMcpConfigFromSecrets((k) => getSecret(k));
  const ccloudApiKey =
    (await getSecret(SECRET_KEYS.ccloudApiKey)) ?? mcpConfig?.apiKey;

  let projectMemory: ProjectMemoryBridge | null = null;
  let sharedSkills: SharedSkillsBridge | null = null;
  let linkedName: string | null = null;
  let signedIn = Boolean(token);

  if (token) {
    sharedSkills = createSharedSkillsBridge({
      getToken: () => getSecret(SECRET_KEYS.cognitoAccessToken),
      sourceSurface: 'desktop',
    });
    try {
      const remote = await gitRemote(cwd);
      const localRepoKey = normalizeLocalRepoKey({
        gitRemoteUrl: remote,
        workspacePath: cwd,
      });
      const me = await ideMe(token, localRepoKey);
      if (me.link?.projectId) {
        linkedName = me.link.projectName ?? me.link.projectId;
        projectMemory = createProjectMemoryBridge({
          getToken: () => getSecret(SECRET_KEYS.cognitoAccessToken),
          projectId: me.link.projectId,
          projectName: linkedName ?? undefined,
        });
      }
    } catch {
      // BFF optional when offline — local agent still runs
      signedIn = Boolean(token);
    }
  }

  const loopOpts = {
    host,
    prompt: opts.prompt,
    signal: abort.signal,
    mode: opts.plan ? ('plan' as const) : undefined,
    subagentsEnabled: true,
    includePhaseB: true,
    mcpConfig,
    ccloudApiKey,
    projectMemory,
    sharedSkills,
  };

  let exitCode = 0;

  // BYOK (Part 1 §4A). Inference runs on the user's own AWS credentials, so
  // check before starting: a run that fails 30 seconds in on an auth error is
  // a much worse way to learn this than one line up front.
  const credentials = await resolveInferenceCredentials(
    { get: getSecret },
    { region: (await loadConfig()).bedrockRegion },
  );
  if (!credentials.configured) {
    // Typed, so `--json` carries `code: "no_credentials"` — distinct from an
    // auth failure, because signing in does not fix it.
    const [message, ...rest] = describeMissingCredentials('cli').split('\n');
    sink.failure(
      new NoCredentialsError(message ?? '', rest.join(' ').trim() || undefined),
    );
    return EXIT.USAGE;
  }

  /** Every Bedrock call in this run sees the user's stored key, if there is one. */
  const runLoop = () =>
    withInferenceCredentials({ get: getSecret }, () => runAgentLoop(loopOpts));

  if (opts.mode === 'tui') {
    const { runTui } = await import('../tui/render.js');
    // Subscribe TUI before the loop so early approval_request events are not missed.
    const tuiDone = runTui({
      task: opts.prompt,
      signedIn,
      linkedProjectName: linkedName,
      mcpConfigured: Boolean(mcpConfig),
      subscribe: (fn) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      onApprove: (stepId) => host.resolveApproval(stepId, 'approve'),
      onReject: (stepId) => host.resolveApproval(stepId, 'reject'),
      onCancel: () => abort.abort(),
    });

    try {
      await runLoop();
    } catch (err) {
      exitCode = EXIT.RUN_FAILED;
      const message = err instanceof Error ? err.message : String(err);
      host.emit({ type: 'error', message, fatal: true });
    }

    await new Promise((r) => setTimeout(r, 50));
    await tuiDone;
  } else {
    try {
      await runLoop();
    } catch (err) {
      exitCode = EXIT.RUN_FAILED;
      const message = err instanceof Error ? err.message : String(err);
      sink.result(false, { error: message });
      return exitCode;
    }
  }

  sink.result(exitCode === 0, { reason: 'complete' });
  return exitCode;
}

async function gitRemote(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['remote', 'get-url', 'origin'],
      { cwd },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
