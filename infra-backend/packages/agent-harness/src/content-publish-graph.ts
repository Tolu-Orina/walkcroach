/**
 * Phase 5 — `content.publish` as an ADR-G Graph.
 *
 * Fence → Plan (Planner, auto-approve) → Draft → Critique ⇄ Revise → OpenPR → Remember
 *
 * Critique owns enforcement (Phase 4a linear fail-closed path deleted).
 */
import type { DbClient } from '@walkcroach/db';
import {
  defaultPublishCriticChecks,
  createTier2HeuristicModelCritic,
  resolveModelCriticFromEnv,
  runCriticGate,
  type CriticArtifact,
  type CriticFinding,
  type ModelCritic,
} from './critic-gate/index.js';
import { defineGraph } from './graph/define.js';
import type { GraphDefinition, GraphState } from './graph/types.js';
import {
  contentBranchName,
  getInstallationToken,
  openContentPullRequest,
  readRepoContext,
  type PullRequestResult,
  type RepoFile,
} from './github-pr.js';
import {
  discoverHouseStyle,
  parseMemoryRules,
  renderHouseStyle,
  ruleToMemoryText,
  type StyleRule,
} from './house-style.js';
import { listProjectMemoryEntries, writeMemoryEntry } from './memory.js';
import {
  fenceUntrusted,
  inspectGeneratedContent,
  type InjectionSignal,
  type OutputFlag,
} from './untrusted-content.js';
import type { AgentRunner, PublishSource } from './content-publish.js';
import { deriveTitle, renderPrBody } from './content-publish.js';

export const CONTENT_PUBLISH_GRAPH_ID = 'content.publish';

const WORKSPACE = '/workspace';
const MAX_REVISE_ROUNDS = 2;

const DURABLE_KEYS = new Set([
  'content.dir',
  'content.format',
  'import.alias',
  'classnames.helper',
  'styling.system',
  'ui.kit',
  'framework',
  'routing',
  'package.manager',
]);

export type ContentPublishGraphState = GraphState & {
  title: string;
  noTarget: boolean;
  dryRun: boolean;
  targetDir: string;
  instructions: string;
  source: PublishSource;
  answers?: Record<string, string>;
  installationId?: number;
  repo?: string;

  fencedText?: string;
  signals: InjectionSignal[];
  repoFiles: RepoFile[];
  styleRules: StyleRule[];
  agentsInstructions?: string;
  context?: string;
  seed: Record<string, string>;

  approvedPlan?: string;
  planAutoApproved?: boolean;

  artifacts: CriticArtifact[];
  filesWritten: string[];
  snapshot: Record<string, string>;
  refusals: Array<{ rule: string; reason: string; subject: string }>;
  flags: OutputFlag[];
  criticFindings: CriticFinding[];
  criticPass?: boolean;
  criticEnforcement?: string;
  criticRevisePrompt?: string;
  criticErrorCount?: number;
  reviseRound: number;

  pullRequest?: PullRequestResult;
  learned: string[];

  pipelineOk?: boolean;
  pipelineReason?: string;
  pipelineError?: string;
  inputRequired?: { question: string; options: string[] };
};

export type ContentPublishGraphDeps = {
  db: DbClient;
  projectId: string;
  runAgent: AgentRunner;
  /**
   * Phase 7 — optional model critic. When omitted, resolved from
   * `WALKCROACH_ENABLE_MODEL_CRITIC` (default off).
   */
  enableModelCritic?: boolean;
  modelCritic?: ModelCritic;
};

function allowedImportPrefixes(rules: StyleRule[]): string[] {
  const aliasRule = rules.find((r) => r.key === 'import.alias');
  return typeof aliasRule?.value === 'string' && aliasRule.value.trim()
    ? [aliasRule.value.trim()]
    : [];
}

