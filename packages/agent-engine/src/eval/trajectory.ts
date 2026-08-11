/**
 * P5 — Trajectory types + pure assertion helpers for phase-graph eval goldens.
 */

import {
  PHASE_WRITE_TOOLS,
  assertPhaseAllowlistInvariants,
  type AgentPhase,
} from '../phase-graph.js';
import type { ScriptedTurn } from './harness.js';

export type TrajectoryTurnAssert = {
  /** Index into parent-loop streamConverseTurn calls (0-based). */
  converseIndex: number;
  phase: AgentPhase;
  toolsMustInclude?: string[];
  toolsMustExclude?: string[];
};

export type TrajectoryMetricsExpect = {
  /** Max parent converse turns (approx turns-to-done). */
  maxTurns?: number;
  /** done.reason must not be unverified when true. */
  verifyPass?: boolean;
};

export type TrajectoryGolden = {
  id: string;
  prompt: string;
  loop: {
    phaseGraphEnabled: true;
    forcePlanOnRisk?: boolean;
    architectureCriticEnabled?: boolean;
    toolRankEnabled?: boolean;
    includePhaseB?: boolean;
    subagentsEnabled?: boolean;
    maxIterations: number;
    actionBias?: 'always' | 'never' | 'auto';
  };
  workspace?: {
    files?: Record<string, string>;
    verifyJson?: { commands: string[]; cwd?: string };
    settingsJson?: Record<string, unknown>;
  };
  script: ScriptedTurn[];
  expect: {
    /** Deduped consecutive phases from host events. */
    phaseSequenceIncludes?: AgentPhase[];
    /** First phase must be this. */
    startPhase?: AgentPhase;
    turns: TrajectoryTurnAssert[];
    doneReason: string;
    filesContain?: Array<{ path: string; includes: string }>;
    metrics?: TrajectoryMetricsExpect;
  };
};

/** Collapse consecutive duplicate phase emissions. */
export function collapsePhaseSequence(
  phases: readonly AgentPhase[],
): AgentPhase[] {
  const out: AgentPhase[] = [];
  for (const p of phases) {
    if (out[out.length - 1] !== p) out.push(p);
  }
  return out;
}

export function extractPhaseEvents(
  events: ReadonlyArray<{ type: string; phase?: string }>,
): AgentPhase[] {
  return events
    .filter((e) => e.type === 'phase' && e.phase)
    .map((e) => e.phase as AgentPhase);
}

export function toolNamesFromConverseArgs(args: unknown): string[] {
  const tools = (args as { tools?: Array<{ toolSpec?: { name?: string } }> })
    ?.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => t.toolSpec?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

export function assertTrajectoryTurn(params: {
  turn: TrajectoryTurnAssert;
  offeredTools: string[];
  actualPhase: AgentPhase | undefined;
}): void {
  const { turn, offeredTools, actualPhase } = params;
  if (actualPhase) {
    if (actualPhase !== turn.phase) {
      throw new Error(
        `trajectory turn ${turn.converseIndex}: expected phase ${turn.phase}, got ${actualPhase}`,
      );
    }
  }
  assertPhaseAllowlistInvariants(turn.phase, offeredTools);

  for (const name of turn.toolsMustInclude ?? []) {
    if (!offeredTools.includes(name)) {
      throw new Error(
        `trajectory turn ${turn.converseIndex}: missing required tool ${name}`,
      );
    }
  }
  for (const name of turn.toolsMustExclude ?? []) {
    if (offeredTools.includes(name)) {
      throw new Error(
        `trajectory turn ${turn.converseIndex}: forbidden tool offered ${name}`,
      );
    }
  }
  if (turn.phase === 'gather' || turn.phase === 'verify') {
    for (const w of PHASE_WRITE_TOOLS) {
      if (offeredTools.includes(w)) {
        throw new Error(
          `trajectory turn ${turn.converseIndex}: ${turn.phase} offered write tool ${w}`,
        );
      }
    }
  }
}

export function assertPhaseSequenceIncludes(
  actual: readonly AgentPhase[],
  expectedIncludes: readonly AgentPhase[],
): void {
  let i = 0;
  for (const want of expectedIncludes) {
    while (i < actual.length && actual[i] !== want) i += 1;
    if (i >= actual.length) {
      throw new Error(
        `phase sequence missing ${want} (got ${actual.join('→') || '(empty)'})`,
      );
    }
    i += 1;
  }
}
