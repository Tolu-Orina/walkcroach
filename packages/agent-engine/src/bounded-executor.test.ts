import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRASH_THRESHOLD,
  afterBoundedToolResult,
  armThrashOneShot,
  beforeBoundedToolCall,
  breakThrashLoop,
  emptyBoundedExecutorState,
  recordThrashExecution,
  resolveBoundedExecutorConfig,
} from './bounded-executor.js';
import {
  assertFreshForWrite,
  createReadFreshnessTracker,
  recordReadFreshness,
} from './read-freshness.js';
import { executeTool } from './tools/execute.js';
import { createFakeHost } from './fake-host.js';

describe('bounded-executor thrash (Phase 1)', () => {
  const input = { cmd: 'npm test' };

  it('allows the first threshold-1 identical calls', () => {
    let state = emptyBoundedExecutorState(resolveBoundedExecutorConfig());
    for (let i = 0; i < DEFAULT_THRASH_THRESHOLD - 1; i++) {
      const d = beforeBoundedToolCall(state, 'run_terminal', input);
      expect(d.action).toBe('allow');
      if (d.action === 'allow') {
        state = recordThrashExecution(d.state, d.fingerprint);
      }
    }
  });

  it('warn_skips on the threshold-th identical call (any status path)', () => {
    let state = emptyBoundedExecutorState(resolveBoundedExecutorConfig());
    for (let i = 0; i < DEFAULT_THRASH_THRESHOLD - 1; i++) {
      const d = beforeBoundedToolCall(state, 'run_terminal', input);
      expect(d.action).toBe('allow');
      if (d.action === 'allow') {
        state = recordThrashExecution(d.state, d.fingerprint);
      }
    }
    const warn = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(warn.action).toBe('warn_skip');
    if (warn.action === 'warn_skip') {
      state = warn.state;
      expect(state.warned.has(warn.fingerprint)).toBe(true);
    }
  });

  it('escalates after warn_skip on the next identical call', () => {
    let state = emptyBoundedExecutorState(resolveBoundedExecutorConfig());
    for (let i = 0; i < DEFAULT_THRASH_THRESHOLD - 1; i++) {
      const d = beforeBoundedToolCall(state, 'run_terminal', input);
      if (d.action === 'allow') {
        state = recordThrashExecution(d.state, d.fingerprint);
      }
    }
    const warn = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(warn.action).toBe('warn_skip');
    if (warn.action !== 'warn_skip') return;
    state = warn.state;

    const esc = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(esc.action).toBe('escalate');
  });

  it('one-shot Allow executes once then re-arms detection', () => {
    let state = emptyBoundedExecutorState(resolveBoundedExecutorConfig());
    for (let i = 0; i < DEFAULT_THRASH_THRESHOLD - 1; i++) {
      const d = beforeBoundedToolCall(state, 'run_terminal', input);
      if (d.action === 'allow') {
        state = recordThrashExecution(d.state, d.fingerprint);
      }
    }
    const warn = beforeBoundedToolCall(state, 'run_terminal', input);
    if (warn.action !== 'warn_skip') throw new Error('expected warn');
    state = warn.state;
    const esc = beforeBoundedToolCall(state, 'run_terminal', input);
    if (esc.action !== 'escalate') throw new Error('expected escalate');
    state = armThrashOneShot(esc.state, esc.fingerprint);
    const allowed = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(allowed.action).toBe('allow');
    if (allowed.action !== 'allow') return;
    state = recordThrashExecution(allowed.state, allowed.fingerprint);
    // Next identical should escalate or warn again (window still hot)
    const again = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(again.action === 'warn_skip' || again.action === 'escalate').toBe(
      true,
    );
  });

  it('Break clears warned and records the attempt', () => {
    let state = emptyBoundedExecutorState(resolveBoundedExecutorConfig());
    const d = beforeBoundedToolCall(state, 'read_file', { path: '/a' });
    if (d.action !== 'allow') throw new Error('allow');
    state = breakThrashLoop(d.state, d.fingerprint);
    expect(state.window.length).toBe(1);
    expect(state.warned.has(d.fingerprint)).toBe(false);
  });
});

