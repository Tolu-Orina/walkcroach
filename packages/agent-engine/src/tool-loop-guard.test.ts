import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDENTICAL_FAILURE_LIMIT,
  afterToolResult,
  beforeToolCall,
  emptyToolLoopGuard,
  fingerprintToolCall,
} from './tool-loop-guard.js';

describe('tool-loop-guard', () => {
  it('fingerprints run_terminal by normalized cmd + cwd', () => {
    const a = fingerprintToolCall('run_terminal', {
      cmd: '  npm   init  vite@latest  ',
      cwd: '/tmp',
    });
    const b = fingerprintToolCall('run_terminal', {
      cmd: 'npm init vite@latest',
      cwd: '/tmp',
    });
    expect(a).toBe(b);
  });

  it('refuses after N identical failures', () => {
    let state = emptyToolLoopGuard();
    const input = { cmd: 'npm init vite@latest .' };
    for (let i = 0; i < DEFAULT_IDENTICAL_FAILURE_LIMIT; i++) {
      const gate = beforeToolCall(state, 'run_terminal', input);
      expect(gate.action).toBe('allow');
      state = afterToolResult(state, 'run_terminal', input, 'error');
    }
    expect(state.streak).toBe(DEFAULT_IDENTICAL_FAILURE_LIMIT);
    const refused = beforeToolCall(state, 'run_terminal', input);
    expect(refused.action).toBe('refuse');
  });

  it('resets streak on success', () => {
    let state = emptyToolLoopGuard();
    const input = { cmd: 'false' };
    state = afterToolResult(state, 'run_terminal', input, 'error');
    state = afterToolResult(state, 'run_terminal', input, 'error');
    state = afterToolResult(state, 'run_terminal', input, 'success');
    expect(state).toEqual(emptyToolLoopGuard());
  });

  it('resets streak when command changes', () => {
    let state = emptyToolLoopGuard();
    state = afterToolResult(
      state,
      'run_terminal',
      { cmd: 'npm init vite@latest' },
      'error',
    );
    state = afterToolResult(
      state,
      'run_terminal',
      { cmd: 'npm create vite@latest todo-app -- --template react-ts' },
      'error',
    );
    expect(state.streak).toBe(1);
  });

  it('shares edit_file / apply_patch fingerprints and refuses after one failure', () => {
    const editInput = {
      path: 'a.css',
      old_str: 'color: red;',
      new_str: 'color: blue;',
    };
    const patchInput = {
      path: 'a.css',
      edits: [{ old_str: 'color: red;', new_str: 'color: blue;' }],
    };
    expect(fingerprintToolCall('edit_file', editInput)).toBe(
      fingerprintToolCall('apply_patch', patchInput),
    );
    let state = emptyToolLoopGuard();
    state = afterToolResult(state, 'edit_file', editInput, 'error');
    expect(state.streak).toBe(1);
    const refused = beforeToolCall(state, 'apply_patch', patchInput, 1);
    expect(refused.action).toBe('refuse');
  });

  it('soft-normalizes whitespace and path so near-miss edits share a fingerprint', () => {
    const a = fingerprintToolCall('edit_file', {
      path: 'blog\\SiteChrome.tsx',
      old_str: '  return (\n    <footer />\n  );',
      new_str: 'x',
    });
    const b = fingerprintToolCall('apply_patch', {
      path: 'blog/SiteChrome.tsx',
      edits: [
        {
          old_str: 'return (\n<footer />\n);',
          new_str: 'x',
        },
      ],
    });
    expect(a).toBe(b);
  });
});
