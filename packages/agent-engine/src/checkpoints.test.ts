import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeHost } from './fake-host.js';
import {
  CHECKPOINTS_REL_DIR,
  DEFAULT_MAX_CHECKPOINT_TURNS,
  recordCheckpoint,
  revertTurn,
} from './checkpoints.js';
import { DEFAULT_TOOL_RESULT_MAX_CHARS } from './truncate.js';

describe('recordCheckpoint / revertTurn', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('round-trips write then edit: revert restores the original content', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-checkpoints-'));
    const host = createFakeHost({ workspaceRoot: dir });
    const turnId = randomUUID();

    // Simulates write_file creating a new file...
    await host.writeFile('src/a.ts', 'export const a = 1;\n');
    await recordCheckpoint(dir, {
      turnId,
      toolUseId: 't1',
      path: 'src/a.ts',
      before: '',
      beforeExisted: false,
      after: 'export const a = 1;\n',
    });

    // ...then edit_file changing it.
    await host.writeFile('src/a.ts', 'export const a = 2;\n');
    await recordCheckpoint(dir, {
      turnId,
      toolUseId: 't2',
      path: 'src/a.ts',
      before: 'export const a = 1;\n',
      beforeExisted: true,
      after: 'export const a = 2;\n',
    });

    expect(await host.readFile('src/a.ts')).toBe('export const a = 2;\n');

    const { reverted } = await revertTurn(dir, host, turnId);
    expect(reverted).toEqual(['src/a.ts', 'src/a.ts']);
    // File never existed before the turn — reverting the edit lands back on
    // '' created-state content (write_file's before), then the create itself
    // is undone by deleting it.
    expect(host.files.has('src/a.ts')).toBe(false);
  });

  it('reverts a created file by deleting it, and an edited file by restoring content', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-checkpoints-'));
    const host = createFakeHost({
      workspaceRoot: dir,
      files: { 'existing.ts': 'export const x = 1;\n' },
    });
    const turnId = randomUUID();

    // Tool call 1: edits an existing file.
    await host.writeFile('existing.ts', 'export const x = 2;\n');
    await recordCheckpoint(dir, {
      turnId,
      toolUseId: 't1',
      path: 'existing.ts',
      before: 'export const x = 1;\n',
      beforeExisted: true,
      after: 'export const x = 2;\n',
    });

    // Tool call 2: creates a brand-new file.
    await host.writeFile('new.ts', 'export const y = 1;\n');
    await recordCheckpoint(dir, {
      turnId,
      toolUseId: 't2',
      path: 'new.ts',
      before: '',
      beforeExisted: false,
      after: 'export const y = 1;\n',
    });

    const { reverted } = await revertTurn(dir, host, turnId);
    expect(reverted).toEqual(['new.ts', 'existing.ts']); // reverse order
    expect(host.files.has('new.ts')).toBe(false);
    expect(await host.readFile('existing.ts')).toBe('export const x = 1;\n');
  });

  it('throws when reverting a created file and the host has no deleteFile', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-checkpoints-'));
    const host = createFakeHost({ workspaceRoot: dir });
    const hostWithoutDelete = { ...host, deleteFile: undefined };
    const turnId = randomUUID();

    await recordCheckpoint(dir, {
      turnId,
      toolUseId: 't1',
      path: 'new.ts',
      before: '',
      beforeExisted: false,
      after: 'x',
    });

    await expect(revertTurn(dir, hostWithoutDelete, turnId)).rejects.toThrow(
      /deleteFile/,
    );
  });

  it('is a no-op when the turn has no checkpoint file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-checkpoints-'));
    const host = createFakeHost({ workspaceRoot: dir });
    const { reverted } = await revertTurn(dir, host, randomUUID());
    expect(reverted).toEqual([]);
  });

  it('does not record checkpoints for workspaceRoot undefined (no-op, never throws)', async () => {
    await expect(
      recordCheckpoint(undefined, {
        turnId: randomUUID(),
        toolUseId: 't1',
        path: 'a.ts',
        before: '',
        beforeExisted: false,
        after: 'x',
      }),
    ).resolves.toBeUndefined();
  });

  it('skips recording (silently) for files above the truncation-convention size cap', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-checkpoints-'));
    const turnId = randomUUID();
    const huge = 'x'.repeat(DEFAULT_TOOL_RESULT_MAX_CHARS + 1);

    await recordCheckpoint(dir, {
      turnId,
      toolUseId: 't1',
      path: 'huge.ts',
      before: '',
      beforeExisted: false,
      after: huge,
    });

    const checkpointFile = join(
      dir,
      CHECKPOINTS_REL_DIR,
      `${turnId}.jsonl`,
    );
    await expect(readFile(checkpointFile, 'utf8')).rejects.toThrow();
  });

  it('prunes checkpoint files beyond DEFAULT_MAX_CHECKPOINT_TURNS, keeping the newest', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-checkpoints-'));
    const turnIds: string[] = [];
    for (let i = 0; i < DEFAULT_MAX_CHECKPOINT_TURNS + 2; i++) {
      const turnId = randomUUID();
      turnIds.push(turnId);
      await recordCheckpoint(dir, {
        turnId,
        toolUseId: `t${i}`,
        path: `f${i}.ts`,
        before: '',
        beforeExisted: false,
        after: `content ${i}`,
      });
      // Ensure distinct mtimes for the prune-by-mtime comparison.
      await new Promise((r) => setTimeout(r, 15));
    }

    const files = await readdir(join(dir, CHECKPOINTS_REL_DIR));
    expect(files.length).toBeLessThanOrEqual(DEFAULT_MAX_CHECKPOINT_TURNS);
    expect(files).toContain(`${turnIds[turnIds.length - 1]}.jsonl`);
  });
});
