import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentTodo } from './todos.js';
import { normalizeTodos } from './todos.js';

export const WALK_CROACH_DIR = '.walkcroach';
export const TODOS_REL_PATH = '.walkcroach/todos.json';

export async function persistTodos(
  workspaceRoot: string,
  todos: AgentTodo[],
): Promise<string> {
  const abs = join(workspaceRoot, TODOS_REL_PATH);
  await mkdir(dirname(abs), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    todos,
  };
  await writeFile(abs, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return TODOS_REL_PATH;
}

export async function loadPersistedTodos(
  workspaceRoot: string,
): Promise<AgentTodo[] | null> {
  const abs = join(workspaceRoot, TODOS_REL_PATH);
  try {
    const raw = await readFile(abs, 'utf8');
    const parsed = JSON.parse(raw) as { todos?: unknown };
    return normalizeTodos(parsed.todos);
  } catch {
    return null;
  }
}

export async function clearPersistedTodos(
  workspaceRoot: string,
): Promise<void> {
  const abs = join(workspaceRoot, TODOS_REL_PATH);
  try {
    await unlink(abs);
  } catch {
    /* missing is fine */
  }
}
