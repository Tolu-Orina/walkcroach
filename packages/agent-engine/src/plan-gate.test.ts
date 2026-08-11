import { describe, expect, it } from 'vitest';
import {
  looksLikeRiskyOrLargeTask,
  shouldForcePlanThenExecute,
} from './plan-gate.js';

describe('looksLikeRiskyOrLargeTask', () => {
  it('rejects trivial / empty prompts', () => {
    expect(looksLikeRiskyOrLargeTask('')).toBe(false);
    expect(looksLikeRiskyOrLargeTask('fix typo in label')).toBe(false);
    expect(
      looksLikeRiskyOrLargeTask('update the comment in src/a.ts'),
    ).toBe(false);
  });

  it('detects refactor / migrate / multi-file / architecture', () => {
    expect(
      looksLikeRiskyOrLargeTask('Refactor the auth module across the codebase'),
    ).toBe(true);
    expect(
      looksLikeRiskyOrLargeTask('Migrate billing schema to the new API'),
    ).toBe(true);
    expect(
      looksLikeRiskyOrLargeTask(
        'Please redesign the architecture for the session service',
      ),
    ).toBe(true);
    expect(
      looksLikeRiskyOrLargeTask(
        'Update src/a.ts and packages/b/index.ts to share types',
      ),
    ).toBe(true);
  });

  it('treats long prompts as large', () => {
    expect(looksLikeRiskyOrLargeTask('x'.repeat(600))).toBe(true);
  });
});

describe('shouldForcePlanThenExecute', () => {
  it('forces on planning intent even when risk flag is off', () => {
    expect(
      shouldForcePlanThenExecute({
        prompt: 'Write a plan for the checkout flow',
        forcePlanOnRisk: false,
      }),
    ).toBe(true);
  });

  it('forces on risk only when forcePlanOnRisk is true', () => {
    const risky = 'Refactor the auth module across the codebase';
    expect(
      shouldForcePlanThenExecute({
        prompt: risky,
        forcePlanOnRisk: true,
      }),
    ).toBe(true);
    expect(
      shouldForcePlanThenExecute({
        prompt: risky,
        forcePlanOnRisk: false,
      }),
    ).toBe(false);
    expect(
      shouldForcePlanThenExecute({
        prompt: risky,
      }),
    ).toBe(false);
  });

  it('skips when approvedPlan / depth / readOnly', () => {
    expect(
      shouldForcePlanThenExecute({
        prompt: 'Refactor everything',
        forcePlanOnRisk: true,
        approvedPlan: '## Goal\nok',
      }),
    ).toBe(false);
    expect(
      shouldForcePlanThenExecute({
        prompt: 'Refactor everything',
        forcePlanOnRisk: true,
        depth: 1,
      }),
    ).toBe(false);
    expect(
      shouldForcePlanThenExecute({
        prompt: 'plan the work',
        readOnly: true,
      }),
    ).toBe(false);
  });
});
