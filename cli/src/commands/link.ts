import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  SECRET_KEYS,
  normalizeLocalRepoKey,
} from '@walkcroach/agent-engine';
import { getSecret } from '../lib/config.js';
import {
  AuthRequiredError,
  EXIT,
  exitCodeForError,
} from '../lib/exit-codes.js';
import {
  createLink,
  deleteLink,
  ideMe,
  listMyProjects,
} from '../lib/api.js';
import { OutputSink } from '../lib/output.js';

const execFileAsync = promisify(execFile);

async function requireToken(): Promise<string> {
  const token = await getSecret(SECRET_KEYS.cognitoAccessToken);
  if (!token) {
    throw new AuthRequiredError(
      'Not signed in. Run: walkcroach auth login',
    );
  }
  return token;
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

export async function linkProject(opts: {
  projectId: string;
  cwd?: string;
  json?: boolean;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  try {
    const token = await requireToken();
    const cwd = resolve(opts.cwd ?? process.cwd());
    const remote = await gitRemote(cwd);
    const link = await createLink(token, {
      projectId: opts.projectId,
      gitRemoteUrl: remote,
      workspacePath: cwd,
      localRepoDisplay: remote ?? cwd,
    });
    sink.command('link', link);
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}

export async function unlinkProject(opts: {
  cwd?: string;
  json?: boolean;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  try {
    const token = await requireToken();
    const cwd = resolve(opts.cwd ?? process.cwd());
    const remote = await gitRemote(cwd);
    const key = normalizeLocalRepoKey({
      gitRemoteUrl: remote,
      workspacePath: cwd,
    });
    const me = await ideMe(token, key);
    if (!me.link?.id) {
      sink.command('unlink', { ok: true, message: 'No link for this workspace' });
      return 0;
    }
    await deleteLink(token, me.link.id);
    sink.command('unlink', { ok: true, linkId: me.link.id });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}

export async function listProjects(opts: { json?: boolean }): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  try {
    const token = await requireToken();
    const projects = await listMyProjects(token);
    sink.command('projects', { projects });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}

export async function linkStatus(opts: {
  cwd?: string;
  json?: boolean;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  try {
    const token = await requireToken();
    const cwd = resolve(opts.cwd ?? process.cwd());
    const remote = await gitRemote(cwd);
    const key = normalizeLocalRepoKey({
      gitRemoteUrl: remote,
      workspacePath: cwd,
    });
    const me = await ideMe(token, key);
    sink.command('link.status', {
      localRepoKey: key,
      link: me.link,
      ownerId: me.ownerId,
    });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}
