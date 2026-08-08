/**
 * Phase 8 fitness — agent-engine quality scenarios (§0.1 #1 thrash, #2 plan isolation).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRASH_THRESHOLD,
  beforeBoundedToolCall,
  emptyBoundedExecutorState,
  recordThrashExecution,
  resolveBoundedExecutorConfig,
} from '../bounded-executor.js';
import {
  PLANNER_FORBIDDEN_TOOLS,
  PLANNER_TOOL_ALLOWLIST,
  assertPlannerSchemaHasNoWriteTools,
  isPlannerToolName,
} from '../planner.js';

describe('Phase 8 fitness — engine scenarios', () => {
  it('§0.1 #1 thrash: identical fingerprint warns then escalates (hard stop path)', () => {
    let state = emptyBoundedExecutorState(resolveBoundedExecutorConfig());
    const input = { cmd: 'npm test' };

    for (let i = 0; i < DEFAULT_THRASH_THRESHOLD - 1; i++) {
      const d = beforeBoundedToolCall(state, 'run_terminal', input);
      expect(d.action).toBe('allow');
      if (d.action === 'allow') {
        state = recordThrashExecution(d.state, d.fingerprint);
      }
    }

    const warn = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(warn.action).toBe('warn_skip');
    if (warn.action === 'warn_skip') state = warn.state;

    const esc = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(esc.action).toBe('escalate');
  });

  it('§0.1 #2 plan isolation: write/shell tools absent from Planner schema', () => {
    for (const denied of PLANNER_FORBIDDEN_TOOLS) {
      expect(isPlannerToolName(denied)).toBe(false);
    }
    expect(() =>
      assertPlannerSchemaHasNoWriteTools([...PLANNER_TOOL_ALLOWLIST]),
    ).not.toThrow();
    expect(() =>
      assertPlannerSchemaHasNoWriteTools([
        ...PLANNER_TOOL_ALLOWLIST,
        'write_file',
      ]),
    ).toThrow(/write_file/);
  });
});