describe('bounded-executor nudge budget', () => {
  it('exhausts after nudgeBudget consecutive failures (different fingerprints)', () => {
    let state = emptyBoundedExecutorState(
      resolveBoundedExecutorConfig({ nudgeBudget: 3 }),
    );
    for (let i = 0; i < 3; i++) {
      const r = afterBoundedToolResult(state, {
        toolName: 'run_terminal',
        status: 'error',
        content: `ENOENT missing-${i}`,
      });
      state = r.state;
      if (i < 2) {
        expect(r.budgetExhausted).toBe(false);
        expect(r.recoveryHint).toBeTruthy();
      } else {
        expect(r.budgetExhausted).toBe(true);
      }
    }
    expect(state.consecutiveFailures).toBe(3);
  });

  it('resets streak on success', () => {
    let state = emptyBoundedExecutorState(resolveBoundedExecutorConfig());
    state = afterBoundedToolResult(state, {
      toolName: 'run_terminal',
      status: 'error',
      content: 'fail',
    }).state;
    state = afterBoundedToolResult(state, {
      toolName: 'run_terminal',
      status: 'success',
      content: 'ok',
    }).state;
    expect(state.consecutiveFailures).toBe(0);
  });
});

describe('read-freshness (Phase 1)', () => {
  it('allows write when never read', () => {
    const t = createReadFreshnessTracker();
    expect(assertFreshForWrite(t, '/a.ts', 1000).ok).toBe(true);
  });

  it('rejects when mtime moved past last read + tolerance', () => {
    const t = createReadFreshnessTracker(50);
    recordReadFreshness(t, '/a.ts', 1000);
    const check = assertFreshForWrite(t, '/a.ts', 2000);
    expect(check.ok).toBe(false);
  });

  it('allows within tolerance', () => {
    const t = createReadFreshnessTracker(50);
    recordReadFreshness(t, '/a.ts', 1000);
    expect(assertFreshForWrite(t, '/a.ts', 1040).ok).toBe(true);
  });
});

describe('stale-read via executeTool + capability gate', () => {
  it('still gates on content hash when host has no mtime capability', async () => {
    const host = createFakeHost({
      autoApprove: true,
      files: { '/workspace/a.ts': 'one' },
    });
    const tracker = createReadFreshnessTracker();
    await executeTool({
      host,
      tool: {
        toolUseId: 'r1',
        name: 'read_file',
        input: { path: '/workspace/a.ts' },
      },
      readFreshness: tracker,
    });
    host.files.set('/workspace/a.ts', 'external');
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'w1',
        name: 'write_file',
        input: { path: '/workspace/a.ts', content: 'two' },
      },
      readFreshness: tracker,
    });
    expect(result.status).toBe('error');
    expect(result.content).toMatch(/\[stale_read\]/);
  });

  it('rejects content-changed write when host supports mtime freshness', async () => {
    const host = createFakeHost({
      autoApprove: true,
      files: { '/workspace/a.ts': 'one' },
    });
    let mtime = 1000;
    host.supportsMtimeFreshness = true;
    host.getFileMtimeMs = async () => mtime;

    const tracker = createReadFreshnessTracker(50);
    await executeTool({
      host,
      tool: {
        toolUseId: 'r1',
        name: 'read_file',
        input: { path: '/workspace/a.ts' },
      },
      readFreshness: tracker,
    });
    host.files.set('/workspace/a.ts', 'external');
    mtime = 5000;
    const result = await executeTool({
      host,
      tool: {
        toolUseId: 'w1',
        name: 'write_file',
        input: { path: '/workspace/a.ts', content: 'two' },
      },
      readFreshness: tracker,
    });
    expect(result.status).toBe('error');
    expect(result.content).toMatch(/\[stale_read\]/);
    expect(result.content).toMatch(/external/);
  });
});
