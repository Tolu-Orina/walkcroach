import { describe, expect, it } from 'vitest';
import {
  beginVerifyToActRetry,
  buildClassifiedVerifyToActPrompt,
  buildDivergentNudge,
  buildGatherReadThrashPrompt,
  classifyPhaseFailure,
  clearGatherReadStreaks,
  emptyPhaseTransitionState,
  readFilePathFromInput,
  recordGatherReadFile,
  recordPhaseFailure,
  DEFAULT_DIVERGENT_STREAK,
  DEFAULT_GATHER_SAME_PATH_READS,
  DEFAULT_MAX_VERIFY_TO_ACT,
} from './failure-taxonomy.js';

describe('classifyPhaseFailure', () => {
  it('maps verify/test stderr to test/build/lint', () => {
    expect(
      classifyPhaseFailure({
        toolName: 'verify',
        status: 'error',
        content: 'vitest: 2 failed',
      }),
    ).toBe('test');
    expect(
      classifyPhaseFailure({
        toolName: 'run_terminal',
        status: 'error',
        content: 'error TS2322: Type fail',
      }),
    ).toBe('build');
    expect(
      classifyPhaseFailure({
        toolName: 'run_terminal',
        status: 'error',
        content: 'eslint found 3 errors',
      }),
    ).toBe('lint');
  });

  it('maps edit mismatch and returns null on success', () => {
    expect(
      classifyPhaseFailure({
        toolName: 'edit_file',
        status: 'error',
        content: '[edit_mismatch] no match',
      }),
    ).toBe('edit_mismatch');
    expect(
      classifyPhaseFailure({
        toolName: 'verify',
        status: 'success',
        content: 'ok',
      }),
    ).toBeNull();
  });
});

describe('recordPhaseFailure / divergent', () => {
  it('sets divergent after DEFAULT_DIVERGENT_STREAK of the same class', () => {
    let state = emptyPhaseTransitionState();
    let r = recordPhaseFailure(state, 'test');
    expect(r.divergent).toBe(false);
    state = r.state;
    r = recordPhaseFailure(state, 'test');
    expect(r.streak).toBe(DEFAULT_DIVERGENT_STREAK);
    expect(r.divergent).toBe(true);
    expect(buildDivergentNudge('test', r.streak)).toMatch(/hypothesis/i);
  });

  it('resets streak when class changes', () => {
    let state = emptyPhaseTransitionState();
    state = recordPhaseFailure(state, 'test').state;
    const r = recordPhaseFailure(state, 'lint');
    expect(r.streak).toBe(1);
    expect(r.divergent).toBe(false);
  });
});

describe('gather read thrash', () => {
  it('forces Act after N reads of the same path', () => {
    let state = emptyPhaseTransitionState();
    for (let i = 1; i < DEFAULT_GATHER_SAME_PATH_READS; i++) {
      const r = recordGatherReadFile(state, 'src/App.tsx');
      state = r.state;
      expect(r.forceAct).toBe(false);
    }
    const forced = recordGatherReadFile(state, './src/App.tsx');
    expect(forced.forceAct).toBe(true);
    expect(forced.count).toBe(DEFAULT_GATHER_SAME_PATH_READS);
    expect(buildGatherReadThrashPrompt(forced.path, forced.count)).toMatch(
      /Read thrash/,
    );
    state = clearGatherReadStreaks(forced.state);
    expect(Object.keys(state.gatherReadByPath)).toHaveLength(0);
  });

  it('readFilePathFromInput extracts path', () => {
    expect(readFilePathFromInput({ path: 'a.ts' })).toBe('a.ts');
    expect(readFilePathFromInput({})).toBeNull();
  });
});

describe('verify→act retry budget', () => {
  it('allows up to DEFAULT_MAX_VERIFY_TO_ACT then caps', () => {
    let state = emptyPhaseTransitionState();
    for (let i = 1; i <= DEFAULT_MAX_VERIFY_TO_ACT; i++) {
      const r = beginVerifyToActRetry(state);
      state = r.state;
      expect(r.allowed).toBe(true);
      expect(r.retries).toBe(i);
    }
    const capped = beginVerifyToActRetry(state);
    expect(capped.allowed).toBe(false);
    expect(capped.retries).toBe(DEFAULT_MAX_VERIFY_TO_ACT + 1);
  });

  it('classified prompt includes class and optional divergent block', () => {
    const text = buildClassifiedVerifyToActPrompt({
      failureClass: 'test',
      divergent: true,
      streak: 2,
      retries: 1,
      maxRetries: 3,
      excerpt: 'AssertionError: expected 1',
    });
    expect(text).toMatch(/Failure class: test/);
    expect(text).toMatch(/divergent/);
    expect(text).toMatch(/AssertionError/);
  });
});
