/**
 * `walkcroach mcp list` / `walkcroach mcp revoke [server|--all]`.
 *
 * §6.1 of the stdio security review requires consent to be "recorded **and
 * revocable**". Recording it without a way to withdraw it would be a one-way
 * door, so this command is part of the security feature rather than a
 * convenience wrapper around it.
 *
 * There is deliberately no `mcp status` showing live processes. The CLI is
 * one-shot: `walkcroach run …` spawns its servers, does the work and exits, so a
 * separate `mcp status` invocation would have its own empty supervisor and could
 * only ever report "nothing running". Printing that would be a lie dressed as a
 * feature. Live process status belongs to the IDE, where a window actually
 * outlives a turn.
 *
 * The description itself comes from `describeConfiguredMcpServers` in the engine,
 * shared with the IDE Setup view — two implementations of "is this approved"
 * would eventually disagree, and the one that drifted would be telling someone
 * their machine is safer than it is.
 */
import {
  describeConfiguredMcpServers,
  loadMcpServersConfig,
  revokeStdioConsent,
} from '@walkcroach/agent-engine';
import { getSecret, setSecret, resolveAllowStdioMcp } from '../lib/config.js';
import { EXIT } from '../lib/exit-codes.js';
import { OutputSink } from '../lib/output.js';

const secrets = {
  get: (key: string) => getSecret(key),
  store: (key: string, value: string) => setSecret(key, value),
};

export async function mcpList(opts: {
  cwd?: string;
  json?: boolean;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  const cwd = opts.cwd ?? process.cwd();
  const allowStdio = await resolveAllowStdioMcp();

  const servers = await describeConfiguredMcpServers({
    fileServers: await loadMcpServersConfig(cwd),
    secrets,
    allowStdio,
    workspaceRoot: cwd,
    // No supervisor is passed: nothing is running inside a `mcp list` process,
    // and claiming otherwise is exactly the lie this command avoids.
  });

  const hint =
    !allowStdio && servers.some((s) => s.transport === 'stdio')
      ? 'Local process servers are off. Enable with `walkcroach config set mcpAllowStdio true` — user-level only, so a repository cannot enable this for you.'
      : undefined;

  sink.command('mcp.list', {
    allowStdio,
    servers,
    ...(hint ? { hint } : {}),
  });
  return EXIT.OK;
}

export async function mcpRevoke(opts: {
  server?: string;
  all?: boolean;
  json?: boolean;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  if (!opts.server && !opts.all) {
    sink.failure(new Error('Specify a server name, or --all.'));
    return EXIT.USAGE;
  }
  const revoked = await revokeStdioConsent(
    secrets,
    opts.all ? undefined : opts.server,
  );
  sink.command('mcp.revoke', {
    revoked,
    message:
      revoked === 0
        ? 'No matching approvals were recorded.'
        : `Revoked ${revoked} approval${revoked === 1 ? '' : 's'}. The next run will ask again.`,
  });
  return EXIT.OK;
}
