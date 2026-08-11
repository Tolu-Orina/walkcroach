/**
 * P0/P1 — Phase graph for agent-engine.
 *
 * Soft gather/act/verify emissions become a real FSM when enabled:
 * schema-level tool remask + phase-local prompts at phase boundaries.
 * Remask only between turns (never mid-assistant message).
 */

import { toBedrockTools, type ToolDef } from './tools/defs.js';
import type { ActionBias } from './prompt.js';

/** Host/protocol phase names (unchanged). */
export type AgentPhase = 'gather' | 'act' | 'verify';

/** Max Gather tool-turns before forced Act (P1). */
export const DEFAULT_MAX_GATHER_TURNS = 6;

/** Gather exits early once this many exploratory reads/searches succeed. */
export const DEFAULT_GATHER_READ_THRESHOLD = 3;

/** Core Gather tools — read-only exploration + progressive disclosure. */
export const GATHER_TOOL_ALLOWLIST = [
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'load_skill',
  'load_rule',
  'ask_user',
  'recall_project_memory',
] as const;

/**
 * Act tools — edits + shell + verify + RO re-reads.
 * Optional MCP / memory / worktree added via {@link resolvePhaseAllowlist}.
 */
export const ACT_TOOL_CORE = [
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'write_file',
  'edit_file',
  'apply_patch',
  'run_terminal',
  'await_terminal',
  'verify',
  'todo_write',
  'ask_user',
  'load_skill',
  'load_rule',
  'present_plan',
] as const;

/** Verify tools — ground-truth checks; no file writers. */
export const VERIFY_TOOL_ALLOWLIST = [
  'verify',
  'read_file',
  'list_dir',
  'search',
  'glob',
  'run_terminal',
  'await_terminal',
  'ask_user',
  'load_skill',
  'todo_write',
] as const;

export const PHASE_WRITE_TOOLS = new Set([
  'write_file',
  'edit_file',
  'apply_patch',
  'update_walkcroach_md',
  'enter_worktree',
  'exit_worktree',
  'mirror_project_memory',
  'mirror_skill',
]);

export type PhaseRemaskOpts = {
  phase: AgentPhase;
  includeSubagents?: boolean;
  includePhaseB?: boolean;
  includePhaseC?: boolean;
  includeSharedSkills?: boolean;
  /** Include terminal_session / worktree / update_walkcroach_md on Act. */
  includeExtendedAct?: boolean;
};

/**
 * Resolve the schema allowlist for a phase.
 * Order is stable for Bedrock cache friendliness within a phase.
 */
export function resolvePhaseAllowlist(opts: PhaseRemaskOpts): string[] {
  const {
    phase,
    includeSubagents = true,
    includePhaseB = false,
    includePhaseC = false,
    includeSharedSkills = false,
    includeExtendedAct = true,
  } = opts;

  if (phase === 'gather') {
    const list = [...GATHER_TOOL_ALLOWLIST];
    if (!includePhaseC) {
      return list.filter((n) => n !== 'recall_project_memory');
    }
    return list;
  }

  if (phase === 'verify') {
    return [...VERIFY_TOOL_ALLOWLIST];
  }

  // act
  const list: string[] = [...ACT_TOOL_CORE];
  if (includeExtendedAct) {
    list.push(
      'terminal_session',
      'enter_worktree',
      'exit_worktree',
      'update_walkcroach_md',
    );
  }
  if (includeSubagents) list.push('spawn_subagent');
  if (includePhaseB) {
    list.push('cockroach_mcp', 'mcp_call', 'ccloud');
  }
  if (includePhaseC) {
    list.push('recall_project_memory', 'mirror_project_memory');
  }
  if (includeSharedSkills) list.push('mirror_skill');
  return list;
}

export type BedrockTools =
  import('@aws-sdk/client-bedrock-runtime').ToolConfiguration['tools'];

/** Schema-level remask for the current phase. */
export function remaskToolsForPhase(opts: PhaseRemaskOpts): BedrockTools {
  const allowlist = resolvePhaseAllowlist(opts);
  return toBedrockTools({ allowlist }) as BedrockTools;
}

/** Invariant helpers for tests / fitness. */
export function phaseAllowsWriteTools(phase: AgentPhase): boolean {
  return phase === 'act';
}

