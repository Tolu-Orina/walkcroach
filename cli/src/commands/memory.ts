/**
 * `walkcroach memory list` (C1.3).
 *
 * Two layers, deliberately shown together, because they answer different
 * questions and the difference is the whole architecture:
 *
 *  - **local** — `WALKCROACH.md` in the workspace, readable offline, the file
 *    the agent treats as project convention.
 *  - **project** — the CockroachDB vector store shared with Web, Chrome and
 *    the IDE, which is what "memory-first across surfaces" actually means.
 *
 * The project layer needs a signed-in session and a linked project. Missing
 * either is reported as a state, not an error: a developer offline on a train
 * should still see their local memory.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SECRET_KEYS, normalizeLocalRepoKey } from '@walkcroach/agent-engine';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getSecret } from '../lib/config.js';
import { createProjectMemoryBridge, ideMe } from '../lib/api.js';
import { EXIT, exitCodeForError } from '../lib/exit-codes.js';
import { formatMemoryHitsText } from '../lib/memory-format.js';
import { OutputSink } from '../lib/output.js';

const execFileAsync = promisify(execFile);

export const WALKCROACH_MD = 'WALKCROACH.md';

/** Section headings and their line counts — enough to see what is remembered. */
export function summariseWalkcroachMd(raw: string): Array<{
  heading: string;
  lines: number;
}> {
  const sections: Array<{ heading: string; lines: number }> = [];
  let current: { heading: string; lines: number } | null = null;
  for (const line of raw.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line.replace(/^#{1,6}\s*/, '').trim(), lines: 0 };
    } else if (current && line.trim()) {
      current.lines += 1;
    }
  }
  if (current) sections.push(current);
  return sections;
}

async function gitRemote(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function memoryList(opts: {
  cwd?: string;
  query?: string;
  limit?: number;
  json?: boolean;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  const cwd = resolve(opts.cwd ?? process.cwd());

  try {
    const mdPath = join(cwd, WALKCROACH_MD);
    const local = existsSync(mdPath)
      ? summariseWalkcroachMd(await readFile(mdPath, 'utf8'))
      : null;

    const token = await getSecret(SECRET_KEYS.cognitoAccessToken);
    if (!token) {
      sink.command('memory.list', {
        local,
        project: null,
        note: 'Not signed in — showing local WALKCROACH.md only. Run: walkcroach auth login',
      });
      return EXIT.OK;
    }

    const key = normalizeLocalRepoKey({
      gitRemoteUrl: await gitRemote(cwd),
      workspacePath: cwd,
    });
    const me = await ideMe(token, key);
    if (!me.link?.projectId) {
      sink.command('memory.list', {
        local,
        project: null,
        note: 'This workspace is not linked to a project. Run: walkcroach link <projectId>',
      });
      return EXIT.OK;
    }

    const bridge = createProjectMemoryBridge({
      getToken: async () => token,
      projectId: me.link.projectId,
      projectName: me.link.projectName ?? undefined,
    });
    // An empty query means "anything recent"; recall is a vector search, so
    // the wildcard is a broad term rather than an absent one.
    const hits = await bridge.recall({
      query: opts.query?.trim() || 'project decisions and conventions',
      limit: opts.limit ?? 10,
    });

    if (opts.json) {
      sink.command('memory.list', {
        local,
        project: {
          projectId: me.link.projectId,
          projectName: me.link.projectName ?? null,
          query: opts.query?.trim() || null,
          hits,
        },
      });
    } else {
      const lines: string[] = [];
      if (local) {
        lines.push('Local WALKCROACH.md');
        for (const s of local) {
          lines.push(`  · ${s.heading} (${s.lines} lines)`);
        }
        lines.push('');
      } else {
        lines.push('Local WALKCROACH.md: (none)');
        lines.push('');
      }
      lines.push(
        `Project memory · ${me.link.projectName ?? me.link.projectId}`,
      );
      lines.push(formatMemoryHitsText(hits));
      sink.command('memory.list', lines.join('\n'));
    }
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}
