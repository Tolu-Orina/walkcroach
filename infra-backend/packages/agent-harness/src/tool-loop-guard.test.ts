import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDENTICAL_FAILURE_LIMIT,
  afterToolResult,
  beforeToolCall,
  emptyToolLoopGuard,
  fingerprintToolCall,
} from './tool-loop-guard.js';

describe('tool-loop-guard (harness)', () => {
  it('fingerprints shell commands stably', () => {
    expect(
      fingerprintToolCall('run_terminal', { cmd: 'npm init vite@latest .' }),
    ).toBe(
      fingerprintToolCall('run_terminal', {
        cmd: '  npm  init vite@latest . ',
      }),
    );
  });

  it('blocks the 4th identical failing shell call by default', () => {
    let state = emptyToolLoopGuard();
    const input = { cmd: 'npm init vite@latest .' };
    for (let i = 0; i < DEFAULT_IDENTICAL_FAILURE_LIMIT; i++) {
      expect(beforeToolCall(state, 'run_terminal', input).action).toBe('allow');
      state = afterToolResult(state, 'run_terminal', input, 'error');
    }
    expect(beforeToolCall(state, 'run_terminal', input).action).toBe('refuse');
  });
});
