/**
 * P3 — Architecture critic (post-Act dual validation).
 *
 * Read-only subagent that reviews mutations against consistency / architecture
 * checklist. Reuses REVIEW_OK / REVIEW_ISSUES markers from verify-review.
 */

import { REVIEW_OK_MARKER, isReviewOk } from './review-markers.js';

export { REVIEW_OK_MARKER, isReviewOk };

export const CRITIC_ROLE = 'critic' as const;

/** At most one architecture-critic pass per top-level run. */
export const MAX_ARCHITECTURE_CRITIQUES = 1;

/** Schema-level allowlist — explore only (no submit_plan / writes / shell). */
export const CRITIC_TOOL_ALLOWLIST = [
  'read_file',
  'list_dir',
  'search',
  'glob',
  'semantic_search',
  'load_skill',
  'load_rule',
  'recall_project_memory',
] as const;

export type CriticToolName = (typeof CRITIC_TOOL_ALLOWLIST)[number];

export function isCriticToolName(name: string): name is CriticToolName {
  return (CRITIC_TOOL_ALLOWLIST as readonly string[]).includes(name);
}

export function isCriticSpawnName(name: string): boolean {
  return /^(architecture[-_]?critic|critic)$/i.test(name.trim());
}

export const CRITIC_SYSTEM_PROMPT = [
  'You are the WalkCroach Architecture Critic subagent.',
  'Your job: review the just-completed mutating work for architecture and consistency issues.',
  'You MUST NOT edit files or run shell commands — those tools are not available.',
  'Inspect relevant files with read_file / search / glob as needed.',
  `If the change set is acceptable, reply with exactly ${REVIEW_OK_MARKER} on the first line, then a one-sentence note.`,
  'If there are problems, reply with REVIEW_ISSUES: then a short bullet list of must-fix items.',
].join(' ');

const CHECKLIST = [
  'Layering / module boundaries — no upward or cross-cutting leaks',
  'API / type contracts — public surfaces stay coherent',
  'Consistency with nearby patterns (naming, error handling, auth)',
  'Missing verification coverage for the claimed change',
  'Obvious security or data-handling regressions',
  'Dead or contradictory code left behind',
];

export function buildArchitectureCriticPrompt(params: {
  task: string;
  gitStatus?: string | null;
}): string {
  const lines = [
    '# Architecture critic task',
    params.task.trim(),
    '',
    '# Checklist (flag only concrete issues)',
    ...CHECKLIST.map((c) => `- ${c}`),
    '',
    'Use read_file / search / glob on the paths that actually changed. Prefer evidence over speculation.',
    `If acceptable: first line exactly ${REVIEW_OK_MARKER}.`,
    'If not: first line REVIEW_ISSUES: then bullets.',
  ];
  const git = params.gitStatus?.trim();
  if (git) {
    lines.push('', '# Workspace git status (hint)', '```', git.slice(0, 4000), '```');
  }
  return lines.join('\n');
}

export function shouldRunArchitectureCritic(params: {
  enabled: boolean;
  depth: number;
  actionMutating: boolean;
  critiquesUsed: number;
  maxCritiques?: number;
}): boolean {
  if (!params.enabled) return false;
  if (params.depth > 0) return false;
  if (!params.actionMutating) return false;
  const max = params.maxCritiques ?? MAX_ARCHITECTURE_CRITIQUES;
  return params.critiquesUsed < max;
}
