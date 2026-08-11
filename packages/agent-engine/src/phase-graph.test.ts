import { describe, expect, it } from 'vitest';
import {
  assertPhaseAllowlistInvariants,
  classifyStartPhase,
  isTrivialTask,
  recordGatherTools,
  remaskToolsForPhase,
  resolvePhaseAllowlist,
  shouldEnablePhaseGraph,
  shouldExitGather,
  GATHER_TOOL_ALLOWLIST,
  VERIFY_TOOL_ALLOWLIST,
} from './phase-graph.js';
import {
  buildGatherToActPrompt,
  formatPhasePrompt,
} from './phase-prompts.js';
import { assembleSystemBlocks } from './prompt.js';

describe('phase-graph P0 remask', () => {
  it('gather and verify never offer write tools', () => {
    for (const phase of ['gather', 'verify'] as const) {
      const names = resolvePhaseAllowlist({ phase });
      expect(() => assertPhaseAllowlistInvariants(phase, names)).not.toThrow();
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('edit_file');
      expect(names).not.toContain('apply_patch');
    }
  });

  it('act offers edit tools and optional MCP when flagged', () => {
    const core = resolvePhaseAllowlist({ phase: 'act', includePhaseB: false });
    expect(core).toContain('edit_file');
    expect(core).toContain('write_file');
    expect(core).not.toContain('cockroach_mcp');

    const withB = resolvePhaseAllowlist({ phase: 'act', includePhaseB: true });
    expect(withB).toContain('cockroach_mcp');
    expect(withB).toContain('mcp_call');
  });

  it('remaskToolsForPhase returns Bedrock toolSpecs matching allowlist', () => {
    const tools = remaskToolsForPhase({ phase: 'gather' });
    const names = (tools ?? []).map((t) => t.toolSpec?.name);
    expect(names).toEqual([...GATHER_TOOL_ALLOWLIST].filter(
      // recall omitted when includePhaseC false (default)
      (n) => n !== 'recall_project_memory',
    ));
  });

  it('shouldEnablePhaseGraph defaults ON; off for planner/readOnly/depth/allowlist/false', () => {
    expect(shouldEnablePhaseGraph({})).toBe(true);
    expect(shouldEnablePhaseGraph({ phaseGraphEnabled: true })).toBe(true);
    expect(shouldEnablePhaseGraph({ phaseGraphEnabled: false })).toBe(false);
    expect(
      shouldEnablePhaseGraph({ phaseGraphEnabled: true, readOnly: true }),
    ).toBe(false);
    expect(
      shouldEnablePhaseGraph({ phaseGraphEnabled: true, plannerMode: true }),
    ).toBe(false);
    expect(
      shouldEnablePhaseGraph({ phaseGraphEnabled: true, depth: 1 }),
    ).toBe(false);
    expect(
      shouldEnablePhaseGraph({
        phaseGraphEnabled: true,
        toolAllowlist: ['read_file'],
      }),
    ).toBe(false);
  });
});

describe('phase-graph P1 classify + gather exit', () => {
  it('classifies trivial prompts as act and others as gather', () => {
    expect(isTrivialTask('fix typo in README')).toBe(true);
    expect(classifyStartPhase({ prompt: 'fix typo in README' })).toBe('act');
    expect(
      classifyStartPhase({
        prompt: 'Refactor auth across the monorepo and redesign session flow',
      }),
    ).toBe('gather');
    expect(
      classifyStartPhase({
        prompt: 'anything',
        hasApprovedPlan: true,
      }),
    ).toBe('act');
  });

  it('exits gather on exploratory budget or end-turn', () => {
    let state = { toolTurns: 0, exploratoryHits: 0 };
    state = recordGatherTools(state, ['read_file', 'search']);
    expect(shouldExitGather(state)).toBe(false);
    state = recordGatherTools(state, ['read_file']);
    // hits=3 → threshold
    expect(shouldExitGather(state)).toBe(true);

    const early = recordGatherTools(
      { toolTurns: 0, exploratoryHits: 0 },
      ['list_dir'],
    );
    expect(shouldExitGather(early, { endTurn: true })).toBe(true);
  });

  it('verify allowlist stays write-free', () => {
    expect([...VERIFY_TOOL_ALLOWLIST]).not.toContain('write_file');
  });
});

describe('phase-prompts', () => {
  it('formatPhasePrompt names the active phase', () => {
    expect(formatPhasePrompt('gather')).toMatch(/Gather/);
    expect(formatPhasePrompt('act')).toMatch(/Act/);
    expect(formatPhasePrompt('verify')).toMatch(/Verify/);
    expect(buildGatherToActPrompt(true)).toMatch(/Gather → Act/);
  });

  it('assembleSystemBlocks includes phasePrompt without a cache point after it', () => {
    const blocks = assembleSystemBlocks({
      phasePrompt: formatPhasePrompt('gather'),
    });
    const texts = blocks.map((b) => ('text' in b ? b.text : null));
    expect(texts.some((t) => t?.includes('Active phase: Gather'))).toBe(true);
  });
});
