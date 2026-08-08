/**
 * The content-publishing pipeline: a document in, a pull request out.
 *
 * Phase 5: execution is the ADR-G Graph
 *   Fence → Plan (Planner, auto-approve) → Draft → Critique ⇄ Revise → OpenPR → Remember
 * in `content-publish-graph.ts`. This module keeps the public `publishContent`
 * API, helpers, and AgentRunner injection contract.
 *
 * The agent run itself is injected rather than imported. `@walkcroach/sdk-host`
 * lives outside `infra-backend`, and inverting the dependency keeps this
 * pipeline unit-testable without a model, a sandbox, or a network.
 */
import type { DbClient } from '@walkcroach/db';
import type { CriticFinding } from './critic-gate/index.js';
import {
  buildContentPublishGraph,
  initialContentPublishState,
  type ContentPublishGraphState,
} from './content-publish-graph.js';
import { MemoryGraphCheckpointer } from './graph/checkpointer.js';
import { CrdbGraphCheckpointer } from './graph/crdb-checkpointer.js';
import { runGraph } from './graph/executor.js';
import type { PullRequestResult } from './github-pr.js';
import type { StyleRule } from './house-style.js';
import {
  renderSecurityNotes,
  type InjectionSignal,
  type OutputFlag,
} from './untrusted-content.js';

/** What the caller supplies to actually run the agent / Planner. */
export type AgentRunner = (params: {
  /** Seed filesystem: the repo files we read, keyed by absolute path. */
  files: Record<string, string>;
  workspaceRoot: string;
  prompt: string;
  context: string;
  /** Pre-answered ask_user keys (from a prior resume). */
  answers?: Record<string, string>;
  /**
   * Phase 5 Graph roles:
   * - `plan` — Planner-as-subagent, auto-approve, no execute (`planOnly`)
   * - `draft` / `revise` — implement with approved plan injected
   */
  role?: 'plan' | 'draft' | 'revise';
  /** Approved plan markdown from the Plan stage (Draft/Revise). */
  approvedPlan?: string;
}) => Promise<{
  ok: boolean;
  reason: string;
  /** Workspace-relative paths the run created. */
  filesWritten: string[];
  /** Full contents after the run, keyed by absolute path. */
  snapshot: Record<string, string>;
  refusals: Array<{ rule: string; reason: string; subject: string }>;
  /** When set, the durable run should interrupt (not fail). */
  inputRequired?: { question: string; options: string[] };
  error?: string;
  /** Phase 5 — set when role=plan completes with auto-approve. */
  approvedPlan?: string;
}>;

export type PublishSource = {
  kind: 'markdown' | 'docx' | 'pdf' | 'html';
  /** Already extracted to text. Extraction is the caller's concern. */
  text: string;
  filename?: string;
  title?: string;
};

export type PublishResult = {
  ok: boolean;
  /**
   * Product contract id — `content.publish/v1`. Stamped on every terminal
   * result so SDK clients and Phase 6b can version-check without OpenAPI drift.
   */
  contractVersion?: string;
  pullRequest?: PullRequestResult;
  filesWritten: string[];
  /**
   * Generated file bodies. Always populated on success so dry-run / no-target
   * callers can apply the result locally without a pull request.
   */
  files?: Array<{ path: string; content: string }>;
  /** Injection heuristics that matched the source document. */
  signals: InjectionSignal[];
  /** Red flags in what the agent generated. */
  flags: OutputFlag[];
  /** CriticGate findings from the Critique stage. */
  criticFindings?: CriticFinding[];
  refusals: Array<{ rule: string; reason: string; subject: string }>;
  /** House-style rules newly learned and written to memory. */
  learned: string[];
  reason: string;
  error?: string;
  /** When set, the durable run should interrupt (not fail). */
  inputRequired?: { question: string; options: string[] };
  /** Phase 5 — approved plan was auto-injected into Draft. */
  planAutoApproved?: boolean;
  approvedPlan?: string;
};

/** Must match `@walkcroach/sdk` `CONTENT_PUBLISH_CONTRACT_VERSION`. */
export const CONTENT_PUBLISH_CONTRACT_VERSION = 'content.publish/v1' as const;

/** Title from an explicit value, an H1, or the filename — in that order. */
export function deriveTitle(source: PublishSource): string {
  if (source.title?.trim()) return source.title.trim();
  const h1 = /^#\s+(.+)$/m.exec(source.text);
  if (h1?.[1]) return h1[1].trim();
  if (source.filename)
    return source.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return 'New post';
}

