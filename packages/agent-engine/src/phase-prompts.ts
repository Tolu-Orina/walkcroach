/**
 * Phase-local system prompt slices (P1).
 * Kept short — Nova 2 Lite Tool Usage guidance favors punchy, phase-scoped rules.
 */

import type { AgentPhase } from './phase-graph.js';

export function formatPhasePrompt(phase: AgentPhase): string {
  switch (phase) {
    case 'gather':
      return [
        '# Active phase: Gather',
        'Tool Usage: only explore — read_file, search, glob, semantic_search, list_dir, load_skill, load_rule, ask_user.',
        'Do not edit files or run mutating shell. Prefer load_skill when a catalog entry matches.',
        'Exit criteria: locate the files/symbols you need, then stop tool use so the harness can enter Act.',
      ].join('\n');
    case 'act':
      return [
        '# Active phase: Act',
        'Tool Usage: implement the change with edit_file / apply_patch / write_file / run_terminal; keep todo_write current.',
        'Anchor edits with unique context. Prefer load_skill before improvising CockroachDB or project conventions.',
        'Exit criteria: mutations done; call verify (or finish so Verify phase can run) before claiming completion.',
      ].join('\n');
    case 'verify':
      return [
        '# Active phase: Verify',
        'Tool Usage: run verify and/or targeted tests via run_terminal; read_file to inspect failures. Do not invent new features or rewrite files.',
        'Exit criteria: verify exits 0 (or tests pass). If checks fail, stop tool use so the harness can return you to Act with the failure context.',
      ].join('\n');
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

/** User-visible bridge when Gather → Act. */
export function buildGatherToActPrompt(isAction: boolean): string {
  if (isAction) {
    return [
      '[Phase transition: Gather → Act]',
      'Exploration tools are done. Write/edit tools are now available.',
      'Implement the user task now (todo_write if helpful, then write_file / edit_file / apply_patch / run_terminal).',
      'Do not re-explore the whole workspace.',
    ].join('\n');
  }
  return [
    '[Phase transition: Gather → Act]',
    'If the user only asked a question, answer concisely from what you gathered.',
    'If changes are still required, use write/edit tools now.',
  ].join('\n');
}

/** User-visible bridge when Act → Verify (alongside verify nudge). */
export function buildActToVerifyPrompt(): string {
  return [
    '[Phase transition: Act → Verify]',
    'Write tools are masked. Run verify / tests only; fix nothing until Verify fails and Act is restored.',
  ].join('\n');
}

/** User-visible bridge when Verify → Act after failed checks. */
export function buildVerifyToActPrompt(detail?: string): string {
  return [
    '[Phase transition: Verify → Act]',
    'Verification did not pass. Edit/fix tools are available again.',
    detail?.trim() || 'Fix the failing checks, then stop so Verify can re-run.',
  ].join('\n');
}
