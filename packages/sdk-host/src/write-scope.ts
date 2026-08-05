/**
 * What a run is permitted to change in the workspace.
 *
 * This is a **required** argument with no default, and that is the point. A
 * blog-publishing run against a customer's production website has an
 * expectation the App Builder does not: *touch nothing that already exists*. A
 * PR that adds one page is reviewable in a minute. The same PR with an
 * "improvement" to a shared `Button` component in it is a different
 * conversation, and not one a marketing hire uploading a Word document ever
 * agreed to start.
 *
 * A default of `additive` would be safe but silent — callers would inherit a
 * constraint they never reasoned about, and be surprised when a legitimate
 * refactor was refused. A default of `full` would be dangerous for exactly the
 * case above. Neither is acceptable, so there is no default.
 *
 * The agent can always edit files **it created during this run**, in every mode.
 * Without that, additive mode would break normal iteration: write a component,
 * run the type-checker, fix the error it just introduced.
 */

export type WriteScope =
  /**
   * Create new files only. Never modify or delete anything that existed when
   * the run started. The right mode for publishing into someone else's repo.
   */
  | { mode: 'additive' }
  /**
   * Create anything; modify or delete only under `allow`. For a run that owns a
   * directory (say `src/content/blog`) but must not reach outside it.
   */
  | { mode: 'scoped'; allow: string[] }
  /** No restriction. The App Builder mode, where the agent owns the workspace. */
  | { mode: 'full' };

export type ScopeDecision =
  | { allow: true }
  | { allow: false; reason: string; rule: string };

function underAnyPrefix(path: string, prefixes: string[]): boolean {
  const p = path.replace(/^\/+/, '');
  return prefixes.some((raw) => {
    const prefix = raw.replace(/^\/+|\/+$/g, '');
    // Exact file, or anything beneath the directory. Guards against a prefix
    // like `src/content` matching `src/content-archive/x.tsx`.
    return p === prefix || p.startsWith(`${prefix}/`);
  });
}

/**
 * Decide whether a run may write to `path`.
 *
 * `preExisting` is whether the file was present before the run started;
 * `createdInRun` is whether this run created it.
 */
export function evaluateWrite(params: {
  scope: WriteScope;
  path: string;
  preExisting: boolean;
  createdInRun: boolean;
}): ScopeDecision {
  const { scope, path, preExisting, createdInRun } = params;

  // Always allowed: iterating on your own output is not a mutation of theirs.
  if (createdInRun) return { allow: true };
  if (!preExisting) return { allow: true };

  switch (scope.mode) {
    case 'full':
      return { allow: true };

    case 'scoped':
      if (underAnyPrefix(path, scope.allow)) return { allow: true };
      return {
        allow: false,
        rule: 'write-scope',
        reason:
          `refused (write-scope): ${path} already exists and is outside the writable paths ` +
          `for this run (${scope.allow.join(', ')}). Create a new file instead, or widen the scope.`,
      };

    case 'additive':
      return {
        allow: false,
        rule: 'write-scope',
        reason:
          `refused (write-scope): ${path} already exists and this run is additive — it may ` +
          `create new files but must not modify the existing repository. Create a new file instead.`,
      };
  }
}

export function evaluateDelete(params: {
  scope: WriteScope;
  path: string;
  createdInRun: boolean;
}): ScopeDecision {
  if (params.createdInRun) return { allow: true };

  if (params.scope.mode === 'full') return { allow: true };
  if (params.scope.mode === 'scoped' && underAnyPrefix(params.path, params.scope.allow)) {
    return { allow: true };
  }
  return {
    allow: false,
    rule: 'write-scope',
    reason:
      `refused (write-scope): ${params.path} was not created by this run and deleting ` +
      `pre-existing files is not permitted in ${params.scope.mode} mode.`,
  };
}

export function describeScope(scope: WriteScope): string {
  switch (scope.mode) {
    case 'additive':
      return 'You may CREATE new files. You must NOT modify or delete any file that already exists in this repository — treat it as read-only. If a change seems to require editing an existing file, create a new file instead and say so in your summary.';
    case 'scoped':
      return `You may create new files anywhere, and modify existing files only under: ${scope.allow.join(', ')}. Everything else in the repository is read-only.`;
    case 'full':
      return 'You may create, modify, and delete files anywhere in the workspace.';
  }
}
