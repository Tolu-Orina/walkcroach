/**
 * `walkcroach revert` (C1.2) — the only CLI command that rewrites the user's
 * files, so the tests are mostly about what it refuses to do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECKPOINTS_REL_DIR } from '@walkcroach/agent-engine';
import { listTurns, revertCommand } from './revert.js';
import { EXIT } from '../lib/exit-codes.js';
import { resetRuntimeFlags, setRuntimeFlags } from '../lib/runtime.js';

let cwd: string;
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

function lastJson(): any {
  return JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? '{}'));
}

async function writeCheckpoint(
  turnId: string,
  entries: Array<{
    path: string;
    before: string;
    beforeExisted: boolean;
    after: string;
    timestamp: string;
  }>,
): Promise<void> {
  const dir = join(cwd, CHECKPOINTS_REL_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${turnId}.jsonl`),
    entries
      .map((e, i) => JSON.stringify({ toolUseId: `t${i}`, ...e }))
      .join('\n'),
    'utf8',
  );
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'wc-revert-'));
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  setRuntimeFlags({ noInput: true });
});

afterEach(async () => {
  stdout.mockRestore();
  stderr.mockRestore();
  resetRuntimeFlags();
  await rm(cwd, { recursive: true, force: true });
});

describe('listTurns', () => {
  it('returns nothing for a workspace that has never run the agent', async () => {
    expect(await listTurns(cwd)).toEqual([]);
  });

  it('summarises a turn by the distinct files it touched', async () => {
    await writeCheckpoint('turn-1', [
      { path: 'a.ts', before: 'x', beforeExisted: true, after: 'y', timestamp: '2026-07-30T10:00:00Z' },
      { path: 'a.ts', before: 'y', beforeExisted: true, after: 'z', timestamp: '2026-07-30T10:00:01Z' },
      { path: 'b.ts', before: '', beforeExisted: false, after: 'new', timestamp: '2026-07-30T10:00:02Z' },
    ]);
    const [turn] = await listTurns(cwd);
    expect(turn).toMatchObject({ turnId: 'turn-1', paths: ['a.ts', 'b.ts'], entries: 3 });
  });

  it('lists newest first, because that is the turn people undo', async () => {
    await writeCheckpoint('older', [
      { path: 'a.ts', before: '', beforeExisted: true, after: '', timestamp: '2026-07-30T09:00:00Z' },
    ]);
    await writeCheckpoint('newer', [
      { path: 'b.ts', before: '', beforeExisted: true, after: '', timestamp: '2026-07-30T11:00:00Z' },
    ]);
    expect((await listTurns(cwd)).map((t) => t.turnId)).toEqual(['newer', 'older']);
  });

  it('survives a truncated journal line instead of losing the turn', async () => {
    const dir = join(cwd, CHECKPOINTS_REL_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'turn-x.jsonl'),
      `{"path":"a.ts","timestamp":"2026-07-30T10:00:00Z"}\n{"path":"trunc`,
      'utf8',
    );
    const [turn] = await listTurns(cwd);
    expect(turn?.paths).toEqual(['a.ts']);
  });
});

describe('revertCommand', () => {
  it('says so plainly when there is nothing to revert', async () => {
    const code = await revertCommand({ cwd, json: true, yes: true });
    expect(code).toBe(EXIT.OK);
    expect(lastJson().data.message).toMatch(/No checkpointed turns/);
  });

  it('refuses --yes without an explicit --turn', async () => {
    // The guardrail: "most recent" is a moving reference, and being wrong
    // here destroys work that was never committed.
    await writeCheckpoint('turn-1', [
      { path: 'a.ts', before: 'old', beforeExisted: true, after: 'new', timestamp: '2026-07-30T10:00:00Z' },
    ]);
    const code = await revertCommand({ cwd, json: true, yes: true });
    expect(code).toBe(EXIT.USAGE);
    expect(lastJson().error).toMatch(/requires an explicit --turn/);
  });

  it('refuses to change anything when it cannot ask and was not told', async () => {
    await writeCheckpoint('turn-1', [
      { path: 'a.ts', before: 'old', beforeExisted: true, after: 'new', timestamp: '2026-07-30T10:00:00Z' },
    ]);
    await writeFile(join(cwd, 'a.ts'), 'new', 'utf8');

    const code = await revertCommand({ cwd, json: true });
    expect(code).toBe(EXIT.USAGE);
    expect(await readFile(join(cwd, 'a.ts'), 'utf8')).toBe('new');
  });

  it('previews without touching the workspace under --dry-run', async () => {
    await writeCheckpoint('turn-1', [
      { path: 'a.ts', before: 'old', beforeExisted: true, after: 'new', timestamp: '2026-07-30T10:00:00Z' },
    ]);
    await writeFile(join(cwd, 'a.ts'), 'new', 'utf8');

    const code = await revertCommand({ cwd, json: true, dryRun: true });
    expect(code).toBe(EXIT.OK);
    expect(lastJson().data).toMatchObject({ dryRun: true, wouldRestore: ['a.ts'] });
    // Exits 0 having changed nothing, so it is safe to put in front of the
    // real command in a script.
    expect(await readFile(join(cwd, 'a.ts'), 'utf8')).toBe('new');
  });

  it('rejects an unknown turn id and lists the ones that exist', async () => {
    await writeCheckpoint('turn-1', [
      { path: 'a.ts', before: 'old', beforeExisted: true, after: 'new', timestamp: '2026-07-30T10:00:00Z' },
    ]);
    const code = await revertCommand({ cwd, json: true, turn: 'turn-9', yes: true });
    expect(code).toBe(EXIT.USAGE);
    expect(lastJson().error).toContain('turn-1');
  });

  it('restores a modified file when told exactly which turn', async () => {
    await writeCheckpoint('turn-1', [
      { path: 'a.ts', before: 'original', beforeExisted: true, after: 'changed', timestamp: '2026-07-30T10:00:00Z' },
    ]);
    await writeFile(join(cwd, 'a.ts'), 'changed', 'utf8');

    const code = await revertCommand({ cwd, json: true, turn: 'turn-1', yes: true });
    expect(code).toBe(EXIT.OK);
    expect(await readFile(join(cwd, 'a.ts'), 'utf8')).toBe('original');
  });

  it('deletes a file the turn created, rather than leaving it empty', async () => {
    await writeCheckpoint('turn-1', [
      { path: 'created.ts', before: '', beforeExisted: false, after: 'body', timestamp: '2026-07-30T10:00:00Z' },
    ]);
    await writeFile(join(cwd, 'created.ts'), 'body', 'utf8');

    const code = await revertCommand({ cwd, json: true, turn: 'turn-1', yes: true });
    expect(code).toBe(EXIT.OK);
    expect(existsSync(join(cwd, 'created.ts'))).toBe(false);
  });
});
