/**
 * The content-publishing pipeline: a document in, a pull request out.
 *
 * Sequence, and why each step is where it is:
 *
 *   1. **Fence** the uploaded document as untrusted data. It is the least
 *      trusted input in the system — written by a non-technical author and
 *      uploaded through a form — so it is delimited before it is anywhere near
 *      the model's instructions.
 *   2. **Read** the target repository over the GitHub API. No clone, no
 *      sandbox: conventions live in config and shared components, and both are
 *      readable without executing anything.
 *   3. **Discover** house style — memory, then AGENTS.md, then inference, then
 *      WalkCroach design skills. Nobody is asked to approve any of it.
 *   4. **Run** the agent loop over an in-memory filesystem, additive scope.
 *   5. **Inspect** what it produced, because fencing is a mitigation and not a
 *      guarantee.
 *   6. **Open** a pull request. The customer's own CI verifies it and a human
 *      merges it — that is the review, and it is why no build step is needed.
 *   7. **Remember** what was learned, so post #47 matches post #1.
 *
 * The agent run itself is injected rather than imported. `@walkcroach/sdk-host`
 * lives outside `infra-backend`, and inverting the dependency keeps this
 * pipeline unit-testable without a model, a sandbox, or a network.
 */
import type { DbClient } from '@walkcroach/db';
import {
  contentBranchName,
  getInstallationToken,
  openContentPullRequest,
  readRepoContext,
  type PullRequestResult,
  type RepoFile,
} from './github-pr.js';
import { discoverHouseStyle, renderHouseStyle, ruleToMemoryText } from './house-style.js';
import { parseMemoryRules, type StyleRule } from './house-style.js';
import { listProjectMemoryEntries, writeMemoryEntry } from './memory.js';
import {
  fenceUntrusted,
  inspectGeneratedContent,
  renderSecurityNotes,
  type InjectionSignal,
  type OutputFlag,
} from './untrusted-content.js';

