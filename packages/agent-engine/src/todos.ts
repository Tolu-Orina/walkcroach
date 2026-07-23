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

export function normalizeTodos(raw: unknown): AgentTodo[] {
  if (!Array.isArray(raw)) {
    throw new Error('todo_write requires a todos array');
  }
  if (raw.length === 0) {
    throw new Error('todo_write requires at least one todo');
  }
  if (raw.length > 20) {
    throw new Error('todo_write allows at most 20 todos');
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