export function assertPhaseAllowlistInvariants(phase: AgentPhase, names: string[]): void {
  const set = new Set(names);
  if (phase === 'gather' || phase === 'verify') {
    for (const w of PHASE_WRITE_TOOLS) {
      if (set.has(w)) {
        throw new Error(
          `phase_graph invariant: ${phase} must not offer write tool ${w}`,
        );
      }
    }
  }
  if (phase === 'verify' && set.has('write_file')) {
    throw new Error('phase_graph invariant: verify must not offer write_file');
  }
  if (phase === 'gather' && !set.has('read_file')) {
    throw new Error('phase_graph invariant: gather must offer read_file');
  }
}

/**
 * Whether the phase graph should drive this run.
 * Default ON when unset (IDE / CLI / sdk-host / Desktop parity).
 * Pass phaseGraphEnabled: false to restore the flat full tool menu.
 * Always off for Planner allowlist runs, sticky readOnly, and nested depth.
 */
export function shouldEnablePhaseGraph(params: {
  phaseGraphEnabled?: boolean;
  depth?: number;
  readOnly?: boolean;
  plannerMode?: boolean;
  toolAllowlist?: readonly string[];
}): boolean {
  if (params.phaseGraphEnabled === false) return false;
  if ((params.depth ?? 0) > 0) return false;
  if (params.readOnly) return false;
  if (params.plannerMode) return false;
  if (params.toolAllowlist?.length) return false;
  return true;
}

/** Short / surgical tasks skip Gather and start in Act. */
export function isTrivialTask(prompt: string): boolean {
  const p = prompt.trim();
  if (!p || p.length > 280) return false;
  if (
    /\b(typo|one-liner|one liner|rename this|bump version|changelog entry)\b/i.test(
      p,
    )
  ) {
    return true;
  }
  if (
    /\b(fix|change|update|correct)\b[\s\S]{0,48}\b(typo|comment|import|label|string)\b/i.test(
      p,
    )
  ) {
    return true;
  }
  // Explicit single-file hint with a short prompt.
  if (p.length <= 160 && /\b[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|md)\b/i.test(p)) {
    if (/\b(refactor|architect|redesign|migrate|multi[- ]?file)\b/i.test(p)) {
      return false;
    }
    return /\b(fix|add|update|change|edit)\b/i.test(p);
  }
  return false;
}

export type ClassifyStartPhaseOpts = {
  prompt: string;
  actionBias?: ActionBias;
  /** Approved plan already injected — skip Gather. */
  hasApprovedPlan?: boolean;
};

/**
 * Choose the initial phase when the graph is active.
 * Trivial / plan-approved → Act; otherwise Gather.
 */
export function classifyStartPhase(opts: ClassifyStartPhaseOpts): AgentPhase {
  if (opts.hasApprovedPlan) return 'act';
  if (isTrivialTask(opts.prompt)) return 'act';
  // Non-trivial tasks gather first (even when actionBias is always).
  void opts.actionBias;
  return 'gather';
}

export type GatherProgress = {
  toolTurns: number;
  exploratoryHits: number;
};

const EXPLORATORY_TOOLS = new Set([
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'load_skill',
  'load_rule',
]);

export function recordGatherTools(
  state: GatherProgress,
  toolNames: string[],
): GatherProgress {
  let hits = state.exploratoryHits;
  for (const n of toolNames) {
    if (EXPLORATORY_TOOLS.has(n)) hits += 1;
  }
  return {
    toolTurns: state.toolTurns + 1,
    exploratoryHits: hits,
  };
}

/**
 * Whether Gather should transition to Act.
 * Prefer enough exploration; force on budget.
 */
export function shouldExitGather(
  state: GatherProgress,
  opts?: {
    maxGatherTurns?: number;
    readThreshold?: number;
    /** Model ended turn with no tools. */
    endTurn?: boolean;
  },
): boolean {
  const maxTurns = opts?.maxGatherTurns ?? DEFAULT_MAX_GATHER_TURNS;
  const threshold = opts?.readThreshold ?? DEFAULT_GATHER_READ_THRESHOLD;
  if (state.toolTurns >= maxTurns) return true;
  if (state.exploratoryHits >= threshold) return true;
  // End turn after at least one exploratory hit → move to Act.
  if (opts?.endTurn && state.exploratoryHits >= 1) return true;
  // End turn with no exploration yet — still advance so Act nudge can fire.
  if (opts?.endTurn && state.toolTurns >= 1) return true;
  if (opts?.endTurn && state.toolTurns === 0 && state.exploratoryHits === 0) {
    // First response was text-only: advance so action tasks can mutate.
    return true;
  }
  return false;
}

/** Re-export ToolDef for tests. */
export type { ToolDef };
