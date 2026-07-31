/**
 * `walkcroach revert` (C1.2).
 *
 * The engine has shipped `revertTurn` since Phase C; only the IDE could reach
 * it. This command closes that gap without adding engine surface.
 *
 * It is the one command here that *writes* to the user's workspace — restoring
 * files and deleting ones a turn created — so it behaves like the confirm
 * cards on the other surfaces: show exactly what will change, then ask. Under
 * `--yes` it proceeds only against an explicitly named turn, never an inferred
 * "most recent" one, because guessing wrong destroys work.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { CHECKPOINTS_REL_DIR, revertTurn } from '@walkcroach/agent-engine';
import { CliHostAdapter } from '../host/CliHostAdapter.js';
import { EXIT, exitCodeForError } from '../lib/exit-codes.js';
import { OutputSink } from '../lib/output.js';
import { inputAllowed } from '../lib/runtime.js';

export type TurnSummary = {
  turnId: string;
  /** Distinct files the turn touched, in the order it touched them. */
  paths: string[];
  entries: number;
  /** ISO timestamp of the last recorded change in the turn. */
  lastChangeAt: string | null;
};

/**
 * Read the checkpoint journal without going through the engine.
 *
 * `CHECKPOINTS_REL_DIR` is exported precisely so hosts can do this; adding a
 * `listTurns` to the engine would be new shared surface the IDE does not need
 * (cross-surface rule X1: additive only, and only where it earns its place).
 */
export async function listTurns(workspaceRoot: string): Promise<TurnSummary[]> {
  const dir = join(workspaceRoot, CHECKPOINTS_REL_DIR);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
  const summaries: TurnSummary[] = [];

  for (const file of files) {
    const turnId = file.replace(/\.jsonl$/, '');
    try {
      const raw = await readFile(join(dir, file), 'utf8');
      const paths: string[] = [];
      let entries = 0;
      let lastChangeAt: string | null = null;
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { path?: string; timestamp?: string };
          entries += 1;
          if (entry.path && !paths.includes(entry.path)) paths.push(entry.path);
          if (entry.timestamp) lastChangeAt = entry.timestamp;
        } catch {
          // One malformed line must not hide the rest of the turn.
        }
      }
      summaries.push({ turnId, paths, entries, lastChangeAt });
    } catch {
      // Unreadable journal: skip rather than fail the listing.
    }
  }

  // Newest first — the turn someone wants to undo is nearly always the last.
  return summaries.sort((a, b) => (a.lastChangeAt ?? '').localeCompare(b.lastChangeAt ?? '')).reverse();
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

export async function revertCommand(opts: {
  cwd?: string;
  turn?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
}): Promise<number> {
  const sink = new OutputSink(opts.json ? 'json' : 'text');
  const cwd = resolve(opts.cwd ?? process.cwd());

  try {
    const turns = await listTurns(cwd);
    if (turns.length === 0) {
      sink.command('revert', {
        ok: true,
        reverted: [],
        message: 'No checkpointed turns in this workspace.',
      });
      return EXIT.OK;
    }

    const target = opts.turn
      ? turns.find((t) => t.turnId === opts.turn)
      : turns[0];

    if (!target) {
      sink.result(false, {
        error: `No checkpoint for turn "${opts.turn}". Known turns: ${turns
          .map((t) => t.turnId)
          .join(', ')}`,
      });
      return EXIT.USAGE;
    }

    if (opts.dryRun) {
      // Exits 0 having changed nothing — safe to put in front of the real run.
      sink.command('revert', {
        ok: true,
        dryRun: true,
        turnId: target.turnId,
        wouldRestore: target.paths,
      });
      return EXIT.OK;
    }

    if (!opts.yes) {
      if (!inputAllowed()) {
        sink.result(false, {
          error:
            'revert changes files. Re-run with --yes --turn <id>, or --dry-run to preview.',
        });
        return EXIT.USAGE;
      }
      process.stderr.write(
        `Revert turn ${target.turnId} — ${target.paths.length} file(s):\n` +
          target.paths.map((p) => `  ${p}\n`).join(''),
      );
      if (!(await confirm('Restore these files to their state before that turn?'))) {
        sink.command('revert', { ok: false, cancelled: true, turnId: target.turnId });
        return EXIT.OK;
      }
    } else if (!opts.turn) {
      // The guardrail that matters: unattended reverts must name their target.
      // "Most recent" is a moving reference, and being wrong here deletes work.
      sink.result(false, {
        error:
          '--yes requires an explicit --turn <id>; refusing to revert an inferred turn.',
      });
      return EXIT.USAGE;
    }

    const host = new CliHostAdapter({ cwd, nonInteractive: true });
    const { reverted } = await revertTurn(cwd, host, target.turnId);
    sink.command('revert', { ok: true, turnId: target.turnId, reverted });
    return EXIT.OK;
  } catch (err) {
    sink.failure(err);
    return exitCodeForError(err);
  }
}