function inferTargetDir(files: RepoFile[]): string | null {
  const hit = files
    .map((f) => f.path)
    .find((p) => /(^|\/)(content|posts|blog)\//.test(p));
  return hit ? hit.slice(0, hit.lastIndexOf('/')) : null;
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function draftPrompt(state: ContentPublishGraphState, revise?: string): string {
  const base = [
    `Create a blog post page titled "${state.title}" from the source document below.`,
    state.instructions,
    "HARD CONSTRAINT: Preserve the author's wording and claims. You format and design; you do not ghostwrite or invent facts.",
    'Use available WalkCroach web skills via load_skill when designing the page (hierarchy, spacing, cards, imagery, a11y). Prefer a considered layout over a bare prose dump when the content supports structure.',
    'Do a brief content visual review before finishing (hierarchy, measure, contrast, mobile).',
    state.noTarget
      ? 'No target repository was provided. Create only new files under the content path using React/TSX blog conventions and WalkCroach design skill defaults.'
      : 'Match the existing repository conventions exactly. Create only new files.',
  ]
    .filter(Boolean)
    .join('\n');

  if (!revise) return base;
  return [base, '', '# CriticGate revision required', revise].join('\n');
}

/**
 * Build the content.publish graph. Callers inject db + AgentRunner (Planner + Draft).
 */
function resolvePublishModelCritic(deps: ContentPublishGraphDeps): {
  enableModelCritic: boolean;
  modelCritic?: ModelCritic;
} {
  if (deps.modelCritic) {
    return {
      enableModelCritic: deps.enableModelCritic !== false,
      modelCritic: deps.modelCritic,
    };
  }
  if (deps.enableModelCritic === false) {
    return { enableModelCritic: false };
  }
  if (deps.enableModelCritic === true) {
    return {
      enableModelCritic: true,
      modelCritic: createTier2HeuristicModelCritic(),
    };
  }
  return resolveModelCriticFromEnv();
}

/**
 * Build the content.publish graph. Callers inject db + AgentRunner (Planner + Draft).
 */
export function buildContentPublishGraph(
  deps: ContentPublishGraphDeps,
): GraphDefinition<ContentPublishGraphState> {
  const resolved = resolvePublishModelCritic(deps);

  return defineGraph<ContentPublishGraphState>({
    id: CONTENT_PUBLISH_GRAPH_ID,
    entry: 'fence',
    maxNodeExecutions: 24,
    defaultNodeTimeoutMs: 600_000,
    nodes: [
      {
        id: 'fence',
        kind: 'code',
        run: async ({ state }) => {
          const fenced = fenceUntrusted({
            content: state.source.text,
            label: `an uploaded ${state.source.kind} document to be published as a blog post`,
            purpose:
              "Convert it into a page for this repository. Preserve the author's words and " +
              'meaning; you are formatting and laying out, not rewriting.',
          });

          if (!state.noTarget) {
            if (state.installationId == null || !state.repo) {
              return {
                signals: fenced.signals,
                fencedText: fenced.text,
                pipelineOk: false,
                pipelineReason: 'github_required',
                pipelineError:
                  'repo and installationId are required unless dryRun with no target',
              };
            }
          }

          let repoFiles: RepoFile[] = [];
          if (!state.noTarget && state.installationId != null && state.repo) {
            const token = await getInstallationToken(state.installationId);
            const repoContext = await readRepoContext({
              token,
              repo: state.repo,
              pathHints: state.targetDir ? [state.targetDir] : undefined,
            });
            repoFiles = repoContext.files;
          }

          const memoryEntries = await listProjectMemoryEntries({
            db: deps.db,
            projectId: deps.projectId,
            limit: 100,
          });
          const memoryRules = parseMemoryRules(memoryEntries);
          const targetDir =
            state.targetDir ||
            inferTargetDir(repoFiles) ||
            'src/content/blog';

          const style = discoverHouseStyle({
            memoryRules,
            repoFiles,
            targetPath: `${targetDir}/placeholder.tsx`,
          });

          const context = [
            style.agentsInstructions,
            renderHouseStyle(style),
            `\n## Where this goes\nWrite the new page under \`${targetDir}\`.`,
            repoFiles.length > 0
              ? `\n## Existing files (for conventions — do not modify them)\n` +
                repoFiles
                  .slice(0, 25)
                  .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 4_000)}`)
                  .join('\n\n')
              : `\n## Existing files\nNo repository was supplied (dry-run / no-target). Use WalkCroach design defaults and any project memory conventions.`,
            `\n## Source document\n${fenced.text}`,
          ]
            .filter(Boolean)
            .join('\n');

          const seed: Record<string, string> = {};
          for (const f of repoFiles) seed[`${WORKSPACE}/${f.path}`] = f.content;

          return {
            fencedText: fenced.text,
            signals: fenced.signals,
            repoFiles,
            targetDir,
            styleRules: style.rules,
            agentsInstructions: style.agentsInstructions,
            context,
            seed,
            pipelineOk: true,
          };
        },
      },
      {
        id: 'plan',
        kind: 'subagent',
        run: async ({ state, emit }) => {
          if (state.pipelineOk === false) return {};

          const run = await deps.runAgent({
            files: state.seed,
            workspaceRoot: WORKSPACE,
            prompt: [
              `Plan how to create a blog post page titled "${state.title}" from the source document.`,
              state.instructions,
              'Explore conventions read-only, then submit a structured plan. Do not implement yet.',
            ]
              .filter(Boolean)
              .join('\n'),
            context: state.context ?? '',
            answers: state.answers,
            role: 'plan',
          });

          if (run.inputRequired || run.reason === 'input_required') {
            return {
              pipelineOk: false,
              pipelineReason: 'input_required',
              inputRequired: run.inputRequired,
              pipelineError: run.error,
              refusals: run.refusals,
            };
          }

          if (!run.ok || !run.approvedPlan) {
            return {
              pipelineOk: false,
              pipelineReason: run.reason || 'plan_failed',
              pipelineError:
                run.error ?? 'Planner did not produce an approved plan',
              refusals: run.refusals,
            };
          }

          await emit('plan.auto_approved', {
            planChars: run.approvedPlan.length,
            reason: run.reason,
          });

          return {
            approvedPlan: run.approvedPlan,
            planAutoApproved: true,
            seed: { ...state.seed, ...run.snapshot },
            refusals: run.refusals,
          };
        },
      },
      {
        id: 'draft',
        kind: 'agent',
        run: async ({ state }) => {
          if (state.pipelineOk === false) return {};
          if (!state.approvedPlan) {
            return {
              pipelineOk: false,
              pipelineReason: 'plan_missing',
              pipelineError:
                'Draft requires an approved plan from the Plan stage',
            };
          }

          const run = await deps.runAgent({
            files: state.seed,
            workspaceRoot: WORKSPACE,
            prompt: draftPrompt(state),
            context: state.context ?? '',
            answers: state.answers,
            role: 'draft',
            approvedPlan: state.approvedPlan,
          });

          if (run.inputRequired || run.reason === 'input_required') {
            return {
              pipelineOk: false,
              pipelineReason: 'input_required',
              inputRequired: run.inputRequired,
              pipelineError: run.error,
              filesWritten: run.filesWritten,
              refusals: run.refusals,
              snapshot: run.snapshot,
            };
          }

          if (!run.ok) {
            return {
              pipelineOk: false,
              pipelineReason: run.reason,
              pipelineError: run.error,
              filesWritten: run.filesWritten,
              refusals: run.refusals,
              snapshot: run.snapshot,
            };
          }

          const produced: CriticArtifact[] = run.filesWritten.map((rel) => ({
            path: rel,
            content: run.snapshot[`${WORKSPACE}/${rel}`] ?? '',
          }));
          const flags = produced.flatMap((f) =>
            inspectGeneratedContent(f.path, f.content),
          );

          if (produced.length === 0) {
            return {
              pipelineOk: false,
              pipelineReason: 'no_files_produced',
              pipelineError: 'the run completed without creating any files',
              filesWritten: [],
              artifacts: [],
              flags,
              refusals: run.refusals,
              snapshot: run.snapshot,
            };
          }

          return {
            artifacts: produced,
            filesWritten: run.filesWritten,
            snapshot: run.snapshot,
            flags,
            refusals: run.refusals,
            seed: { ...state.seed, ...run.snapshot },
          };
        },
      },
      {
        id: 'critique',
        kind: 'gate',
        run: async ({ state, emit }) => {
          if (state.pipelineOk === false) {
            return { criticPass: false };
          }

          const enforcement = await runCriticGate({
            checks: defaultPublishCriticChecks({
              allowedImportPrefixes: allowedImportPrefixes(state.styleRules),
            }),
            context: {
              artifacts: state.artifacts,
              meta: { pipeline: 'content.publish', title: state.title },
            },
            reviseOnError: true,
            enableModelCritic: resolved.enableModelCritic,
            modelCritic: resolved.modelCritic,
            onEvent: async (e) => {
              await emit(e.type, e as unknown as Record<string, unknown>);
            },
          });

          if (enforcement.action === 'pass') {
            return {
              criticPass: true,
              criticEnforcement: 'pass',
              criticRevisePrompt: undefined,
              criticErrorCount: 0,
              criticFindings: enforcement.findings,
            };
          }

          return {
            criticPass: false,
            criticEnforcement: enforcement.action,
            criticRevisePrompt:
              enforcement.action === 'revise'
                ? enforcement.revisePrompt
                : undefined,
            criticErrorCount: enforcement.errorFindings.length,
            criticFindings: enforcement.findings,
          };
        },
      },
      {
        id: 'revise',
        kind: 'agent',
        run: async ({ state }) => {
          if (state.pipelineOk === false) return {};
          const round = (state.reviseRound ?? 0) + 1;
          const run = await deps.runAgent({
            files: state.seed,
            workspaceRoot: WORKSPACE,
            prompt: draftPrompt(
              state,
              state.criticRevisePrompt ??
                'Fix CriticGate errors and resubmit.',
            ),
            context: state.context ?? '',
            answers: state.answers,
            role: 'revise',
            approvedPlan: state.approvedPlan,
          });

          if (!run.ok) {
            return {
              reviseRound: round,
              pipelineOk: false,
              pipelineReason: run.reason,
              pipelineError: run.error,
              filesWritten: run.filesWritten,
              refusals: run.refusals,
              snapshot: run.snapshot,
            };
          }

          const produced: CriticArtifact[] = run.filesWritten.map((rel) => ({
            path: rel,
            content: run.snapshot[`${WORKSPACE}/${rel}`] ?? '',
          }));
          const flags = produced.flatMap((f) =>
            inspectGeneratedContent(f.path, f.content),
          );

          return {
            reviseRound: round,
            artifacts: produced,
            filesWritten: run.filesWritten,
            snapshot: run.snapshot,
            flags,
            refusals: run.refusals,
            seed: { ...state.seed, ...run.snapshot },
            criticPass: undefined,
            criticEnforcement: undefined,
            criticRevisePrompt: undefined,
          };
        },
      },
      {
        id: 'blocked',
        kind: 'code',
        run: async ({ state }) => ({
          pipelineOk: false,
          pipelineReason: 'critic_blocked',
          pipelineError:
            state.criticRevisePrompt ??
            'CriticGate blocked the draft after maximum revise rounds',
        }),
      },
      {
        id: 'open_pr',
        kind: 'code',
        run: async ({ state }) => {
          if (state.pipelineOk === false) return {};
          const produced = state.artifacts.map((a) => ({
            path: a.path,
            content: a.content,
          }));

          let pullRequest: PullRequestResult | undefined;
          if (
            !state.dryRun &&
            !state.noTarget &&
            state.installationId != null &&
            state.repo
          ) {
            const token = await getInstallationToken(state.installationId);
            pullRequest = await openContentPullRequest({
              token,
              repo: state.repo,
              branch: contentBranchName(state.title, shortId()),
              files: produced,
              title: `Add blog post: ${state.title}`,
              body: renderPrBody({
                title: state.title,
                source: state.source,
                files: produced.map((f) => f.path),
                style: state.styleRules,
                signals: state.signals,
                flags: state.flags,
                refusals: state.refusals,
              }),
            });
          }

          return {
            pullRequest,
            pipelineOk: true,
            pipelineReason: 'completed',
          };
        },
      },
      {
        id: 'remember',
        kind: 'code',
        run: async ({ state }) => {
          if (state.pipelineOk === false) return { learned: [] as string[] };
          const learned: string[] = [];
          for (const rule of state.styleRules) {
            if (rule.source === 'memory') continue;
            if (!DURABLE_KEYS.has(rule.key)) continue;
            await writeMemoryEntry({
              db: deps.db,
              projectId: deps.projectId,
              sourceSurface: 'sdk',
              kind: 'convention',
              text: ruleToMemoryText(rule),
            });
            learned.push(rule.key);
          }
          return { learned };
        },
      },
    ],
    edges: [
      {
        from: 'fence',
        to: 'plan',
        when: (s) => s.pipelineOk !== false,
      },
      {
        from: 'fence',
        to: null,
        when: (s) => s.pipelineOk === false,
      },
      {
        from: 'plan',
        to: 'draft',
        when: (s) => s.pipelineOk !== false && Boolean(s.approvedPlan),
      },
      {
        from: 'plan',
        to: null,
        when: (s) => s.pipelineOk === false,
      },
      {
        from: 'draft',
        to: 'critique',
        when: (s) => s.pipelineOk !== false,
      },
      {
        from: 'draft',
        to: null,
        when: (s) => s.pipelineOk === false,
      },
      {
        from: 'critique',
        to: 'open_pr',
        when: (s) => Boolean(s.criticPass),
      },
      {
        from: 'critique',
        to: 'revise',
        when: (s) =>
          !s.criticPass && (s.reviseRound ?? 0) < MAX_REVISE_ROUNDS,
      },
      {
        from: 'critique',
        to: 'blocked',
        when: (s) =>
          !s.criticPass && (s.reviseRound ?? 0) >= MAX_REVISE_ROUNDS,
      },
      { from: 'revise', to: 'critique' },
      { from: 'blocked', to: null },
      { from: 'open_pr', to: 'remember' },
      { from: 'remember', to: null },
    ],
  });
}

/** Initial graph state from publishContent params. */
export function initialContentPublishState(params: {
  source: PublishSource;
  instructions?: string;
  targetDir?: string;
  dryRun?: boolean;
  noTarget?: boolean;
  installationId?: number;
  repo?: string;
  answers?: Record<string, string>;
}): ContentPublishGraphState {
  const noTarget = Boolean(params.noTarget || (params.dryRun && !params.repo));
  return {
    title: deriveTitle(params.source),
    noTarget,
    dryRun: Boolean(params.dryRun),
    targetDir: params.targetDir ?? '',
    instructions: params.instructions ?? '',
    source: params.source,
    answers: params.answers,
    installationId: params.installationId,
    repo: params.repo,
    signals: [],
    repoFiles: [],
    styleRules: [],
    seed: {},
    artifacts: [],
    filesWritten: [],
    snapshot: {},
    refusals: [],
    flags: [],
    criticFindings: [],
    reviseRound: 0,
    learned: [],
  };
}
