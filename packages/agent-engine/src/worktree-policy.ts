/**
 * Worktree / isolation policy (P3.3).
 *
 * Default for interactive IDE/CLI remains **none** — surprising every session
 * into a worktree would break "edit this file in place" muscle memory.
 * Fleet / Desktop isolate-on-launch opts into `lazy_worktree`.
 *
 * Non-git workspaces cannot use git worktrees; collisionMode decides whether
 * we refuse, write on the workspace root, or use a sidecar directory.
 */
export type IsolationMode = 'none' | 'lazy_worktree' | 'require_git';

/**
 * When the workspace is not a git repo (or worktree creation fails):
 * - refuse — fail closed (content / fleet default when isolation was requested)
 * - workspace_root — fall back to editing the opened folder (interactive default)
 * - sidecar_dir — write under `.walkcroach/isolated/<id>` without git
 */
export type CollisionMode = 'refuse' | 'workspace_root' | 'sidecar_dir';

export type WorktreeIsolationPolicy = {
  mode: IsolationMode;
  collisionMode: CollisionMode;
  /** Branch prefix for lazy worktrees, e.g. `agent/`. */
  branchPrefix: string;
};

export const DEFAULT_WORKTREE_POLICY: WorktreeIsolationPolicy = {
  mode: 'none',
  collisionMode: 'workspace_root',
  branchPrefix: 'agent/',
};

/** Fleet / multi-agent launch with isolate: true. */
export const FLEET_ISOLATION_POLICY: WorktreeIsolationPolicy = {
  mode: 'lazy_worktree',
  collisionMode: 'refuse',
  branchPrefix: 'fleet/',
};

export type IsolationPlan =
  | {
      action: 'noop';
      reason: string;
    }
  | {
      action: 'enter_worktree';
      branchName: string;
      reason: string;
    }
  | {
      action: 'sidecar';
      relativeDir: string;
      reason: string;
    }
  | {
      action: 'refuse';
      reason: string;
    };

export function resolveWorktreePolicy(
  partial?: Partial<WorktreeIsolationPolicy> | null,
): WorktreeIsolationPolicy {
  return {
    ...DEFAULT_WORKTREE_POLICY,
    ...(partial ?? {}),
  };
}

/**
 * Decide what to do on the first mutating write when isolation is enabled.
 * Callers still own performing enter_worktree / setToolRoot.
 */
export function planFirstWriteIsolation(params: {
  policy: WorktreeIsolationPolicy;
  isGitRepo: boolean;
  sessionId: string;
  /** Already isolated (tool root override / active worktree). */
  alreadyIsolated: boolean;
}): IsolationPlan {
  const { policy, isGitRepo, sessionId, alreadyIsolated } = params;
  if (alreadyIsolated || policy.mode === 'none') {
    return { action: 'noop', reason: 'isolation not required' };
  }

  const leaf = sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48) || 'session';
  const branchName = `${policy.branchPrefix}${leaf}`;

  if (isGitRepo && (policy.mode === 'lazy_worktree' || policy.mode === 'require_git')) {
    return {
      action: 'enter_worktree',
      branchName,
      reason: 'lazy worktree on first write',
    };
  }

  if (policy.mode === 'require_git' && !isGitRepo) {
    return {
      action: 'refuse',
      reason: 'isolation requires a git repository (require_git)',
    };
  }

  // lazy_worktree but not a git repo — collision modes
  switch (policy.collisionMode) {
    case 'refuse':
      return {
        action: 'refuse',
        reason:
          'lazy worktree requested but workspace is not a git repository; collisionMode=refuse',
      };
    case 'sidecar_dir':
      return {
        action: 'sidecar',
        relativeDir: `.walkcroach/isolated/${leaf}`,
        reason: 'non-git collision: sidecar directory',
      };
    case 'workspace_root':
    default:
      return {
        action: 'noop',
        reason: 'non-git collision: writing on workspace root',
      };
  }
}
