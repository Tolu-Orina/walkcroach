/**
 * Phase 2 — Planner-as-subagent (OpenDev / ADR-A).
 *
 * Planning is a schema-restricted subagent (no general write/shell tools), not a
 * sticky mode:plan toggle. The Planner explores read-only, then calls
 * submit_plan (scratch plans only). The parent calls present_plan for
 * Approve / Revise (or auto-approves on non-interactive hosts).
 */

export const PLANNER_ROLE = 'planner' as const;

/** OpenDev seven-section plan artifact (required headings). */
export const PLAN_SECTION_HEADINGS = [
  'Goal',
  'Context',
  'Files to modify',
  'Files to create',
  'Implementation steps',
  'Verification criteria',
  'Risks',
] as const;

export type PlanSectionName = (typeof PLAN_SECTION_HEADINGS)[number];

export type PlanArtifact = {
  path: string;
  body: string;
  sections: Record<PlanSectionName, string>;
};

/** Tools offered to the Planner — schema-level (not merely runtime reject). */
export const PLANNER_TOOL_ALLOWLIST = [
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'load_skill',
  'load_rule',
  'recall_project_memory',
  'ask_user',
  'submit_plan',
] as const;

export type PlannerToolName = (typeof PLANNER_TOOL_ALLOWLIST)[number];

export function isPlannerToolName(name: string): name is PlannerToolName {
  return (PLANNER_TOOL_ALLOWLIST as readonly string[]).includes(name);
}

/** Schema assert: Planner allowlist must contain zero mutating/shell tools. */
export const PLANNER_FORBIDDEN_TOOLS = [
  'write_file',
  'edit_file',
  'apply_patch',
  'run_terminal',
  'verify',
  'todo_write',
  'spawn_subagent',
  'present_plan',
  'update_walkcroach_md',
  'mcp_call',
  'ccloud',
  'terminal_session',
  'await_terminal',
] as const;

export function assertPlannerSchemaHasNoWriteTools(
  toolNames: readonly string[],
): void {
  const forbidden = toolNames.filter((n) =>
    (PLANNER_FORBIDDEN_TOOLS as readonly string[]).includes(n),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `Planner schema leaked write/shell tools: ${forbidden.join(', ')}`,
    );
  }
  for (const n of toolNames) {
    if (!isPlannerToolName(n)) {
      throw new Error(`Planner schema has unexpected tool: ${n}`);
    }
  }
}

export const PLANNER_SYSTEM_PROMPT = [
  'You are the WalkCroach Planner subagent.',
  'Your job: explore the workspace read-only, analyze risks/trade-offs, then submit a structured plan.',
  'You MUST NOT edit source files or run shell commands — those tools are not available.',
  'Workflow: (1) explore with read_file / search / glob / list_dir / semantic_search as needed;',
  '(2) call load_skill / load_rule when a catalog entry looks relevant (skills/rules are metadata-only until loaded);',
  '(3) analyze patterns, risks, and the minimal change set;',
  '(4) call submit_plan with a complete seven-section markdown plan.',
  'Do not claim the plan is done until submit_plan succeeds.',
  'Keep the plan concrete: real paths, ordered steps, and verifiable checks.',
].join(' ');

export function buildPlannerUserPrompt(task: string): string {
  return [
    '# Planning task',
    task.trim(),
    '',
    '# Required plan sections (use these exact ## headings)',
    ...PLAN_SECTION_HEADINGS.map((h) => `- ## ${h}`),
    '',
    'Use load_skill when a listed skill matches the domain (CockroachDB, auth, MCP, conventions).',
    'When ready, call submit_plan with the full markdown body.',
  ].join('\n');
}

export function looksLikePlanningTask(prompt: string): boolean {
  return /\b(plan|design|architect|roadmap|propose (a |the )?(change|refactor|approach)|write a plan|planning mode)\b/i.test(
    prompt,
  );
}

export function isPlannerSpawnName(name: string): boolean {
  return /^planner$/i.test(name.trim());
}

export type PlanValidation =
  | { ok: true; sections: Record<PlanSectionName, string> }
  | { ok: false; missing: PlanSectionName[]; message: string };

/**
 * Validate OpenDev-style ## Section headings with non-empty bodies.
 */
export function validatePlanArtifact(body: string): PlanValidation {
  const text = body.replace(/\r\n/g, '\n').trim();
  if (!text) {
    return {
      ok: false,
      missing: [...PLAN_SECTION_HEADINGS],
      message: 'Plan body is empty',
    };
  }

  const sections = {} as Record<PlanSectionName, string>;
  const missing: PlanSectionName[] = [];

  for (let i = 0; i < PLAN_SECTION_HEADINGS.length; i++) {
    const heading = PLAN_SECTION_HEADINGS[i]!;
    const next = PLAN_SECTION_HEADINGS[i + 1];
    const startRe = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im');
    const startMatch = startRe.exec(text);
    if (!startMatch || startMatch.index === undefined) {
      missing.push(heading);
      continue;
    }
    const contentStart = startMatch.index + startMatch[0].length;
    let contentEnd = text.length;
    if (next) {
      const endRe = new RegExp(`^##\\s+${escapeRegExp(next)}\\s*$`, 'im');
      endRe.lastIndex = contentStart;
      const endMatch = endRe.exec(text);
      if (endMatch && endMatch.index !== undefined) {
        contentEnd = endMatch.index;
      }
    }
    const content = text.slice(contentStart, contentEnd).trim();
    if (!content) {
      missing.push(heading);
      continue;
    }
    sections[heading] = content;
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      message: `Plan missing or empty sections: ${missing.join(', ')}`,
    };
  }

  return { ok: true, sections };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function plansDirRel(): string {
  return '.walkcroach/plans';
}

export function newPlanPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${plansDirRel()}/plan-${stamp}.md`;
}

/** Non-negotiable context injected after Approve / auto-approve. */
export function formatApprovedPlanBlock(planBody: string, planPath: string): string {
  return [
    '# Approved plan (non-negotiable)',
    `Source: ${planPath}`,
    'Execute this plan. Do not ignore sections. Update todo_write to mirror Implementation steps.',
    'If blocked, ask_user — do not silently freestyle outside the plan.',
    '',
    planBody.trim(),
  ].join('\n');
}
