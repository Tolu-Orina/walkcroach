/**
 * P3.3 — worktree isolation policy + non-git collision modes.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKTREE_POLICY,
  FLEET_ISOLATION_POLICY,
  planFirstWriteIsolation,
  resolveWorktreePolicy,
} from './worktree-policy.js';

describe('worktree isolation policy (P3.3)', () => {
  it('defaults to none / workspace_root (no surprise isolation)', () => {
    expect(resolveWorktreePolicy()).toEqual(DEFAULT_WORKTREE_POLICY);
    expect(
      planFirstWriteIsolation({
        policy: DEFAULT_WORKTREE_POLICY,
        isGitRepo: true,
        sessionId: 's1',
        alreadyIsolated: false,
      }).action,
    ).toBe('noop');
  });

  it('fleet policy enters worktree on first write when git', () => {
    const plan = planFirstWriteIsolation({
      policy: FLEET_ISOLATION_POLICY,
      isGitRepo: true,
      sessionId: 'abc-123',
      alreadyIsolated: false,
    });
    expect(plan.action).toBe('enter_worktree');
    if (plan.action === 'enter_worktree') {
      expect(plan.branchName).toMatch(/^fleet\//);
    }
  });

  it('fleet refuse collision when not a git repo', () => {
    const plan = planFirstWriteIsolation({
      policy: FLEET_ISOLATION_POLICY,
      isGitRepo: false,
      sessionId: 'abc',
      alreadyIsolated: false,
    });
    expect(plan).toMatchObject({ action: 'refuse' });
  });

  it('sidecar collision for lazy_worktree on non-git', () => {
    const plan = planFirstWriteIsolation({
      policy: resolveWorktreePolicy({
        mode: 'lazy_worktree',
        collisionMode: 'sidecar_dir',
      }),
      isGitRepo: false,
      sessionId: 'sess',
      alreadyIsolated: false,
    });
    expect(plan.action).toBe('sidecar');
    if (plan.action === 'sidecar') {
      expect(plan.relativeDir).toContain('.walkcroach/isolated/');
    }
  });

  it('noop when already isolated', () => {
    const plan = planFirstWriteIsolation({
      policy: FLEET_ISOLATION_POLICY,
      isGitRepo: true,
      sessionId: 'x',
      alreadyIsolated: true,
    });
    expect(plan.action).toBe('noop');
  });
});
