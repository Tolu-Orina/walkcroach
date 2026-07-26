/**
 * Per-turn checkpoint / revert — before/after snapshots for mutating tool calls
 * (write_file/edit_file/apply_patch/update_walkcroach_md), so a user can undo
 * everything one assistant turn did without relying on git (the workspace may
 * not even be a repo — see workspace-config.ts / VsCodeHostAdapter, neither
 * assumes one).
 *
 * Layout: .walkcroach/checkpoints/<turnId>.jsonl — one JSON line per mutating
 * tool call in that turn, appended in the order they happened.
 */

import { appendFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostAdapter } from './host.js';
import { WALK_CROACH_DIR } from './session-fs.js';
import { DEFAULT_TOOL_RESULT_MAX_CHARS } from './truncate.js';

export const CHECKPOINTS_REL_DIR = `${WALK_CROACH_DIR}/checkpoints`;
/** Oldest turn checkpoint files are pruned beyond this count (mirrors session-store's DEFAULT_MAX_SESSIONS). */
export const DEFAULT_MAX_CHECKPOINT_TURNS = 20;

export type CheckpointEntry = {
  toolUseId: string;
  path: string;
  before: string;
  /** False when the tool call created a new file — revert deletes it rather than restoring empty content. */
  beforeExisted: boolean;
  after: string;
  timestamp: string;
};

function checkpointsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, CHECKPOINTS_REL_DIR);
}

function checkpointFile(workspaceRoot: string, turnId: string): string {
  return join(checkpointsRoot(workspaceRoot), `${turnId}.jsonl`);
}

/**
 * Appends one checkpoint entry for a mutating tool call. Best-effort: never
 * throws — a bookkeeping failure must not fail the tool call it's recording.
 * Skips files above DEFAULT_TOOL_RESULT_MAX_CHARS so a huge generated file
 * doesn't bloat .walkcroach/checkpoints.
 */
export async function recordCheckpoint(
  workspaceRoot: string | undefined,
  params: {
    turnId: string;
    toolUseId: string;
    path: string;
    before: string;
    beforeExisted: boolean;
    after: string;
  },
): Promise<void> {
  if (!workspaceRoot) return;
  if (
    params.before.length > DEFAULT_TOOL_RESULT_MAX_CHARS ||
    params.after.length > DEFAULT_TOOL_RESULT_MAX_CHARS
  ) {
    return;
  }
  try {
    await mkdir(checkpointsRoot(workspaceRoot), { recursive: true });
    const entry: CheckpointEntry = {
      toolUseId: params.toolUseId,
      path: params.path,
      before: params.before,
      beforeExisted: params.beforeExisted,
      after: params.after,
      timestamp: new Date().toISOString(),
    };
    await appendFile(
      checkpointFile(workspaceRoot, params.turnId),
      `${JSON.stringify(entry)}\n`,
      'utf8',
    );
    await pruneOldCheckpoints(
      workspaceRoot,
      DEFAULT_MAX_CHECKPOINT_TURNS,
      params.turnId,
    );
  } catch {
    /* best-effort — never fail the tool call over checkpoint bookkeeping */
  }
}

async function readCheckpointEntries(
  workspaceRoot: string,
  turnId: string,
): Promise<CheckpointEntry[]> {
  let raw: string;
  try {
    raw = await readFile(checkpointFile(workspaceRoot, turnId), 'utf8');
  } catch {
    return [];
  }
  const entries: CheckpointEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as CheckpointEntry);
    } catch {
      /* skip corrupt line */
    }
  }
  return entries;
}

/**
 * Reverts every mutating tool call recorded for `turnId`, most-recent-first
 * (so a later edit to a file written earlier in the same turn unwinds cleanly).
 * Files the turn created are deleted; files it edited are restored to their
 * pre-turn content. No checkpoint file for `turnId` → no-op, `{ reverted: [] }`.
 */
export async function revertTurn(
  workspaceRoot: string,
  host: HostAdapter,
  turnId: string,
): Promise<{ reverted: string[] }> {
  const entries = await readCheckpointEntries(workspaceRoot, turnId);
  const reverted: string[] = [];
  for (const entry of [...entries].reverse()) {
    if (!entry.beforeExisted) {
      if (!host.deleteFile) {
        throw new Error(
          'This host does not support deleting files (HostAdapter.deleteFile) — cannot revert a created file.',
        );
      }
      await host.deleteFile(entry.path);
    } else {
      await host.writeFile(entry.path, entry.before);
    }
    reverted.push(entry.path);
  }
  return { reverted };
}

async function pruneOldCheckpoints(
  workspaceRoot: string,
  maxTurns: number,
  keepTurnId: string,
): Promise<void> {
  if (maxTurns <= 0) return;
  const root = checkpointsRoot(workspaceRoot);
  let files: string[] = [];
  try {
    files = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => e.name);
  } catch {
    return;
  }
  if (files.length <= maxTurns) return;

  const scored: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of files) {
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(join(root, name))).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    scored.push({ name, mtimeMs });
  }
  scored.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keepName = `${keepTurnId}.jsonl`;
  for (const row of scored.slice(maxTurns)) {
    if (row.name === keepName) continue;
    try {
      await rm(join(root, row.name), { force: true });
    } catch {
      /* ignore */
    }
  }
}
