/**
 * P3 — Pre-Act plan gate for large / risky tasks.
 *
 * Complements looksLikePlanningTask (explicit plan wording) with a risk/size
 * classifier that forces plan-then-execute before Act when dual validation is on.
 */

import { isTrivialTask } from './phase-graph.js';
import { looksLikePlanningTask } from './planner.js';

/**
 * Multi-file / architectural / migration-scale work that should not jump
 * straight into mutating Act without an approved plan.
 */
export function looksLikeRiskyOrLargeTask(prompt: string): boolean {
  const p = prompt.trim();
  if (!p) return false;

  // Two or more distinct file-path mentions → multi-file (before trivial bail).
  const fileHits = p.match(
    /\b[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|md|json|yml|yaml)\b/gi,
  );
  if (fileHits && new Set(fileHits.map((f) => f.toLowerCase())).size >= 2) {
    return true;
  }

  if (isTrivialTask(p)) return false;

  // Long prompts are usually multi-step specs.
  if (p.length >= 600) return true;

  if (
    /\b(refactor|redesign|re[- ]?architect|migrate|migration|overhaul|rewrite)\b/i.test(
      p,
    )
  ) {
    return true;
  }
  if (
    /\b(multi[- ]?file|across (the )?(codebase|repo|project)|entire (module|package|service)|system[- ]wide)\b/i.test(
      p,
    )
  ) {
    return true;
  }
  if (
    /\b(architecture|architect(ure)? (change|decision|review)|breaking change|api redesign)\b/i.test(
      p,
    )
  ) {
    return true;
  }
  if (
    /\b(auth(entication|orization)?|billing|payments?|migration|schema change|database)\b/i.test(
      p,
    ) &&
    /\b(add|implement|introduce|replace|remove|overhaul)\b/i.test(p)
  ) {
    return true;
  }

  return false;
}

export type ForcePlanOpts = {
  prompt: string;
  /** Already have an approved plan — never re-enter Planner. */
  approvedPlan?: string | null;
  /**
   * Dual-validation Pre-Act gate. Default true when caller enables it
   * (IDE: walkcroach.ide.forcePlanOnRisk).
   */
  forcePlanOnRisk?: boolean;
  /**
   * Existing planning-intent heuristic (looksLikePlanningTask).
   * When false, only the risk gate may force plan.
   */
  plannerFirstOnIntent?: boolean;
  /** Ask / sticky plan mode already routes elsewhere. */
  readOnly?: boolean;
  /** Nested subagents must not re-plan. */
  depth?: number;
};

/**
 * Whether runAgentLoop should call runPlanThenExecute before runFullLoop.
 */
export function shouldForcePlanThenExecute(opts: ForcePlanOpts): boolean {
  if (opts.approvedPlan?.trim()) return false;
  if (opts.readOnly) return false;
  if ((opts.depth ?? 0) > 0) return false;

  const plannerFirst = opts.plannerFirstOnIntent ?? true;
  if (plannerFirst && looksLikePlanningTask(opts.prompt)) return true;

  // Risk gate — only when enabled (loop defaults ON; pass false to disable).
  if (opts.forcePlanOnRisk === true && looksLikeRiskyOrLargeTask(opts.prompt)) {
    return true;
  }
  return false;
}
