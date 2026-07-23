import { describe, expect, it } from 'vitest';
import { normalizeTodos, formatTodosForModel } from './todos.js';
import {
  trimSessionMessages,
  appendUserFollowUp,
} from './session.js';
import type { Message } from '@aws-sdk/client-bedrock-runtime';

describe('normalizeTodos', () => {
  it('accepts a valid checklist', () => {
    const todos = normalizeTodos([
      { id: '1', content: 'Scaffold app', status: 'completed' },
      { id: '2', content: 'Install deps', status: 'in_progress' },
    ]);
    expect(todos).toHaveLength(2);
    expect(formatTodosForModel(todos)).toContain('in_progress');
  });

  it('rejects multiple in_progress', () => {
    expect(() =>
      normalizeTodos([
        { id: '1', content: 'A', status: 'in_progress' },
        { id: '2', content: 'B', status: 'in_progress' },
      ]),
    ).toThrow(/At most one/);
  });
});

describe('trimSessionMessages', () => {
  it('keeps first + recent when over max', () => {
    const msgs: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ text: `m${i}` }],
    }));
    const trimmed = trimSessionMessages(msgs, 4);
    expect(trimmed.length).toBeLessThanOrEqual(5);
    expect(trimmed[0]?.content?.[0]).toEqual({ text: 'm0' });
  });

  it('does not orphan a tool-result from its assistant toolUse', () => {
    const msgs: Message[] = [
      { role: 'user', content: [{ text: 'task' }] },
      {
        role: 'assistant',
        content: [{ toolUse: { toolUseId: '1', name: 'x', input: {} } }],
      },
      {
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: '1',
              content: [{ text: 'ok' }],
              status: 'success',
            },
          },
        ],
      },
      { role: 'assistant', content: [{ text: 'done' }] },
    ];
    const trimmed = trimSessionMessages(msgs, 2);
    const toolIdx = trimmed.findIndex((m) =>
      m.content?.some((b) => b && typeof b === 'object' && 'toolResult' in b),
    );
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(trimmed[toolIdx - 1]?.role).toBe('assistant');
  });
});

describe('appendUserFollowUp', () => {
  it('merges into trailing user tool-result turn', () => {
    const prior: Message[] = [
      { role: 'user', content: [{ text: 'hi' }] },
      { role: 'assistant', content: [{ text: 'ok' }] },
      {
        role: 'user',
        content: [
          {
            toolResult: {
              toolUseId: '1',
              content: [{ text: 'r' }],
              status: 'success',
            },
          },
        ],
      },
    ];
    const next = appendUserFollowUp(prior, 'Continue please');
    expect(next).toHaveLength(3);
    expect(next[2]?.role).toBe('user');
    expect(next[2]?.content?.length).toBe(2);
  });
});