/** What the caller supplies to actually run the agent. */
export type AgentRunner = (params: {
  /** Seed filesystem: the repo files we read, keyed by absolute path. */
  files: Record<string, string>;
  workspaceRoot: string;
  prompt: string;
  context: string;
  /** Pre-answered ask_user keys (from a prior resume). */
  answers?: Record<string, string>;
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
  pullRequest?: PullRequestResult;
  filesWritten: string[];
  /** Injection heuristics that matched the source document. */
  signals: InjectionSignal[];
  /** Red flags in what the agent generated. */
  flags: OutputFlag[];
  refusals: Array<{ rule: string; reason: string; subject: string }>;
  /** House-style rules newly learned and written to memory. */
  learned: string[];
  reason: string;
  error?: string;
  /** When set, the durable run should interrupt (not fail). */
  inputRequired?: { question: string; options: string[] };
};

const WORKSPACE = '/workspace';

/** Title from an explicit value, an H1, or the filename — in that order. */
export function deriveTitle(source: PublishSource): string {
  if (source.title?.trim()) return source.title.trim();
  const h1 = /^#\s+(.+)$/m.exec(source.text);
  if (h1?.[1]) return h1[1].trim();
  if (source.filename) return source.filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  return 'New post';
}

export async function publishContent(params: {
  db: DbClient;
  projectId: string;
  /** GitHub App installation for the target repo. */
  installationId: number;
  repo: string;
  /** Where posts live; inferred from the repo when omitted. */
  targetDir?: string;
  source: PublishSource;
  /** Extra instruction from the caller, e.g. "technical audience". */
  instructions?: string;
  runAgent: AgentRunner;
  /** Skip the PR and return the files instead. */
  dryRun?: boolean;
  /** Resume answers from a prior interrupt (ask_user question → answer). */
  answers?: Record<string, string>;
}): Promise<PublishResult> {
  const title = deriveTitle(params.source);

  // ── 1. Fence the document before it is anywhere near the instructions ────
  const fenced = fenceUntrusted({
    content: params.source.text,
    label: `an uploaded ${params.source.kind} document to be published as a blog post`,
    purpose:
      'Convert it into a page for this repository. Preserve the author\'s words and ' +
      'meaning; you are formatting and laying out, not rewriting.',
  });

  // ── 2. Read the target repository ───────────────────────────────────────
  const token = await getInstallationToken(params.installationId);
  const repoContext = await readRepoContext({
    token,
    repo: params.repo,
    pathHints: params.targetDir ? [params.targetDir] : undefined,
  });

  // ── 3. Discover house style ─────────────────────────────────────────────
  const memoryEntries = await listProjectMemoryEntries({
    db: params.db,
    projectId: params.projectId,
    limit: 100,
  });
  const memoryRules = parseMemoryRules(memoryEntries);

  const targetDir =
    params.targetDir ??
    // The repo's own answer beats ours; only guess when it has not said.
    inferTargetDir(repoContext.files) ??
    'src/content/blog';

  const style = discoverHouseStyle({
    memoryRules,
    repoFiles: repoContext.files,
    targetPath: `${targetDir}/placeholder.tsx`,
  });

  const context = [
    style.agentsInstructions,
    renderHouseStyle(style),
    `\n## Where this goes\nWrite the new page under \`${targetDir}\`.`,
    `\n## Existing files (for conventions — do not modify them)\n` +
      repoContext.files
        .slice(0, 25)
        .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 4_000)}`)
        .join('\n\n'),
    `\n## Source document\n${fenced.text}`,
  ]
    .filter(Boolean)
    .join('\n');

  // ── 4. Run ──────────────────────────────────────────────────────────────
  const seed: Record<string, string> = {};
  for (const f of repoContext.files) seed[`${WORKSPACE}/${f.path}`] = f.content;

  const run = await params.runAgent({
    files: seed,
    workspaceRoot: WORKSPACE,
    prompt: [
      `Create a blog post page titled "${title}" from the source document below.`,
      params.instructions ?? '',
      'Match the existing repository conventions exactly. Create only new files.',
    ]
      .filter(Boolean)
      .join('\n'),
    context,
    answers: params.answers,
  });

  if (run.inputRequired || run.reason === 'input_required') {
    return {
      ok: false,
      filesWritten: run.filesWritten,
      signals: fenced.signals,
      flags: [],
      refusals: run.refusals,
      learned: [],
      reason: 'input_required',
      inputRequired: run.inputRequired ?? {
        question: run.error ?? 'input required',
        options: [],
      },
      ...(run.error ? { error: run.error } : {}),
    };
  }

  if (!run.ok) {
    return {
      ok: false,
      filesWritten: run.filesWritten,
      signals: fenced.signals,
      flags: [],
      refusals: run.refusals,
      learned: [],
      reason: run.reason,
      ...(run.error ? { error: run.error } : {}),
    };
  }

  // ── 5. Inspect the output ───────────────────────────────────────────────
  const produced: RepoFile[] = run.filesWritten.map((rel) => ({
    path: rel,
    content: run.snapshot[`${WORKSPACE}/${rel}`] ?? '',
  }));

  const flags = produced.flatMap((f) => inspectGeneratedContent(f.path, f.content));

  if (produced.length === 0) {
    return {
      ok: false,
      filesWritten: [],
      signals: fenced.signals,
      flags,
      refusals: run.refusals,
      learned: [],
      reason: 'no_files_produced',
      error: 'the run completed without creating any files',
    };
  }

  // ── 6. Pull request ─────────────────────────────────────────────────────
  let pullRequest: PullRequestResult | undefined;
  if (!params.dryRun) {
    pullRequest = await openContentPullRequest({
      token,
      repo: params.repo,
      branch: contentBranchName(title, shortId()),
      files: produced,
      title: `Add blog post: ${title}`,
      body: renderPrBody({
        title,
        source: params.source,
        files: produced.map((f) => f.path),
        style: style.rules,
        signals: fenced.signals,
        flags,
        refusals: run.refusals,
      }),
    });
  }

  // ── 7. Remember ─────────────────────────────────────────────────────────
  // Only rules that did not already come from memory, so the same fact is not
  // rewritten every run. The supersede path handles genuine changes of mind.
  const learned: string[] = [];
  for (const rule of style.rules) {
    if (rule.source === 'memory') continue;
    if (!DURABLE_KEYS.has(rule.key)) continue;
    await writeMemoryEntry({
      db: params.db,
      projectId: params.projectId,
      sourceSurface: 'sdk',
      kind: 'convention',
      text: ruleToMemoryText(rule),
    });
    learned.push(rule.key);
  }

  return {
    ok: true,
    ...(pullRequest ? { pullRequest } : {}),
    filesWritten: run.filesWritten,
    signals: fenced.signals,
    flags,
    refusals: run.refusals,
    learned,
    reason: run.reason,
  };
}

/**
 * Conventions worth persisting.
 *
 * An allowlist rather than "everything": skill defaults are ours already and
 * writing them back would fill a customer's memory with our own boilerplate,
 * making the genuinely project-specific entries harder to find.
 */
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

function inferTargetDir(files: RepoFile[]): string | null {
  const hit = files.map((f) => f.path).find((p) => /(^|\/)(content|posts|blog)\//.test(p));
  return hit ? hit.slice(0, hit.lastIndexOf('/')) : null;
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
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
      // Surfaced rather than hidden: a refusal often explains why the result is
      // narrower than expected, and a reviewer should not have to guess.
      ...params.refusals.map((r) => `- \`${r.rule}\` — ${r.subject}`),
    );
  }

  const security = renderSecurityNotes({ signals: params.signals, flags: params.flags });
  if (security) sections.push('', security);

  sections.push(
    '',
    '---',
    '_This branch adds files only; no existing file was modified. Your CI verifies the build._',
  );

  return sections.join('\n');
}
