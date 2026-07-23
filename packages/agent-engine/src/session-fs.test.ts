import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPersistedTodos,
  loadPersistedTodos,
  persistTodos,
  TODOS_REL_PATH,
} from './session-fs.js';
import { killProcessTree } from './process-kill.js';

describe('session-fs todos', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('persists and loads todos under .walkcroach/todos.json', async () => {
    dir = await mkdtemp(join(tmpdir(), 'wc-todos-'));
    const path = await persistTodos(dir, [
      { id: 'a', content: 'Do thing', status: 'pending' },
    ]);
    expect(path).toBe(TODOS_REL_PATH);
    const raw = await readFile(join(dir, TODOS_REL_PATH), 'utf8');
    expect(raw).toContain('Do thing');
    const loaded = await loadPersistedTodos(dir);
    expect(loaded).toEqual([
      { id: 'a', content: 'Do thing', status: 'pending' },
    ]);
    await clearPersistedTodos(dir);
    expect(await loadPersistedTodos(dir)).toBeNull();
  });
});

describe('killProcessTree', () => {
  it('no-ops on invalid pids', () => {
    expect(() => killProcessTree(undefined)).not.toThrow();
    expect(() => killProcessTree(0)).not.toThrow();
    expect(() => killProcessTree(-1)).not.toThrow();
  });
});
