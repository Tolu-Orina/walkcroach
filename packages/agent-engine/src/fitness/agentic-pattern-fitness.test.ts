/**
 * Phase 8 fitness — agent-engine quality scenarios (§0.1 #1 thrash, #2 plan isolation, #3 phase graph).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRASH_THRESHOLD,
  beforeBoundedToolCall,
  emptyBoundedExecutorState,
  recordThrashExecution,
  resolveBoundedExecutorConfig,
} from '../bounded-executor.js';
import {
  PLANNER_FORBIDDEN_TOOLS,
  PLANNER_TOOL_ALLOWLIST,
  assertPlannerSchemaHasNoWriteTools,
  isPlannerToolName,
} from '../planner.js';
import {
  assertPhaseAllowlistInvariants,
  resolvePhaseAllowlist,
} from '../phase-graph.js';
import {
  beginVerifyToActRetry,
  classifyPhaseFailure,
  emptyPhaseTransitionState,
  recordGatherReadFile,
  recordPhaseFailure,
  DEFAULT_GATHER_SAME_PATH_READS,
  DEFAULT_MAX_VERIFY_TO_ACT,
} from '../failure-taxonomy.js';
import {
  looksLikeRiskyOrLargeTask,
  shouldForcePlanThenExecute,
} from '../plan-gate.js';
import {
  CRITIC_TOOL_ALLOWLIST,
  shouldRunArchitectureCritic,
} from '../architecture-critic.js';
import { WorkspacePolicy } from '../workspace-policy.js';
import { defaultSettings } from '../workspace-config.js';
import {
  ACT_TOOL_RANK_BUDGET,
  assertActToolBudget,
  mergeActAllowlistWithRank,
  toolKeywordBoost,
} from '../tool-rank.js';
import { resolvePhaseAllowlist } from '../phase-graph.js';

describe('Phase 8 fitness — engine scenarios', () => {
  it('§0.1 #1 thrash: identical fingerprint warns then escalates (hard stop path)', () => {
    let state = emptyBoundedExecutorState(resolveBoundedExecutorConfig());
    const input = { cmd: 'npm test' };

    for (let i = 0; i < DEFAULT_THRASH_THRESHOLD - 1; i++) {
      const d = beforeBoundedToolCall(state, 'run_terminal', input);
      expect(d.action).toBe('allow');
      if (d.action === 'allow') {
        state = recordThrashExecution(d.state, d.fingerprint);
      }
    }

    const warn = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(warn.action).toBe('warn_skip');
    if (warn.action === 'warn_skip') state = warn.state;

    const esc = beforeBoundedToolCall(state, 'run_terminal', input);
    expect(esc.action).toBe('escalate');
  });

  it('§0.1 #2 plan isolation: write/shell tools absent from Planner schema', () => {
    for (const denied of PLANNER_FORBIDDEN_TOOLS) {
      expect(isPlannerToolName(denied)).toBe(false);
    }
    expect(() =>
      assertPlannerSchemaHasNoWriteTools([...PLANNER_TOOL_ALLOWLIST]),
    ).not.toThrow();
    expect(() =>
      assertPlannerSchemaHasNoWriteTools([
        ...PLANNER_TOOL_ALLOWLIST,
        'write_file',
      ]),
    ).toThrow(/write_file/);
  });

  it('§0.1 #3 phase graph: gather/verify masks reject writers', () => {
    for (const phase of ['gather', 'verify'] as const) {
      const names = resolvePhaseAllowlist({ phase });
      expect(() => assertPhaseAllowlistInvariants(phase, names)).not.toThrow();
    }
    const act = resolvePhaseAllowlist({ phase: 'act' });
    expect(act).toContain('edit_file');
  });

  it('§0.1 #4 failure taxonomy: gather thrash + verify retry cap', () => {
    let state = emptyPhaseTransitionState();
    for (let i = 1; i < DEFAULT_GATHER_SAME_PATH_READS; i++) {
      state = recordGatherReadFile(state, 'src/x.ts').state;
    }
    expect(recordGatherReadFile(state, 'src/x.ts').forceAct).toBe(true);

    expect(
      classifyPhaseFailure({
        toolName: 'verify',
        status: 'error',
        content: '2 failed',
      }),
    ).toBe('test');

    state = emptyPhaseTransitionState();
    for (let i = 0; i < DEFAULT_MAX_VERIFY_TO_ACT; i++) {
      const r = beginVerifyToActRetry(state);
      state = r.state;
      expect(r.allowed).toBe(true);
    }
    expect(beginVerifyToActRetry(state).allowed).toBe(false);

    const twice = recordPhaseFailure(
      recordPhaseFailure(emptyPhaseTransitionState(), 'edit_mismatch').state,
      'edit_mismatch',
    );
    expect(twice.divergent).toBe(true);
  });

  it('§0.1 #5 dual validation: plan gate + verify recipes + critic allowlist', () => {
    expect(
      looksLikeRiskyOrLargeTask(
        'Refactor auth across the codebase and migrate sessions',
      ),
    ).toBe(true);
    expect(
      shouldForcePlanThenExecute({
        prompt: 'Refactor auth across the codebase',
        forcePlanOnRisk: true,
      }),
    ).toBe(true);

    const policy = new WorkspacePolicy(defaultSettings(), {
      commands: ['npm test'],
      cwd: '.',
    });
    expect(policy.isVerifyRequired(true)).toBe(true);
    const off = new WorkspacePolicy(
      { ...defaultSettings(), verify: { required: false, maxNudges: 1 } },
      { commands: ['npm test'], cwd: '.' },
    );
    expect(off.verifyRequired).toBe(false);
    expect(off.isVerifyRequired(true)).toBe(true);

    expect(CRITIC_TOOL_ALLOWLIST).not.toContain('write_file');
    expect(
      shouldRunArchitectureCritic({
        enabled: true,
        depth: 0,
        actionMutating: true,
        critiquesUsed: 0,
      }),
    ).toBe(true);
  });

  it('§0.1 #6 tool rank: Act + MCP ≤12 and cockroach keyword boost', () => {
    const full = resolvePhaseAllowlist({
      phase: 'act',
      includePhaseB: true,
      includeExtendedAct: true,
      includeSubagents: true,
    });
    expect(full.length).toBeGreaterThan(ACT_TOOL_RANK_BUDGET);

    const pruned = mergeActAllowlistWithRank({
      fullAllowlist: full,
      rankedOptionalNames: ['cockroach_mcp', 'mcp_call', 'ccloud'],
    });
    expect(pruned.length).toBeLessThanOrEqual(ACT_TOOL_RANK_BUDGET);
    expect(() => assertActToolBudget(pruned)).not.toThrow();
    expect(pruned).toContain('cockroach_mcp');
    expect(
      toolKeywordBoost('cockroach sql schema', 'cockroach_mcp', 'mcp'),
    ).toBe(true);
  });
});
