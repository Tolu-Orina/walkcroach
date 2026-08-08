import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OBSERVE_WINDOW,
  classifyToolError,
  emptyToolCallObserve,
  recordToolCallObservation,
  shortFingerprint,
  summarizeToolCallObserve,
} from './tool-call-observe.js';
import { fingerprintToolCall } from './tool-loop-guard.js';
import { TelemetrySink } from './telemetry.js';
import {
  emitToolCallObservation,
  emitToolCallObserveSummary,
} from './tool-call-observe.js';

describe('classifyToolError', () => {
  it('returns none for success', () => {
    expect(classifyToolError('success', 'ok')).toBe('none');
  });

  it('classifies permission / not_found / timeout / rate_limit', () => {
    expect(classifyToolError('error', 'EACCES: permission denied')).toBe(
      'permission',
    );
    expect(classifyToolError('error', 'ENOENT: no such file')).toBe('not_found');
    expect(classifyToolError('error', 'ETIMEDOUT waiting for process')).toBe(
      'timeout',
    );
    expect(classifyToolError('error', 'Rate limit exceeded (429)')).toBe(
      'rate_limit',
    );
  });

  it('classifies edit_mismatch and syntax', () => {
    expect(
      classifyToolError(
        'error',
        'old_string not found in file',
        'edit_file',
      ),
    ).toBe('edit_mismatch');
    expect(classifyToolError('error', '[stale_read] `a.ts` changed')).toBe(
      'edit_mismatch',
    );
    expect(classifyToolError('error', 'SyntaxError: unexpected token')).toBe(
      'syntax',
    );
  });

  it('defaults edit_file unclassified errors to edit_mismatch', () => {
    expect(classifyToolError('error', 'something went wrong', 'edit_file')).toBe(
      'edit_mismatch',
    );
  });

  it('defaults unknown errors to other', () => {
    expect(classifyToolError('error', 'boom')).toBe('other');
  });
});

describe('recordToolCallObservation (Phase 0 — observe only)', () => {
  it('never refuses — always records and advances window', () => {
    let state = emptyToolCallObserve(5);
    const input = { cmd: 'npm test' };
    for (let i = 0; i < 5; i++) {
      const { state: next, observation } = recordToolCallObservation(state, {
        toolName: 'run_terminal',
        input,
        status: 'error',
        content: 'failed',
      });
      state = next;
      expect(observation.countInWindow).toBe(i + 1);
      // Phase 0 must not block — observation is informational only
      expect(observation.wouldHaltAt['3']).toBe(i + 1 >= 3);
    }
    expect(state.window.length).toBe(5);
    expect(state.totals.wouldHaltHits['3']).toBe(1); // crossed exactly at 3
    expect(state.totals.wouldHaltHits['2']).toBe(1);
    expect(state.totals.maxRepeatSeen).toBe(5);
  });

  it('uses sliding window of DEFAULT_OBSERVE_WINDOW', () => {
    let state = emptyToolCallObserve(DEFAULT_OBSERVE_WINDOW);
    for (let i = 0; i < DEFAULT_OBSERVE_WINDOW + 5; i++) {
      const { state: next } = recordToolCallObservation(state, {
        toolName: 'read_file',
        input: { path: `/f/${i}` },
        status: 'success',
      });
      state = next;
    }
    expect(state.window.length).toBe(DEFAULT_OBSERVE_WINDOW);
    expect(state.totals.calls).toBe(DEFAULT_OBSERVE_WINDOW + 5);
  });

  it('counts any-status repeats (success loops too)', () => {
    let state = emptyToolCallObserve(20);
    const input = { path: '/same.ts' };
    for (let i = 0; i < 3; i++) {
      const { state: next, observation } = recordToolCallObservation(state, {
        toolName: 'read_file',
        input,
        status: 'success',
      });
      state = next;
      expect(observation.errorClass).toBe('none');
      expect(observation.countInWindow).toBe(i + 1);
    }
    expect(state.totals.wouldHaltHits['3']).toBe(1);
    const summary = summarizeToolCallObserve(state);
    expect(summary.open_dev_default_would_fire).toBe(true);
  });

  it('tracks consecutive failure / same-class streaks separately from thrash', () => {
    let state = emptyToolCallObserve();
    const r1 = recordToolCallObservation(state, {
      toolName: 'run_terminal',
      input: { cmd: 'a' },
      status: 'error',
      content: 'ENOENT',
    });
    state = r1.state;
    expect(r1.observation.consecutiveFailures).toBe(1);
    expect(r1.observation.errorClass).toBe('not_found');

    const r2 = recordToolCallObservation(state, {
      toolName: 'run_terminal',
      input: { cmd: 'b' },
      status: 'error',
      content: 'ENOENT missing',
    });
    state = r2.state;
    expect(r2.observation.consecutiveFailures).toBe(2);
    expect(r2.observation.consecutiveSameClass).toBe(2);
    // Different fingerprint — thrash count stays 1
    expect(r2.observation.countInWindow).toBe(1);

    const r3 = recordToolCallObservation(state, {
      toolName: 'run_terminal',
      input: { cmd: 'c' },
      status: 'error',
      content: 'EACCES denied',
    });
    state = r3.state;
    expect(r3.observation.consecutiveFailures).toBe(3);
    expect(r3.observation.consecutiveSameClass).toBe(1);
    expect(r3.observation.errorClass).toBe('permission');
  });

  it('shortFingerprint is stable and short', () => {
    const fp = fingerprintToolCall('run_terminal', { cmd: 'echo hi' });
    expect(shortFingerprint(fp)).toBe(shortFingerprint(fp));
    expect(shortFingerprint(fp).length).toBe(16);
  });
});

describe('telemetry emit (Phase 0)', () => {
  it('emits observe + summary events without throwing', () => {
    const sink = new TelemetrySink();
    let state = emptyToolCallObserve();
    const { state: next, observation } = recordToolCallObservation(state, {
      toolName: 'verify',
      input: { cmd: 'npm test' },
      status: 'error',
      content: 'timed out',
    });
    state = next;
    emitToolCallObservation(sink, observation);
    const summary = emitToolCallObserveSummary(sink, state);
    expect(sink.events.some((e) => e.name === 'walkcroach.tool_call.observe')).toBe(
      true,
    );
    expect(
      sink.events.some((e) => e.name === 'walkcroach.tool_call.observe_summary'),
    ).toBe(true);
    expect(summary.err_timeout).toBe(1);
    expect(summary.phase).toBe(0);
  });
});
