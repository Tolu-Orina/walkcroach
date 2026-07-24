import { describe, expect, it } from 'vitest';
import {
  buildFollowUpTurn,
  buildTodoProgressNudgePrompt,
  buildTodoWriteNudgePrompt,
  buildUserTurn,
  formatTodosChecklistBlock,
  hasOpenTodos,
  needsTodoProgressNudge,
  needsTodoWriteNudge,
  normalizeTodos,
} from './index.js';

describe('todo P0 helpers', () => {
  const sample = normalizeTodos([
    { id: '1', content: 'Scaffold app', status: 'completed' },
    { id: '2', content: 'Add lint', status: 'pending' },
  ]);

  it('formatTodosChecklistBlock includes statuses for prompt injection', () => {
    const block = formatTodosChecklistBlock(sample);
    expect(block).toContain('# Task checklist (current)');
    expect(block).toContain('[completed] 1: Scaffold app');
    expect(block).toContain('[pending] 2: Add lint');
    expect(formatTodosChecklistBlock([])).toBe('');
  });

  it('hasOpenTodos detects pending/in_progress', () => {
    expect(hasOpenTodos(sample)).toBe(true);
    expect(
      hasOpenTodos(
        normalizeTodos([{ id: '1', content: 'Done', status: 'completed' }]),
      ),
    ).toBe(false);
  });

  it('needsTodoWriteNudge only after mutations without todo_write', () => {
    expect(
      needsTodoWriteNudge({ didTodoWrite: false, didMutatingWork: true }),
    ).toBe(true);
    expect(
      needsTodoWriteNudge({ didTodoWrite: true, didMutatingWork: true }),
    ).toBe(false);
    expect(
      needsTodoWriteNudge({ didTodoWrite: false, didMutatingWork: false }),
    ).toBe(false);
  });

  it('needsTodoProgressNudge when open items but none in_progress', () => {
    expect(
      needsTodoProgressNudge({
        todos: sample,
        didTodoWrite: true,
        didMutatingWork: true,
      }),
    ).toBe(true);
    const withProgress = normalizeTodos([
      { id: '1', content: 'A', status: 'completed' },
      { id: '2', content: 'B', status: 'in_progress' },
    ]);
    expect(
      needsTodoProgressNudge({
        todos: withProgress,
        didTodoWrite: true,
        didMutatingWork: true,
      }),
    ).toBe(false);
  });

  it('nudge prompts are actionable', () => {
    expect(buildTodoWriteNudgePrompt()).toMatch(/todo_write/);
    expect(buildTodoProgressNudgePrompt(sample)).toMatch(/in_progress/);
    expect(buildTodoProgressNudgePrompt(sample)).toContain('Add lint');
  });
});

describe('prompt todo injection', () => {
  it('buildUserTurn embeds checklist when todos provided', () => {
    const text = buildUserTurn({
      prompt: 'create a todo app',
      todos: normalizeTodos([
        { id: 'a', content: 'Init vite', status: 'in_progress' },
      ]),
    });
    expect(text).toContain('# Task checklist (current)');
    expect(text).toContain('[in_progress] a: Init vite');
  });

  it('buildFollowUpTurn embeds checklist', () => {
    const text = buildFollowUpTurn(
      'keep going',
      normalizeTodos([{ id: 'a', content: 'Finish lint', status: 'pending' }]),
    );
    expect(text).toContain('# Follow-up');
    expect(text).toContain('[pending] a: Finish lint');
  });
});
