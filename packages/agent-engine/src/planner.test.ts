import { describe, expect, it } from 'vitest';
import {
  PLANNER_FORBIDDEN_TOOLS,
  PLANNER_TOOL_ALLOWLIST,
  assertPlannerSchemaHasNoWriteTools,
  isPlannerSpawnName,
  looksLikePlanningTask,
  validatePlanArtifact,
} from './planner.js';
import { toBedrockTools } from './tools/defs.js';
import { executeTool } from './tools/execute.js';
import { createFakeHost } from './fake-host.js';

const VALID_PLAN = `
## Goal
Ship Phase 2 planner.

## Context
WalkCroach agent-engine loop.

## Files to modify
- packages/agent-engine/src/loop.ts

## Files to create
- packages/agent-engine/src/planner.ts

## Implementation steps
1. Add planner module
2. Wire present_plan

## Verification criteria
- Schema assert passes
- Unit tests green

## Risks
- mode:plan behavior change
`.trim();

describe('planner schema (Phase 2 exit criterion)', () => {
  it('allowlist contains zero forbidden write/shell tools', () => {
    expect(() =>
      assertPlannerSchemaHasNoWriteTools(PLANNER_TOOL_ALLOWLIST),
    ).not.toThrow();
    for (const bad of PLANNER_FORBIDDEN_TOOLS) {
      expect(PLANNER_TOOL_ALLOWLIST).not.toContain(bad);
    }
  });

  it('toBedrockTools(allowlist) matches Planner tools only', () => {
    const tools = toBedrockTools({
      allowlist: PLANNER_TOOL_ALLOWLIST,
      includeSubagents: false,
      includePhaseB: false,
    });
    const names = tools.map((t) => t.toolSpec?.name ?? '');
    assertPlannerSchemaHasNoWriteTools(names);
    expect(names).toContain('submit_plan');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_terminal');
    expect(names).not.toContain('spawn_subagent');
  });

  it('parent toBedrockTools excludes submit_plan', () => {
    const tools = toBedrockTools({ includeSubagents: true });
    const names = tools.map((t) => t.toolSpec?.name ?? '');
    expect(names).toContain('present_plan');
    expect(names).not.toContain('submit_plan');
  });
});

describe('validatePlanArtifact', () => {
  it('accepts complete seven-section plans', () => {
    const v = validatePlanArtifact(VALID_PLAN);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.sections.Goal).toMatch(/Phase 2/);
    }
  });

  it('rejects missing sections', () => {
    const v = validatePlanArtifact('## Goal\nOnly goal\n');
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.missing.length).toBeGreaterThan(0);
    }
  });
});

describe('planning heuristics', () => {
  it('detects planning intent', () => {
    expect(looksLikePlanningTask('Please design an approach for auth')).toBe(
      true,
    );
    expect(looksLikePlanningTask('fix the typo in README')).toBe(false);
  });

  it('detects Planner spawn names', () => {
    expect(isPlannerSpawnName('Planner')).toBe(true);
    expect(isPlannerSpawnName('planner')).toBe(true);
    expect(isPlannerSpawnName('explore')).toBe(false);
  });
});

describe('submit_plan / present_plan tools', () => {
  it('rejects submit_plan outside plannerMode', async () => {
    const host = createFakeHost({ autoApprove: true });
    const result = await executeTool({
      host,
      tool: {
        toolUseId: '1',
        name: 'submit_plan',
        input: { plan_markdown: VALID_PLAN },
      },
    });
    expect(result.status).toBe('error');
    expect(result.content).toMatch(/only available inside the Planner/i);
  });

  it('submit_plan writes validated plan when plannerMode', async () => {
    const host = createFakeHost({ autoApprove: true });
    let submitted: string | null = null;
    const result = await executeTool({
      host,
      tool: {
        toolUseId: '1',
        name: 'submit_plan',
        input: { plan_markdown: VALID_PLAN },
      },
      plannerMode: true,
      onPlanSubmitted: (p) => {
        submitted = p;
      },
    });
    expect(result.status).toBe('success');
    expect(submitted).toMatch(/\.walkcroach\/plans\//);
    expect(host.files.has(submitted!)).toBe(true);
  });

  it('present_plan auto-approves into planSession', async () => {
    const host = createFakeHost({ autoApprove: true });
    const path = '.walkcroach/plans/test-plan.md';
    host.files.set(path, `# WalkCroach plan\n\n${VALID_PLAN}\n`);
    const planSession = {
      autoApprove: true,
      approvedPlan: null as string | null,
      approvedPlanPath: null as string | null,
      reviseFeedback: null as string | null,
    };
    const result = await executeTool({
      host,
      tool: {
        toolUseId: '2',
        name: 'present_plan',
        input: { plan_path: path },
      },
      planSession,
    });
    expect(result.status).toBe('success');
    expect(planSession.approvedPlan).toMatch(/Approved plan/);
    expect(planSession.approvedPlanPath).toBe(path);
  });
});
