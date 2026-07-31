/**
 * `walkcroach skills list` (C1.4).
 *
 * The registry resolves three sources with a defined precedence — workspace
 * overrides shared, shared overrides bundled — and that precedence is the
 * useful thing to show. "Which skill is actually in effect, and where did it
 * come from" is unanswerable today without reading the registry's source.
 *
 * `--shared` lists the account-scoped skills stored in CockroachDB, which is
 * the same set the IDE sees. That requires a session; without one it says so
 * rather than pretending the account has none.
 */
import { resolve } from 'node:path';
import {
  SECRET_KEYS,
  SkillsRegistry,
  defaultSkillRoots,
} from '@walkcroach/agent-engine';
import { getSecret } from '../lib/config.js';
import { createSharedSkillsBridge, listSharedSkills } from '../lib/api.js';
import { AuthRequiredError, EXIT, exitCodeForError } from '../lib/exit-codes.js';
import { OutputSink } from '../lib/output.js';

export async function skillsList(opts: {
  cwd?: string;
  shared?: boolean;
  json?: boolean;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  const cwd = resolve(opts.cwd ?? process.cwd());

  try {
    const token = await getSecret(SECRET_KEYS.cognitoAccessToken);

    if (opts.shared) {
      if (!token) {
        throw new AuthRequiredError(
          'Shared skills live in your account. Run: walkcroach auth login',
        );
      }
      const skills = await listSharedSkills(token);
      sink.command('skills.list', {
        scope: 'shared',
        skills: skills.map((s) => ({
          name: s.name,
          description: s.description,
          sourceSurface: s.sourceSurface,
          updatedAt: s.updatedAt,
        })),
      });
      return EXIT.OK;
    }

    const registry = new SkillsRegistry();
    await registry.init(defaultSkillRoots(cwd), {
      // Signed in: include the account's shared skills so the listing matches
      // what a run would actually load, rather than a subset of it.
      sharedSkills: token
        ? createSharedSkillsBridge({ getToken: async () => token })
        : undefined,
    });

    sink.command('skills.list', {
      scope: 'effective',
      signedIn: Boolean(token),
      roots: defaultSkillRoots(cwd),
      skills: registry.listMeta(),
    });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}