export async function publishContent(params: {
  db: DbClient;
  projectId: string;
  /** GitHub App installation for the target repo. Required unless noTarget. */
  installationId?: number;
  /** `owner/name`. Required unless noTarget. */
  repo?: string;
  /** Where posts live; inferred from the repo when omitted. */
  targetDir?: string;
  source: PublishSource;
  /** Extra instruction from the caller, e.g. "technical audience". */
  instructions?: string;
  runAgent: AgentRunner;
  /** Skip the PR and return the files instead. */
  dryRun?: boolean;
  /**
   * Dry-run without a GitHub target — memory + skill defaults only.
   * Used so an API key alone can exercise content.publish.
   */
  noTarget?: boolean;
  /** Resume answers from a prior interrupt (ask_user question → answer). */
  answers?: Record<string, string>;
  /**
   * Phase 5 — durable run id for CRDB checkpoints. When omitted, uses an
   * in-memory checkpointer (unit tests / ephemeral dry-runs).
   */
  runId?: string;
  signal?: AbortSignal;
  onStageEvent?: (
    type: string,
    payload: Record<string, unknown>,
  ) => void | Promise<void>;
}): Promise<PublishResult> {
  const graph = buildContentPublishGraph({
    db: params.db,
    projectId: params.projectId,
    runAgent: params.runAgent,
  });

  const initial = initialContentPublishState({
    source: params.source,
    instructions: params.instructions,
    targetDir: params.targetDir,
    dryRun: params.dryRun,
    noTarget: params.noTarget,
    installationId: params.installationId,
    repo: params.repo,
    answers: params.answers,
  });

  const runId = params.runId ?? `publish-ephemeral-${Date.now()}`;
  const checkpointer = params.runId
    ? new CrdbGraphCheckpointer(params.db)
    : new MemoryGraphCheckpointer();

  const outcome = await runGraph<ContentPublishGraphState>({
    runId,
    graph,
    checkpointer,
    initialState: initial,
    signal: params.signal,
    onEvent: params.onStageEvent,
  });

  const state = outcome.state as ContentPublishGraphState;

  if (state.inputRequired || state.pipelineReason === 'input_required') {
    return stampPublishResult({
      ok: false,
      filesWritten: state.filesWritten ?? [],
      signals: state.signals ?? [],
      flags: state.flags ?? [],
      criticFindings: state.criticFindings,
      refusals: state.refusals ?? [],
      learned: state.learned ?? [],
      reason: 'input_required',
      inputRequired: state.inputRequired ?? {
        question: state.pipelineError ?? 'input required',
        options: [],
      },
      ...(state.pipelineError ? { error: state.pipelineError } : {}),
      planAutoApproved: state.planAutoApproved,
      approvedPlan: state.approvedPlan,
    });
  }

  const ok =
    outcome.status === 'completed' &&
    state.pipelineOk !== false &&
    state.pipelineReason !== 'critic_blocked' &&
    (state.filesWritten?.length ?? 0) > 0;

  if (!ok) {
    return stampPublishResult({
      ok: false,
      filesWritten: state.filesWritten ?? [],
      files: (state.artifacts ?? []).map((a) => ({
        path: a.path,
        content: a.content,
      })),
      signals: state.signals ?? [],
      flags: state.flags ?? [],
      criticFindings: state.criticFindings,
      refusals: state.refusals ?? [],
      learned: state.learned ?? [],
      reason:
        state.pipelineReason ??
        (outcome.status === 'failed' ? 'graph_failed' : 'incomplete'),
      ...(state.pipelineError || outcome.status === 'failed'
        ? {
            error:
              state.pipelineError ??
              (outcome.status === 'failed' ? outcome.error : undefined),
          }
        : {}),
      ...(state.pullRequest ? { pullRequest: state.pullRequest } : {}),
      planAutoApproved: state.planAutoApproved,
      approvedPlan: state.approvedPlan,
    });
  }

  return stampPublishResult({
    ok: true,
    ...(state.pullRequest ? { pullRequest: state.pullRequest } : {}),
    filesWritten: state.filesWritten,
    files: state.artifacts.map((a) => ({ path: a.path, content: a.content })),
    signals: state.signals,
    flags: state.flags,
    criticFindings: state.criticFindings,
    refusals: state.refusals,
    learned: state.learned,
    reason: state.pipelineReason ?? 'completed',
    planAutoApproved: state.planAutoApproved,
    approvedPlan: state.approvedPlan,
  });
}

function stampPublishResult(result: PublishResult): PublishResult {
  return {
    ...result,
    contractVersion: CONTENT_PUBLISH_CONTRACT_VERSION,
  };
}

export function renderPrBody(params: {
  title: string;
  source: PublishSource;
  files: string[];
  style: StyleRule[];
  signals: InjectionSignal[];
  flags: OutputFlag[];
  refusals: Array<{ rule: string; reason: string; subject: string }>;
}): string {
  const sections = [
    `Generated from **${params.source.filename ?? `an uploaded ${params.source.kind} document`}** by the WalkCroach SDK.`,
    '',
    '### Files added',
    ...params.files.map((p) => `- \`${p}\``),
    '',
    '### Conventions applied',
    ...params.style
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => `- \`${r.key}\`: ${r.value} — _${r.because}_`),
  ];

  if (params.refusals.length > 0) {
    sections.push(
      '',
      '### Actions refused',
      ...params.refusals.map((r) => `- \`${r.rule}\` — ${r.subject}`),
    );
  }

  const security = renderSecurityNotes({
    signals: params.signals,
    flags: params.flags,
  });
  if (security) sections.push('', security);

  sections.push(
    '',
    '---',
    '_This branch adds files only; no existing file was modified. Your CI verifies the build._',
  );

  return sections.join('\n');
}
