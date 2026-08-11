/**
 * P5 — Phase-graph trajectory eval goldens (remask + verify outcome).
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeHost } from '../fake-host.js';
import {
  ACT_TOOL_RANK_BUDGET,
  assertActToolBudget,
  mergeActAllowlistWithRank,
} from '../tool-rank.js';
import { resolvePhaseAllowlist } from '../phase-graph.js';
import { scriptedConverse, resetEvalToolIds } from './harness.js';
import {
  ALL_TRAJECTORY_GOLDENS,
  TRAJECTORY_GATHER_THEN_ACT,
  TRAJECTORY_VERIFY_PASS,
} from './trajectories/phase-graph.js';
import {
  assertPhaseSequenceIncludes,
  assertTrajectoryTurn,
  collapsePhaseSequence,
  extractPhaseEvents,
  toolNamesFromConverseArgs,
  type TrajectoryGolden,
} from './trajectory.js';
import {
  PHASE_GRAPH_DEFAULT_ON_GATE,
  TRAJECTORY_METRIC_IDS,
} from './metrics.js';

const mockStreamConverseTurn = vi.fn();
const mockStreamPing = vi.fn();
const mockEmbedText = vi.fn(async () => Array.from({ length: 8 }, () => 0));

vi.mock('../bedrock.js', () => ({
  getNovaModelId: () => 'test-model',
  getNovaReasoningEffort: () => 'medium',
  getTitanEmbedModelId: () => 'test-embed',
  createBedrockClient: vi.fn(),
  streamConverseTurn: (...args: unknown[]) => mockStreamConverseTurn(...args),
  streamPing: (...args: unknown[]) => mockStreamPing(...args),
  embedText: (...args: unknown[]) => mockEmbedText(...args),
  DEFAULT_MAX_OUTPUT_TOKENS: 4096,
  DEFAULT_MAX_REASONING_OUTPUT_TOKENS: 30_000,
  DEFAULT_MAX_OUTPUT_CONTINUATIONS: 2,
}));

import { runAgentLoop } from '../loop.js';

async function prepareWorkspace(
  workspace: string,
  golden: TrajectoryGolden,
): Promise<void> {
  await mkdir(join(workspace, '.walkcroach'), { recursive: true });
  if (golden.workspace?.verifyJson) {
    await writeFile(
      join(workspace, '.walkcroach', 'verify.json'),
      JSON.stringify(golden.workspace.verifyJson),
      'utf8',
    );
  }
  if (golden.workspace?.settingsJson) {
    await writeFile(
      join(workspace, '.walkcroach', 'settings.json'),
      JSON.stringify(golden.workspace.settingsJson),
      'utf8',
    );
  }
}

async function runTrajectory(golden: TrajectoryGolden, workspace: string) {
  await prepareWorkspace(workspace, golden);
  mockStreamConverseTurn.mockImplementation(scriptedConverse(golden.script));

  const host = createFakeHost({
    autoApprove: true,
    workspaceRoot: workspace,
    files: { ...(golden.workspace?.files ?? {}) },
  });

  await runAgentLoop({
    host,
    prompt: golden.prompt,
    mode: 'full',
    actionBias: golden.loop.actionBias ?? 'always',
    includePhaseB: golden.loop.includePhaseB ?? false,
    subagentsEnabled: golden.loop.subagentsEnabled ?? false,
    maxIterations: golden.loop.maxIterations,
    phaseGraphEnabled: true,
    forcePlanOnRisk: golden.loop.forcePlanOnRisk ?? false,
    architectureCriticEnabled: golden.loop.architectureCriticEnabled ?? false,
    toolRankEnabled: golden.loop.toolRankEnabled ?? false,
    requireVerifyWhenConfigured: true,
  });

  return host;
}

describe('P5 phase-graph trajectories', () => {
  let workspace: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetEvalToolIds();
    workspace = await mkdtemp(join(tmpdir(), 'wc-traj-'));
  });

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('metric catalog + default-on gate docs are stable', () => {
    expect(TRAJECTORY_METRIC_IDS).toContain('verify_pass');
    expect(TRAJECTORY_METRIC_IDS).toContain('turns_to_done');
    expect(PHASE_GRAPH_DEFAULT_ON_GATE.enginePhaseGraphDefaultOn).toBe(true);
    expect(PHASE_GRAPH_DEFAULT_ON_GATE.enginePhaseGraphStillOptIn).toBe(false);
    expect(PHASE_GRAPH_DEFAULT_ON_GATE.requiredGreen).toContain('npm run eval');
  });

  it('Act+MCP tool-rank budget ≤12 (exit criterion fixture)', () => {
    const full = resolvePhaseAllowlist({
      phase: 'act',
      includePhaseB: true,
      includeExtendedAct: true,
      includeSubagents: true,
    });
    const pruned = mergeActAllowlistWithRank({
      fullAllowlist: full,
      rankedOptionalNames: ['cockroach_mcp', 'mcp_call', 'ccloud'],
    });
    expect(pruned.length).toBeLessThanOrEqual(ACT_TOOL_RANK_BUDGET);
    expect(() => assertActToolBudget(pruned)).not.toThrow();
  });

  it.each(ALL_TRAJECTORY_GOLDENS.map((g) => [g.id, g] as const))(
    'golden %s',
    async (_id, golden) => {
      const host = await runTrajectory(golden, workspace);

      const phases = collapsePhaseSequence(extractPhaseEvents(host.events));
      if (golden.expect.startPhase) {
        expect(phases[0]).toBe(golden.expect.startPhase);
      }
      if (golden.expect.phaseSequenceIncludes) {
        expect(() =>
          assertPhaseSequenceIncludes(
            phases,
            golden.expect.phaseSequenceIncludes!,
          ),
        ).not.toThrow();
      }

      const calls = mockStreamConverseTurn.mock.calls;
      for (const turn of golden.expect.turns) {
        const args = calls[turn.converseIndex]?.[0];
        expect(args, `missing converse ${turn.converseIndex}`).toBeTruthy();
        const offered = toolNamesFromConverseArgs(args);
        // Phase for tool asserts: use expected turn.phase (authoritative for remask).
        expect(() =>
          assertTrajectoryTurn({
            turn,
            offeredTools: offered,
            actualPhase: turn.phase,
          }),
        ).not.toThrow();
      }

      const done = host.events.find((e) => e.type === 'done');
      expect(done && done.type === 'done' ? done.reason : '').toBe(
        golden.expect.doneReason,
      );

      for (const fc of golden.expect.filesContain ?? []) {
        expect(host.files.get(fc.path) ?? '').toContain(fc.includes);
      }

      const maxTurns = golden.expect.metrics?.maxTurns;
      if (maxTurns != null) {
        expect(calls.length).toBeLessThanOrEqual(maxTurns);
      }
      if (golden.expect.metrics?.verifyPass) {
        expect(done && done.type === 'done' ? done.reason : '').not.toBe(
          'unverified',
        );
      }
    },
  );

  it('exports named goldens for discoverability', () => {
    expect(TRAJECTORY_GATHER_THEN_ACT.id).toBe('gather-then-act-write');
    expect(TRAJECTORY_VERIFY_PASS.id).toBe('verify-required-pass');
  });
});
