import { describe, expect, it } from 'vitest';
import {
  HARNESS_PAUSE_TO_INTERRUPT,
  createAskUserInterrupt,
} from './interrupt.js';

describe('interrupt contract (Pre-P6)', () => {
  it('maps harness pause states to interrupt kinds', () => {
    expect(HARNESS_PAUSE_TO_INTERRUPT.awaiting_tool).toBe('tool_result');
    expect(HARNESS_PAUSE_TO_INTERRUPT.awaiting_plan_approval).toBe(
      'plan_decision',
    );
  });

  it('builds an ask_user interrupt with id and payload', () => {
    const interrupt = createAskUserInterrupt({
      question: 'Which layout?',
      options: ['grid', 'list'],
      id: 'fixed-id',
      createdAt: '2026-08-07T00:00:00.000Z',
    });
    expect(interrupt).toEqual({
      id: 'fixed-id',
      kind: 'ask_user',
      payload: { question: 'Which layout?', options: ['grid', 'list'] },
      createdAt: '2026-08-07T00:00:00.000Z',
    });
  });

  it('assigns an id when omitted', () => {
    const interrupt = createAskUserInterrupt({ question: 'Continue?' });
    expect(interrupt.id.length).toBeGreaterThan(8);
    expect(interrupt.kind).toBe('ask_user');
  });
});
