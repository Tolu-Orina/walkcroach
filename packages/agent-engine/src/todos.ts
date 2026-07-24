/**
 * Agent checklist item — externalized progress (Claude Code TodoWrite / Cline focus_chain pattern).
 */
export type AgentTodoStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type AgentTodo = {
  id: string;
  content: string;
  status: AgentTodoStatus;
};

const STATUSES = new Set<AgentTodoStatus>([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

export const TODO_WRITE_MIN = 1;
export const TODO_WRITE_MAX = 20;

export function normalizeTodos(raw: unknown): AgentTodo[] {
  if (!Array.isArray(raw)) {
    throw new Error('todo_write requires a todos array');
  }
  if (raw.length < TODO_WRITE_MIN) {
    throw new Error('todo_write requires at least one todo');
  }
  if (raw.length > TODO_WRITE_MAX) {
    throw new Error(`todo_write allows at most ${TODO_WRITE_MAX} todos`);
  }
  const seen = new Set<string>();
  const out: AgentTodo[] = [];
  let inProgress = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each todo must be an object');
    }
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? '').trim();
    const content = String(row.content ?? '').trim();
    const status = String(row.status ?? '') as AgentTodoStatus;
    if (!id) throw new Error('Each todo needs a non-empty id');
    if (!content) throw new Error(`Todo ${id} needs content`);
    if (!STATUSES.has(status)) {
      throw new Error(
        `Todo ${id} has invalid status (use pending|in_progress|completed|cancelled)`,
      );
    }
    if (seen.has(id)) throw new Error(`Duplicate todo id: ${id}`);
    seen.add(id);
    if (status === 'in_progress') inProgress += 1;
    out.push({ id, content, status });
  }
  if (inProgress > 1) {
    throw new Error('At most one todo may be in_progress');
  }
  return out;
}

export function formatTodosForModel(todos: AgentTodo[]): string {
  const lines = todos.map(
    (t) => `- [${t.status}] ${t.id}: ${t.content}`,
  );
  return `Updated task checklist (${todos.length} items):\n${lines.join('\n')}`;
}

/** Prompt block so the model always sees the same checklist as the UI. */
export function formatTodosChecklistBlock(todos: AgentTodo[]): string {
  if (!todos.length) return '';
  const lines = todos.map(
    (t) => `- [${t.status}] ${t.id}: ${t.content}`,
  );
  return [
    '# Task checklist (current)',
    '',
    ...lines,
    '',
    'Call `todo_write` with the full updated list when you start, finish, or switch steps. Keep exactly one item `in_progress` while working.',
  ].join('\n');
}

/** Open work remains (not all completed/cancelled). */
export function hasOpenTodos(todos: AgentTodo[]): boolean {
  return todos.some(
    (t) => t.status === 'pending' || t.status === 'in_progress',
  );
}

/** Soft gate: mutations happened but checklist never written. */
export function needsTodoWriteNudge(params: {
  didTodoWrite: boolean;
  didMutatingWork: boolean;
}): boolean {
  return params.didMutatingWork && !params.didTodoWrite;
}

/**
 * Soft gate: checklist exists with open items but nothing is in_progress
 * after mutations (model stalled without advancing the list).
 */
export function needsTodoProgressNudge(params: {
  todos: AgentTodo[];
  didTodoWrite: boolean;
  didMutatingWork: boolean;
}): boolean {
  if (!params.didMutatingWork || !params.didTodoWrite) return false;
  if (!hasOpenTodos(params.todos)) return false;
  const inProgress = params.todos.some((t) => t.status === 'in_progress');
  return !inProgress;
}

export function buildTodoWriteNudgePrompt(): string {
  return [
    'You made changes but never called `todo_write`.',
    'Call `todo_write` now with a short checklist of remaining work (exactly one `in_progress`), then continue the unfinished steps with write_file / edit_file / run_terminal / verify.',
    'Do not end your turn with only a summary.',
  ].join('\n');
}

export function buildTodoProgressNudgePrompt(todos: AgentTodo[]): string {
  const block = formatTodosChecklistBlock(todos);
  return [
    'Your checklist still has open items but none are `in_progress`.',
    'Call `todo_write` to mark finished steps `completed`, set the next step to `in_progress`, then do that step.',
    block,
  ]
    .filter(Boolean)
    .join('\n\n');
}
