import type { HostAdapter } from '../host.js';
import { truncateText } from '../truncate.js';
import {
  mergeWalkcroachAppend,
  readWalkcroachMd,
  WALKCROACH_MD,
} from '../memory-local.js';
import type { ParsedToolUse } from '../bedrock.js';
import { READ_ONLY_TOOL_NAMES } from './defs.js';
import {
  CockroachMcpClient,
  isMcpWriteTool,
  type McpServerRegistry,
} from '../mcp.js';
import type { SkillsRegistry } from '../skills.js';
import { ensureJsonOutput, runCcloud, plainCcloudError } from '../ccloud.js';
import type { TelemetrySink } from '../telemetry.js';
import type { ProjectMemoryBridge } from '../project-memory.js';
import type { SharedSkillsBridge } from '../shared-skills.js';
import type { WorkspacePolicy } from '../workspace-policy.js';
import { isVerifyCommand, loadRuleBody } from '../workspace-config.js';
import { recordCheckpoint } from '../checkpoints.js';
import { embedText } from '../bedrock.js';
import {
  semanticSearch,
  updateIndex,
  DEFAULT_MAX_INDEX_FILES,
} from '../local-index.js';
import { applyPatchEdits, applyUniqueReplace, normalizePatchEdits } from '../patch.js';
import {
  buildStdinPayload,
  MAX_STDIN_REPLIES,
} from '../stream-shell.js';
import { enterGitWorktree, exitGitWorktree } from '../worktree.js';
import { dispatchTool } from './dispatch.js';
import {
  assertEditAnchorAllowed,
  clearEditAnchorsForPath,
  recordEditAnchorFailure,
} from '../edit-anchor-guard.js';
import {
  assertPathEditAllowed,
  clearPathEditMismatches,
  recordPathEditMismatch,
} from '../edit-path-mismatch-guard.js';
import {
  formatEditMismatchError,
  recordReadFreshness,
} from '../read-freshness.js';

async function buildEditMismatchError(
  opts: ExecuteToolOptions,
  args: {
    path: string;
    reason: string;
    content: string;
    oldStr?: string;
    oldStrs?: string[];
  },
): Promise<Error> {
  if (opts.readFreshness) {
    recordReadFreshness(opts.readFreshness, args.path, {
      content: args.content,
      mtimeMs: await getMtimeMs(opts, args.path),
    });
  }
  const pathMismatch = recordPathEditMismatch(
    opts.editPathMismatches,
    args.path,
    { content: args.content },
  );
  return new Error(
    formatEditMismatchError({
      path: args.path,
      reason: args.reason,
      content: args.content,
      oldStr: args.oldStr,
      oldStrs: args.oldStrs,
      pathMismatch: pathMismatch.count
        ? {
            count: pathMismatch.count,
            limit: pathMismatch.limit,
            blocked: pathMismatch.blocked,
            smallFile: pathMismatch.smallFile,
            lineCount: pathMismatch.lineCount,
          }
        : undefined,
    }),
  );
}

function clearEditGuardsForPath(opts: ExecuteToolOptions, path: string): void {
  clearEditAnchorsForPath(opts.editAnchorFails, path);
  clearPathEditMismatches(opts.editPathMismatches, path);
}

export type ToolExecResult = {
  toolUseId: string;
  content: string;
  status: 'success' | 'error' | 'rejected';
};

export type ExecuteToolOptions = {
  host: HostAdapter;
  tool: ParsedToolUse;
  signal?: AbortSignal;
  /** When true, reject write/terminal/subagent tools. */
  readOnly?: boolean;
  /** Injected to avoid circular import with subagents/loop. */
  spawnSubagent?: (args: {
    name: string;
    prompt: string;
    signal?: AbortSignal;
    role?: 'planner' | 'critic' | 'default';
  }) => Promise<string>;
  /** Phase B context */
  mcp?: CockroachMcpClient | null;
  /** Additional MCP servers from .walkcroach/mcp.json (mcp_call) — separate from mcp/cockroach_mcp. */
  mcpServers?: Pick<McpServerRegistry, 'callTool'> | null;
  skills?: SkillsRegistry | null;
  telemetry?: TelemetrySink | null;
  ccloudApiKey?: string;
  /** Phase C — shared project memory when linked */
  projectMemory?: ProjectMemoryBridge | null;
  /** Cross-surface shared skill library — available whenever signed in */
  sharedSkills?: SharedSkillsBridge | null;
  /** P1 — settings / verify recipes */
  policy?: WorkspacePolicy | null;
  /** P2 — current agent turn, for checkpoint/revert. Unset → checkpoints are not recorded. */
  turnId?: string;
  /** P3 — local semantic index settings (.walkcroach/settings.json index). Unset → enabled with defaults. */
  indexSettings?: { enabled: boolean; maxFiles: number };
  /** Phase 1 — stale-read tracker (only enforced when host.supportsMtimeFreshness). */
  readFreshness?: import('../read-freshness.js').ReadFreshnessTracker | null;
  /**
   * Failed edit/patch old_str anchors for this run.
   * Cleared per-path only on successful mutate (not on read_file).
   */
  editAnchorFails?: import('../edit-anchor-guard.js').EditAnchorFailCache | null;
  /**
   * Consecutive edit_mismatch counts per path; blocks surgical edits after N.
   */
  editPathMismatches?: import('../edit-path-mismatch-guard.js').EditPathMismatchState | null;
  /**
   * Phase 2 — when true, submit_plan is allowed (Planner subagent only).
   * Main agent must use present_plan, not submit_plan.
   */
  plannerMode?: boolean;
  /** Called when Planner successfully submit_plan's. */
  onPlanSubmitted?: (planPath: string) => void;
  /**
   * Phase 2 — mutable session bag for present_plan outcomes (owned by the loop).
   */
  planSession?: {
    autoApprove: boolean;
    /** Set when user Approves or auto-approves. */
    approvedPlan: string | null;
    approvedPlanPath: string | null;
    /** Set when user chooses Revise (free text / selected). */
    reviseFeedback: string | null;
  };
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function assertPathAllowed(
  policy: WorkspacePolicy | null | undefined,
  path: string,
): void {
  if (policy?.isDeniedPath(path)) {
    throw new Error(
      `Path denied by .walkcroach/settings.json (or built-in sensitive list): ${path}`,
    );
  }
}

async function getMtimeMs(
  opts: ExecuteToolOptions,
  path: string,
): Promise<number | null> {
  const host = opts.host;
  if (!host.supportsMtimeFreshness || !host.getFileMtimeMs) return null;
  try {
    return await host.getFileMtimeMs(path);
  } catch {
    return null;
  }
}

async function noteReadFreshness(
  opts: ExecuteToolOptions,
  path: string,
  content: string,
): Promise<void> {
  const tracker = opts.readFreshness;
  if (!tracker) return;
  const { recordReadFreshness } = await import('../read-freshness.js');
  const mtimeMs = await getMtimeMs(opts, path);
  recordReadFreshness(tracker, path, { content, mtimeMs });
}

/**
 * Content-aware freshness gate. Always runs when a tracker is present
 * (hash-based; mtime optional). On reject, refreshes tracker to current bytes.
 */
async function gateMutationFreshness(
  opts: ExecuteToolOptions,
  params: {
    path: string;
    currentContent: string | null;
    kind: 'write_file' | 'edit_file' | 'apply_patch';
    oldStr?: string;
    oldStrs?: string[];
  },
): Promise<string | undefined> {
  const tracker = opts.readFreshness;
  if (!tracker) return undefined;
  const { evaluateMutationFreshness, recordReadFreshness } = await import(
    '../read-freshness.js'
  );
  const mtimeMs = await getMtimeMs(opts, params.path);
  const check = evaluateMutationFreshness({
    tracker,
    path: params.path,
    currentContent: params.currentContent,
    currentMtimeMs: mtimeMs,
    kind: params.kind,
    oldStr: params.oldStr,
    oldStrs: params.oldStrs,
  });
  if (!check.ok) {
    if (params.currentContent !== null) {
      recordReadFreshness(tracker, params.path, {
        content: params.currentContent,
        mtimeMs,
      });
    }
    throw new Error(check.message);
  }
  return check.note;
}

/**
 * Public tool entry — always validate → execute → observe (P3.1).
 * Callers must not invoke `executeToolBody` directly.
 */
export async function executeTool(
  opts: ExecuteToolOptions,
): Promise<ToolExecResult> {
  return dispatchTool(opts, executeToolBody);
}

async function executeToolBody(
  opts: ExecuteToolOptions,
): Promise<ToolExecResult> {
  const { host, tool, signal } = opts;
  const id = tool.toolUseId;
  const name = tool.name;
  const input = tool.input;

  host.emit({
    type: 'tool_card',
    id,
    name,
    status: 'pending',
    detail: summarizeInput(name, input),
  });

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    if (opts.readOnly && !READ_ONLY_TOOL_NAMES.has(name)) {
      throw new Error(`Tool ${name} is not allowed in read-only sub-agent mode`);
    }

    let content: string;

    switch (name) {
      case 'read_file': {
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        const path = str(input.path);
        const raw = await host.readFile(path);
        await noteReadFreshness(opts, path, raw);
        // Do NOT clear edit-anchor fail cache here — re-read must not unlock
        // the same bad old_str (models otherwise thrash after read_file).
        content = truncateText(raw).text;
        break;
      }
      case 'list_dir': {
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        const path = str(input.path || '.');
        const entries = await host.listDir(path);
        content = truncateText(entries.join('\n')).text;
        break;
      }
      case 'search': {
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        const pattern = str(input.pattern);
        const glob = input.glob ? str(input.glob) : undefined;
        const hits = await host.search(pattern, { glob, signal });
        content = truncateText(
          hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n') ||
            '(no matches)',
        ).text;
        break;
      }
      case 'glob': {
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        const pattern = str(input.pattern);
        if (!pattern) throw new Error('glob requires pattern');
        if (!host.glob) {
          throw new Error('glob is not supported on this host');
        }
        const files = await host.glob(pattern, { signal });
        content = truncateText(
          files.length ? files.join('\n') : '(no matches)',
        ).text;
        break;
      }
      case 'semantic_search': {
        const query = str(input.query);
        if (!query.trim()) {
          throw new Error('semantic_search requires a non-empty query');
        }
        const root = host.getWorkspaceRoot();
        if (!root) throw new Error('No workspace folder open');
        if (opts.indexSettings?.enabled === false) {
          throw new Error(
            'Semantic search is disabled (.walkcroach/settings.json index.enabled: false).',
          );
        }
        const maxFiles = opts.indexSettings?.maxFiles ?? DEFAULT_MAX_INDEX_FILES;
        const topK = typeof input.top_k === 'number' ? input.top_k : undefined;
        host.emit({ type: 'tool_card', id, name, status: 'running', detail: query });
        let hits;
        try {
          await updateIndex(root, (t) => embedText(t), { maxFiles });
          hits = await semanticSearch(root, (t) => embedText(t), query, { topK });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Semantic search failed (requires Bedrock credentials, same as chat): ${message}`,
          );
        }
        content = truncateText(
          hits.length
            ? hits
                .map(
                  (h, i) =>
                    `${i + 1}. ${h.path}:${h.startLine}-${h.endLine} (score ${h.score.toFixed(3)})\n${h.snippet}`,
                )
                .join('\n\n')
            : 'No semantically related results found.',
        ).text;
        opts.telemetry?.bump('semantic_search');
        host.emit({
          type: 'telemetry',
          name: 'semantic_search',
          counters: opts.telemetry?.counters,
          detail: query,
        });
        break;
      }
      case 'todo_write': {
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        const { normalizeTodos, formatTodosForModel } = await import(
          '../todos.js'
        );
        const todos = normalizeTodos(input.todos);
        host.emit({ type: 'todos', todos });
        if (host.persistTodos) {
          await host.persistTodos(todos);
        }
        content = formatTodosForModel(todos);
        break;
      }
      case 'await_terminal': {
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        const taskId = str(input.task_id).trim();
        if (!taskId) throw new Error('await_terminal requires task_id');
        if (!host.pollBackgroundTerminal) {
          throw new Error('Background terminals are not supported on this host');
        }
        const poll = await host.pollBackgroundTerminal(taskId);
        content = [
          `task_id: ${poll.taskId}`,
          `status: ${poll.status}`,
          `exit_code: ${poll.exitCode ?? 'n/a'}`,
          `log: ${poll.logPath}`,
          '--- log tail ---',
          poll.logTail || '(empty)',
        ].join('\n');
        break;
      }
      case 'terminal_session': {
        const action = str(input.action).trim().toLowerCase();
        if (!action) throw new Error('terminal_session requires action');
        if (
          !host.startTerminalSession ||
          !host.writeTerminalSession ||
          !host.readTerminalSession ||
          !host.closeTerminalSession ||
          !host.listTerminalSessions
        ) {
          throw new Error(
            'Interactive terminal sessions are not supported on this host',
          );
        }

        if (action === 'list') {
          host.emit({ type: 'tool_card', id, name, status: 'running' });
          const sessions = await host.listTerminalSessions();
          content =
            sessions.length === 0
              ? 'No interactive sessions.'
              : sessions
                  .map(
                    (s) =>
                      `${s.sessionId}  ${s.status}  backend=${s.backend}  ${s.cmd}`,
                  )
                  .join('\n');
          break;
        }

        if (action === 'start') {
          const cmd = str(input.cmd).trim();
          if (!cmd) throw new Error('terminal_session start requires cmd');
          const relCwd = str(input.cwd || '.').trim() || '.';
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'pending',
            detail: `start: ${cmd}`,
          });
          const decision = await host.confirmCommand(
            relCwd !== '.' ? `${cmd}  # cwd=${relCwd} (session)` : `${cmd}  # session`,
            { toolName: 'terminal_session', stepId: id },
          );
          if (decision !== 'approve') {
            host.emit({
              type: 'tool_card',
              id,
              name,
              status: 'done',
              detail: 'rejected by user',
            });
            return {
              toolUseId: id,
              content: 'User rejected the terminal session.',
              status: 'rejected',
            };
          }
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'running',
            detail: `start: ${cmd}`,
          });
          const root = host.getWorkspaceRoot();
          if (!root) throw new Error('No workspace root');
          const pathMod = await import('node:path');
          const cwd = pathMod.resolve(root, relCwd);
          const rootRes = pathMod.resolve(root);
          const relCheck = pathMod.relative(rootRes, cwd);
          if (relCheck.startsWith('..') || pathMod.isAbsolute(relCheck)) {
            throw new Error(`cwd escapes workspace: ${relCwd}`);
          }
          const cols =
            typeof input.cols === 'number' && Number.isFinite(input.cols)
              ? Math.max(20, Math.min(300, Math.floor(input.cols)))
              : undefined;
          const rows =
            typeof input.rows === 'number' && Number.isFinite(input.rows)
              ? Math.max(5, Math.min(120, Math.floor(input.rows)))
              : undefined;
          const info = await host.startTerminalSession({
            cmd,
            cwd,
            cols,
            rows,
          });
          content = [
            `session_id: ${info.sessionId}`,
            `backend: ${info.backend}`,
            `status: ${info.status}`,
            `cmd: ${info.cmd}`,
            `cwd: ${info.cwd}`,
            'Next: terminal_session action=write then action=read. Close when done.',
            info.backend === 'pipe'
              ? 'Note: pipe backend (no native PTY). Line REPLs work; full-screen TUIs may be limited. Install optional node-pty for true PTY when available.'
              : 'Native PTY backend active.',
          ].join('\n');
          break;
        }

        const sessionId = str(input.session_id).trim();
        if (!sessionId) {
          throw new Error(`terminal_session ${action} requires session_id`);
        }

        if (action === 'write') {
          const payload = str(input.input ?? '');
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'running',
            detail: `write → ${sessionId}`,
          });
          await host.writeTerminalSession(sessionId, payload, {
            appendNewline: input.append_newline !== false,
          });
          content = `Wrote ${payload.length} chars to session ${sessionId}. Call read to collect output.`;
          break;
        }

        if (action === 'read') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'running',
            detail: `read ← ${sessionId}`,
          });
          const timeoutRaw = input.timeout_ms;
          const settleRaw = input.settle_ms;
          const timeoutMs =
            typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw)
              ? Math.max(200, Math.min(120_000, Math.floor(timeoutRaw)))
              : undefined;
          const settleMs =
            typeof settleRaw === 'number' && Number.isFinite(settleRaw)
              ? Math.max(50, Math.min(5_000, Math.floor(settleRaw)))
              : undefined;
          const result = await host.readTerminalSession(sessionId, {
            timeoutMs,
            settleMs,
          });
          content = [
            `session_id: ${result.sessionId}`,
            `status: ${result.status}`,
            `exit_code: ${result.exitCode ?? 'n/a'}`,
            `backend: ${result.backend}`,
            `settled: ${result.settled}`,
            '--- output ---',
            truncateText(result.output || '(no new output)').text,
          ].join('\n');
          break;
        }

        if (action === 'close') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'running',
            detail: `close ${sessionId}`,
          });
          const closed = await host.closeTerminalSession(sessionId);
          content = closed
            ? `Closed session ${sessionId}.`
            : `Session ${sessionId} not found (already closed).`;
          break;
        }

        throw new Error(
          `Unknown terminal_session action: ${action} (use start|write|read|close|list)`,
        );
      }
      case 'ask_user': {
        const question = str(input.question).trim();
        if (!question) throw new Error('ask_user requires question');
        const optionsRaw = input.options;
        if (!Array.isArray(optionsRaw) || optionsRaw.length < 2) {
          throw new Error('ask_user requires at least 2 options');
        }
        if (optionsRaw.length > 6) {
          throw new Error('ask_user allows at most 6 options');
        }
        const options = optionsRaw.map((o) => String(o).trim()).filter(Boolean);
        if (options.length < 2) {
          throw new Error('ask_user requires at least 2 non-empty options');
        }
        const allowFreeText = Boolean(input.allow_free_text);
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'pending',
          detail: question.slice(0, 120),
        });
        const answer = await host.askUser({
          question,
          options,
          allowFreeText,
          stepId: id,
        });
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: answer.selected,
        });
        content = answer.selected === '(skipped)'
          ? 'User skipped the question without choosing an option.'
          : answer.freeText?.trim()
            ? `User selected: ${answer.selected}\nFree text: ${answer.freeText.trim()}`
            : `User selected: ${answer.selected}`;
        break;
      }
      case 'write_file': {
        const path = str(input.path);
        assertPathAllowed(opts.policy, path);
        const next = str(input.content);
        let before = '';
        let beforeExisted = true;
        try {
          before = await host.readFile(path);
        } catch {
          before = '';
          beforeExisted = false;
        }
        await gateMutationFreshness(opts, {
          path,
          currentContent: beforeExisted ? before : null,
          kind: 'write_file',
        });
        const decision = await host.showDiffPreview(path, before, next, {
          toolName: 'write_file',
          stepId: id,
          input: { path, content: next },
        });
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected the file write.',
            status: 'rejected',
          };
        }
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        // Re-check immediately before write (formatter race).
        let latest = before;
        let latestExisted = beforeExisted;
        try {
          latest = await host.readFile(path);
          latestExisted = true;
        } catch {
          latest = '';
          latestExisted = false;
        }
        await gateMutationFreshness(opts, {
          path,
          currentContent: latestExisted ? latest : null,
          kind: 'write_file',
        });
        await host.writeFile(path, next);
        clearEditGuardsForPath(opts, path);
        await noteReadFreshness(opts, path, next);
        if (opts.turnId) {
          await recordCheckpoint(host.getWorkspaceRoot(), {
            turnId: opts.turnId,
            toolUseId: id,
            path,
            before: latest,
            beforeExisted: latestExisted,
            after: next,
          });
        }
        content = `Wrote ${path} (${next.length} chars)`;
        break;
      }
      case 'edit_file': {
        const path = str(input.path);
        assertPathAllowed(opts.policy, path);
        const old_str = str(input.old_str);
        const new_str = str(input.new_str);
        if (!old_str) {
          throw new Error('edit_file requires a non-empty old_str');
        }
        assertPathEditAllowed(opts.editPathMismatches, path);
        try {
          assertEditAnchorAllowed(opts.editAnchorFails, path, [old_str]);
        } catch (err) {
          recordPathEditMismatch(opts.editPathMismatches, path);
          throw err;
        }
        const before = await host.readFile(path);
        const freshnessNote = await gateMutationFreshness(opts, {
          path,
          currentContent: before,
          kind: 'edit_file',
          oldStr: old_str,
        });
        let after: string;
        try {
          after = applyUniqueReplace(before, old_str, new_str);
        } catch (err) {
          recordEditAnchorFailure(opts.editAnchorFails, path, [old_str]);
          throw await buildEditMismatchError(opts, {
            path,
            reason:
              err instanceof Error
                ? `${err.message} in ${path}`
                : `old_str not found in ${path}`,
            content: before,
            oldStr: old_str,
          });
        }
        const decision = await host.showDiffPreview(path, before, after, {
          toolName: 'edit_file',
          stepId: id,
          input: { path, old_str, new_str },
        });
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected the file edit.',
            status: 'rejected',
          };
        }
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        const latest = await host.readFile(path);
        await gateMutationFreshness(opts, {
          path,
          currentContent: latest,
          kind: 'edit_file',
          oldStr: old_str,
        });
        let latestAfter: string;
        try {
          latestAfter = applyUniqueReplace(latest, old_str, new_str);
        } catch (err) {
          recordEditAnchorFailure(opts.editAnchorFails, path, [old_str]);
          throw await buildEditMismatchError(opts, {
            path,
            reason:
              err instanceof Error
                ? `${err.message} in ${path} after approval (file changed).`
                : `old_str no longer uniquely matches ${path} after approval (file changed).`,
            content: latest,
            oldStr: old_str,
          });
        }
        await host.writeFile(path, latestAfter);
        clearEditGuardsForPath(opts, path);
        await noteReadFreshness(opts, path, latestAfter);
        if (opts.turnId) {
          await recordCheckpoint(host.getWorkspaceRoot(), {
            turnId: opts.turnId,
            toolUseId: id,
            path,
            before: latest,
            beforeExisted: true,
            after: latestAfter,
          });
        }
        content = freshnessNote
          ? `Edited ${path}\n${freshnessNote}`
          : `Edited ${path}`;
        break;
      }
      case 'apply_patch': {
        const path = str(input.path);
        assertPathAllowed(opts.policy, path);
        const edits = normalizePatchEdits(input.edits);
        const oldStrs = edits.map((e) => e.old_str);
        assertPathEditAllowed(opts.editPathMismatches, path);
        try {
          assertEditAnchorAllowed(opts.editAnchorFails, path, oldStrs);
        } catch (err) {
          recordPathEditMismatch(opts.editPathMismatches, path);
          throw err;
        }
        const before = await host.readFile(path);
        const freshnessNote = await gateMutationFreshness(opts, {
          path,
          currentContent: before,
          kind: 'apply_patch',
          oldStrs,
        });
        let after: string;
        try {
          after = applyPatchEdits(before, edits);
        } catch (err) {
          recordEditAnchorFailure(opts.editAnchorFails, path, oldStrs);
          throw await buildEditMismatchError(opts, {
            path,
            reason: err instanceof Error ? err.message : String(err),
            content: before,
            oldStrs,
          });
        }
        if (before === after) {
          throw new Error('apply_patch produced no changes');
        }
        const decision = await host.showDiffPreview(path, before, after, {
          toolName: 'apply_patch',
          stepId: id,
          input: { path, edits },
        });
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected the patch.',
            status: 'rejected',
          };
        }
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        const latest = await host.readFile(path);
        await gateMutationFreshness(opts, {
          path,
          currentContent: latest,
          kind: 'apply_patch',
          oldStrs: edits.map((e) => e.old_str),
        });
        let latestAfter: string;
        try {
          latestAfter = applyPatchEdits(latest, edits);
        } catch (err) {
          recordEditAnchorFailure(opts.editAnchorFails, path, oldStrs);
          throw await buildEditMismatchError(opts, {
            path,
            reason: err instanceof Error ? err.message : String(err),
            content: latest,
            oldStrs,
          });
        }
        if (host.applyDiff) {
          await host.applyDiff(path, JSON.stringify(edits));
        } else {
          await host.writeFile(path, latestAfter);
        }
        clearEditGuardsForPath(opts, path);
        await noteReadFreshness(opts, path, latestAfter);
        if (opts.turnId) {
          await recordCheckpoint(host.getWorkspaceRoot(), {
            turnId: opts.turnId,
            toolUseId: id,
            path,
            before: latest,
            beforeExisted: true,
            after: latestAfter,
          });
        }
        content = freshnessNote
          ? `Patched ${path} (${edits.length} edit${edits.length === 1 ? '' : 's'})\n${freshnessNote}`
          : `Patched ${path} (${edits.length} edit${edits.length === 1 ? '' : 's'})`;
        break;
      }
      case 'enter_worktree': {
        const branchName = str(input.branch_name).trim();
        const baseRef = str(input.base_ref || '').trim() || undefined;
        if (!branchName) throw new Error('enter_worktree requires branch_name');
        if (!host.setToolRoot || !host.setActiveWorktree) {
          throw new Error('Host does not support worktree scoping');
        }
        const trueRoot = host.getRepoRoot?.() ?? host.getWorkspaceRoot();
        if (!trueRoot) throw new Error('No workspace folder open');
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: branchName,
        });
        const wt = await enterGitWorktree(trueRoot, branchName, baseRef, signal);
        host.setToolRoot(wt.path);
        host.setActiveWorktree({
          path: wt.path,
          branch: wt.branch,
          repoRoot: wt.repoRoot,
        });
        content = [
          `Entered worktree`,
          `path: ${wt.path}`,
          `branch: ${wt.branch}`,
          `repo_root: ${wt.repoRoot}`,
          'Subsequent read/write/search/terminal tools are scoped to this path until exit_worktree.',
        ].join('\n');
        break;
      }
      case 'exit_worktree': {
        const actionRaw = str(input.action).trim().toLowerCase();
        if (actionRaw !== 'apply' && actionRaw !== 'discard') {
          throw new Error("exit_worktree requires action 'apply' or 'discard'");
        }
        const meta = host.getActiveWorktree?.();
        if (!meta) {
          throw new Error('No active worktree — call enter_worktree first');
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: `${actionRaw} ${meta.branch}`,
        });
        const result = await exitGitWorktree(
          meta.repoRoot,
          meta.path,
          meta.branch,
          actionRaw,
          signal,
        );
        host.setToolRoot?.(undefined);
        host.setActiveWorktree?.(undefined);
        content = [
          `Exited worktree (${result.action})`,
          `path: ${result.path}`,
          result.merged ? 'merged: yes' : 'merged: no',
          'Tool cwd restored to workspace root.',
        ].join('\n');
        break;
      }
      case 'run_terminal': {
        const cmd = str(input.cmd);
        const relCwd = str(input.cwd || '.').trim() || '.';
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'pending',
          detail: cmd + (relCwd !== '.' ? ` (cwd=${relCwd})` : ''),
        });
        const decision = await host.confirmCommand(
          relCwd !== '.' ? `${cmd}  # cwd=${relCwd}` : cmd,
          {
            toolName: 'run_terminal',
            stepId: id,
          },
        );
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected the terminal command.',
            status: 'rejected',
          };
        }
        host.emit({ type: 'tool_card', id, name, status: 'running', detail: cmd });
        const root = host.getWorkspaceRoot();
        if (!root) throw new Error('No workspace root');
        // Resolve relative cwd under workspace (host still sandboxes via path checks if used).
        const pathMod = await import('node:path');
        const cwd = pathMod.resolve(root, relCwd);
        const rootRes = pathMod.resolve(root);
        const relCheck = pathMod.relative(rootRes, cwd);
        if (relCheck.startsWith('..') || pathMod.isAbsolute(relCheck)) {
          throw new Error(`cwd escapes workspace: ${relCwd}`);
        }
        const mode = str(input.mode || 'blocking').toLowerCase();
        if (mode === 'background') {
          if (input.stdin != null || input.replies != null) {
            throw new Error(
              'stdin/replies are only supported in blocking mode (not background)',
            );
          }
          if (!host.startBackgroundTerminal) {
            throw new Error(
              'Background terminals are not supported on this host',
            );
          }
          if (opts.policy && !opts.policy.allowBackground(cmd)) {
            throw new Error(
              `Background mode denied by .walkcroach/settings.json allowlist. Allowed substrings: ${opts.policy.settings.terminal.backgroundAllowlist.join(', ') || '(none)'}`,
            );
          }
          const started = await host.startBackgroundTerminal(cmd, { cwd });
          content = [
            `Started background task ${started.taskId} (pid ${started.pid}).`,
            `Log: ${started.logPath}`,
            'Use await_terminal with this task_id to poll status/logs.',
            'Stop kills the full process tree for background tasks.',
          ].join('\n');
          break;
        }
        if (mode !== 'blocking') {
          throw new Error(`Unknown run_terminal mode: ${mode}`);
        }
        let replies: string[] | undefined;
        if (input.replies !== undefined) {
          if (!Array.isArray(input.replies)) {
            throw new Error('replies must be an array of strings');
          }
          if (input.replies.length > MAX_STDIN_REPLIES) {
            throw new Error(
              `replies allows at most ${MAX_STDIN_REPLIES} entries`,
            );
          }
          replies = input.replies.map((r) => String(r ?? ''));
        }
        const stdinRaw =
          input.stdin !== undefined && input.stdin !== null
            ? str(input.stdin)
            : undefined;
        // Validate payload size early (same rules as stream-shell).
        buildStdinPayload({ stdin: stdinRaw, replies });
        const timeoutRaw = input.timeout_ms;
        const defaultTimeout =
          opts.policy?.defaultTimeoutMs ?? 120_000;
        const timeoutMs =
          typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw)
            ? Math.max(1_000, Math.min(600_000, Math.floor(timeoutRaw)))
            : defaultTimeout;
        const hasPreload = Boolean(
          (stdinRaw && stdinRaw.length > 0) || (replies && replies.length > 0),
        );
        // Tier B on by default; off when stdin/replies preload (EOF) unless
        // interactive:true is set explicitly. interactive:false always disables.
        const interactive =
          input.interactive === false
            ? false
            : input.interactive === true
              ? true
              : !hasPreload;

        let out = '';
        let exitCode: number | null | undefined;
        for await (const chunk of host.runTerminal(cmd, {
          cwd,
          signal,
          timeoutMs,
          stdin: stdinRaw,
          replies,
          onConfirmPrompt: interactive
            ? async (req) => {
                const options = [
                  ...req.options.filter((o) => o !== 'abort'),
                  'abort',
                ].slice(0, 6);
                // Ensure at least 2 options for askUser.
                while (options.length < 2) options.push('abort');
                const answer = await host.askUser({
                  question: [
                    `Terminal is waiting for input (${req.promptIndex}/${req.maxPrompts}):`,
                    '',
                    req.promptText.slice(0, 600),
                    '',
                    `Matched: ${req.matched}`,
                  ].join('\n'),
                  options,
                  allowFreeText: true,
                  stepId: `${id}-confirm-${req.promptIndex}`,
                });
                if (
                  answer.selected === 'abort' ||
                  answer.selected === '(skipped)'
                ) {
                  return 'abort';
                }
                const free = answer.freeText?.trim();
                if (free) return free;
                if (answer.selected === '(Enter)') return '(Enter)';
                return answer.selected;
              }
            : undefined,
        })) {
          out += chunk.text;
          if (chunk.exitCode !== undefined) exitCode = chunk.exitCode;
        }
        content = truncateText(out || '(no output)').text;
        if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'error',
            detail: `exit ${exitCode}`,
          });
          return {
            toolUseId: id,
            content: `Command failed with exit ${exitCode}.\n\n${content}`,
            status: 'error',
          };
        }
        if (
          opts.policy &&
          (exitCode === 0 || exitCode === undefined || exitCode === null) &&
          isVerifyCommand(cmd, opts.policy.verify)
        ) {
          opts.policy.markVerified();
        }
        break;
      }
      case 'verify': {
        const policy = opts.policy;
        if (!policy?.hasVerifyRecipes) {
          throw new Error(
            'No verify recipes. Create .walkcroach/verify.json with a commands array (e.g. ["npm test"]).',
          );
        }
        const requested = str(input.command).trim();
        const cmd = requested || policy.verify.commands[0]!;
        if (!isVerifyCommand(cmd, policy.verify)) {
          throw new Error(
            `Command not in .walkcroach/verify.json. Allowed:\n${policy.verify.commands
              .map((c) => `- ${c}`)
              .join('\n')}`,
          );
        }
        const relCwd =
          str(input.cwd || policy.verify.cwd || '.').trim() || '.';
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'pending',
          detail: cmd + (relCwd !== '.' ? ` (cwd=${relCwd})` : ''),
        });
        const decision = await host.confirmCommand(
          relCwd !== '.' ? `${cmd}  # cwd=${relCwd}` : cmd,
          {
            toolName: 'verify',
            stepId: id,
          },
        );
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected the verify command.',
            status: 'rejected',
          };
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: cmd,
        });
        const root = host.getWorkspaceRoot();
        if (!root) throw new Error('No workspace root');
        const pathMod = await import('node:path');
        const cwd = pathMod.resolve(root, relCwd);
        const rootRes = pathMod.resolve(root);
        const relCheck = pathMod.relative(rootRes, cwd);
        if (relCheck.startsWith('..') || pathMod.isAbsolute(relCheck)) {
          throw new Error(`cwd escapes workspace: ${relCwd}`);
        }
        const timeoutMs = policy.defaultTimeoutMs;
        let out = '';
        let exitCode: number | null | undefined;
        for await (const chunk of host.runTerminal(cmd, {
          cwd,
          signal,
          timeoutMs,
        })) {
          out += chunk.text;
          if (chunk.exitCode !== undefined) exitCode = chunk.exitCode;
        }
        content = truncateText(out || '(no output)').text;
        if (exitCode !== undefined && exitCode !== null && exitCode !== 0) {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'error',
            detail: `verify exit ${exitCode}`,
          });
          return {
            toolUseId: id,
            content: `Verify failed with exit ${exitCode}.\n\n${content}`,
            status: 'error',
          };
        }
        policy.markVerified();
        content = `Verified OK: ${cmd}\n\n${content}`;
        break;
      }
      case 'update_walkcroach_md': {
        const existing = await readWalkcroachMd(host);
        let next: string;
        if (input.append_section) {
          next = mergeWalkcroachAppend(existing, str(input.append_section));
        } else if (input.content) {
          next = str(input.content);
        } else {
          throw new Error('Provide content or append_section');
        }
        const decision = await host.showDiffPreview(
          WALKCROACH_MD,
          existing ?? '',
          next,
          {
            toolName: 'update_walkcroach_md',
            stepId: id,
            input: { path: WALKCROACH_MD, content: next },
          },
        );
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected WALKCROACH.md update.',
            status: 'rejected',
          };
        }
        host.emit({ type: 'tool_card', id, name, status: 'running' });
        await host.writeFile(WALKCROACH_MD, next);
        if (opts.turnId) {
          await recordCheckpoint(host.getWorkspaceRoot(), {
            turnId: opts.turnId,
            toolUseId: id,
            path: WALKCROACH_MD,
            before: existing ?? '',
            beforeExisted: existing !== undefined,
            after: next,
          });
        }
        content = `Updated ${WALKCROACH_MD}`;
        break;
      }
      case 'spawn_subagent': {
        if (!opts.spawnSubagent) {
          throw new Error('Sub-agents are disabled');
        }
        const subName = str(input.name) || 'subagent';
        const prompt = str(input.prompt);
        const roleRaw = str(input.role).toLowerCase();
        const { isPlannerSpawnName } = await import('../planner.js');
        const { isCriticSpawnName } = await import('../architecture-critic.js');
        const role =
          roleRaw === 'planner' || isPlannerSpawnName(subName)
            ? 'planner'
            : roleRaw === 'critic' || isCriticSpawnName(subName)
              ? 'critic'
              : 'default';
        host.emit({
          type: 'subagent',
          id,
          name: subName,
          status: 'running',
        });
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail:
            role === 'planner'
              ? `${subName} (planner)`
              : role === 'critic'
                ? `${subName} (critic)`
                : subName,
        });
        const summary = await opts.spawnSubagent({
          name: subName,
          prompt,
          signal,
          role,
        });
        host.emit({
          type: 'subagent',
          id,
          name: subName,
          status: 'done',
          summary,
        });
        content = truncateText(summary, 8000).text;
        break;
      }
      case 'submit_plan': {
        if (!opts.plannerMode) {
          throw new Error(
            'submit_plan is only available inside the Planner subagent. Spawn role=planner, then present_plan from the parent.',
          );
        }
        const {
          validatePlanArtifact,
          newPlanPath,
          plansDirRel,
        } = await import('../planner.js');
        const planMarkdown = str(input.plan_markdown);
        const validated = validatePlanArtifact(planMarkdown);
        if (!validated.ok) {
          throw new Error(validated.message);
        }
        const planPath = newPlanPath();
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: planPath,
        });
        // Ensure plans dir exists by writing the file (hosts mkdir on write).
        const header = `# WalkCroach plan\n\n_Submitted by Planner · ${new Date().toISOString()}_\n\n`;
        const body = `${header}${planMarkdown.trim()}\n`;
        // writeFile may need parent dir — try write; if fail, write via list noop
        try {
          await host.listDir(plansDirRel());
        } catch {
          // dir may not exist; writeFile on IDE/CLI mkdir -p parent
        }
        await host.writeFile(planPath, body);
        opts.onPlanSubmitted?.(planPath);
        content = [
          'Plan submitted and validated.',
          `plan_path: ${planPath}`,
          'Parent agent: call present_plan with this plan_path.',
        ].join('\n');
        break;
      }
      case 'present_plan': {
        if (opts.plannerMode) {
          throw new Error(
            'present_plan is for the parent agent after Planner finishes, not inside the Planner.',
          );
        }
        const {
          validatePlanArtifact,
          formatApprovedPlanBlock,
        } = await import('../planner.js');
        const planPath = str(input.plan_path);
        if (!planPath.includes('.walkcroach/plans/')) {
          throw new Error(
            'present_plan requires a path under .walkcroach/plans/ (from submit_plan)',
          );
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: planPath,
        });
        const raw = await host.readFile(planPath);
        const validated = validatePlanArtifact(raw);
        if (!validated.ok) {
          throw new Error(`Invalid plan at ${planPath}: ${validated.message}`);
        }
        const session = opts.planSession;
        const autoApprove = session?.autoApprove === true;
        if (autoApprove) {
          if (session) {
            session.approvedPlan = formatApprovedPlanBlock(raw, planPath);
            session.approvedPlanPath = planPath;
            session.reviseFeedback = null;
          }
          content = [
            'Plan auto-approved (non-interactive host).',
            `plan_path: ${planPath}`,
            'Execute the approved plan as non-negotiable context.',
          ].join('\n');
          break;
        }
        const preview = truncateText(raw, 4000).text;
        const answer = await host.askUser({
          question: [
            `Review plan (${planPath}).`,
            'Choose Approve to execute, or Revise (add feedback in free text).',
            '',
            preview,
          ].join('\n'),
          options: ['Approve', 'Revise'],
          allowFreeText: true,
          stepId: id,
        });
        if (answer.selected.toLowerCase().startsWith('approve')) {
          if (session) {
            session.approvedPlan = formatApprovedPlanBlock(raw, planPath);
            session.approvedPlanPath = planPath;
            session.reviseFeedback = null;
          }
          content = [
            'Plan approved by user.',
            `plan_path: ${planPath}`,
            'Execute the approved plan as non-negotiable context.',
          ].join('\n');
        } else {
          const feedback =
            answer.freeText?.trim() ||
            'User requested revisions (no free-text details).';
          if (session) {
            session.approvedPlan = null;
            session.approvedPlanPath = null;
            session.reviseFeedback = feedback;
          }
          content = [
            'Plan revision requested.',
            `Feedback: ${feedback}`,
            'Spawn Planner again with this feedback, then present_plan.',
          ].join('\n');
        }
        break;
      }
      case 'cockroach_mcp': {
        const mcp = opts.mcp;
        if (!mcp?.connected) {
          throw new Error(
            'CockroachDB MCP is not connected. Run WalkCroach: Configure CockroachDB, then retry.',
          );
        }
        const mcpTool = str(input.tool);
        const args =
          input.arguments && typeof input.arguments === 'object'
            ? (input.arguments as Record<string, unknown>)
            : {};
        if (isMcpWriteTool(mcpTool)) {
          if (opts.readOnly) {
            throw new Error(
              'MCP write tools are not available in read-only sub-agent mode',
            );
          }
          const decision = await host.confirmCommand(
            `MCP WRITE: ${mcpTool} ${JSON.stringify(args)}`,
            { toolName: 'cockroach_mcp', stepId: id },
          );
          if (decision !== 'approve') {
            host.emit({
              type: 'tool_card',
              id,
              name,
              status: 'done',
              detail: 'write rejected by user',
            });
            return {
              toolUseId: id,
              content: 'User rejected the MCP write action.',
              status: 'rejected',
            };
          }
          opts.telemetry?.bump('mcp_write_consent');
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: mcpTool,
        });
        content = truncateText(await mcp.callTool(mcpTool, args)).text;
        opts.telemetry?.bump('mcp_call');
        host.emit({
          type: 'telemetry',
          name: 'mcp_call',
          counters: opts.telemetry?.counters,
          detail: mcpTool,
        });
        break;
      }
      case 'mcp_call': {
        const registry = opts.mcpServers;
        if (!registry) {
          throw new Error(
            'No additional MCP servers configured. Add .walkcroach/mcp.json (mcpServers) and retry.',
          );
        }
        if (opts.readOnly) {
          throw new Error('mcp_call is not available in read-only sub-agent mode');
        }
        const server = str(input.server);
        const mcpTool = str(input.tool);
        const args =
          input.arguments && typeof input.arguments === 'object'
            ? (input.arguments as Record<string, unknown>)
            : {};
        // No per-server read/write classification in v1 — every call requires consent.
        const decision = await host.confirmCommand(
          `MCP CALL: ${server}.${mcpTool} ${JSON.stringify(args)}`,
          { toolName: 'mcp_call', stepId: id },
        );
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected the MCP call.',
            status: 'rejected',
          };
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: `${server}.${mcpTool}`,
        });
        content = truncateText(await registry.callTool(server, mcpTool, args)).text;
        opts.telemetry?.bump('mcp_call');
        host.emit({
          type: 'telemetry',
          name: 'mcp_call',
          counters: opts.telemetry?.counters,
          detail: `${server}.${mcpTool}`,
        });
        break;
      }
      case 'load_skill': {
        const skills = opts.skills;
        if (!skills) {
          throw new Error('Skills registry is not initialized');
        }
        const skillName = str(input.name);
        const full = skills.load(skillName);
        if (!full) {
          const available = skills
            .listMeta()
            .map((m) => m.name)
            .join(', ');
          throw new Error(
            `Unknown skill "${skillName}". Available: ${available || '(none)'}`,
          );
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: skillName,
        });
        content = skills.formatForModel(full);
        opts.telemetry?.bump('skill_loaded');
        opts.telemetry?.bump('skill_invoked');
        host.emit({
          type: 'telemetry',
          name: 'skill_loaded',
          counters: opts.telemetry?.counters,
          detail: skillName,
        });
        break;
      }
      case 'load_rule': {
        const ruleName = str(input.name);
        const rule = await loadRuleBody(host.getWorkspaceRoot(), ruleName);
        if (!rule) {
          throw new Error(`Unknown project rule "${ruleName}".`);
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: ruleName,
        });
        const header = rule.description
          ? `# Rule: ${rule.name}\n\n> ${rule.description}\n\n`
          : `# Rule: ${rule.name}\n\n`;
        content = truncateText(`${header}${rule.body.trim()}`).text;
        break;
      }
      case 'ccloud': {
        const rawArgs = Array.isArray(input.args)
          ? input.args.map((a) => str(a))
          : [];
        if (!rawArgs.length) {
          throw new Error('ccloud requires a non-empty args array');
        }
        const args = ensureJsonOutput(rawArgs);
        const cmdPreview = `ccloud ${args.join(' ')}`;
        const decision = await host.confirmCommand(cmdPreview, {
          toolName: 'ccloud',
          stepId: id,
        });
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected the ccloud action.',
            status: 'rejected',
          };
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: cmdPreview,
        });
        try {
          const result = await runCcloud(args, {
            cwd: host.getWorkspaceRoot(),
            apiKey: opts.ccloudApiKey,
            signal,
          });
          opts.telemetry?.bump('ccloud_action');
          host.emit({
            type: 'telemetry',
            name: 'ccloud_action',
            counters: opts.telemetry?.counters,
            detail: cmdPreview,
          });
          content = truncateText(
            [
              `exit=${result.exitCode}`,
              result.json
                ? `json:\n${JSON.stringify(result.json, null, 2)}`
                : `stdout:\n${result.stdout}`,
              result.stderr ? `stderr:\n${result.stderr}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          ).text;
          if (result.exitCode !== 0) {
            host.emit({
              type: 'tool_card',
              id,
              name,
              status: 'error',
              detail: `exit ${result.exitCode}`,
            });
            return {
              toolUseId: id,
              content: `ccloud failed.\n\n${content}`,
              status: 'error',
            };
          }
        } catch (err) {
          throw new Error(plainCcloudError(err));
        }
        break;
      }
      case 'recall_project_memory': {
        const pm = opts.projectMemory;
        if (!pm) {
          throw new Error(
            'Project memory is unavailable. Sign in and link this workspace to a WalkCroach project first.',
          );
        }
        const query = str(input.query);
        if (!query) throw new Error('query is required');
        const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20);
        const surfaces = Array.isArray(input.sourceSurfaces)
          ? input.sourceSurfaces.map((s) => str(s).toLowerCase()).filter(Boolean)
          : undefined;
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: query.slice(0, 80),
        });
        const hits = await pm.recall({ query, limit, sourceSurfaces: surfaces });
        opts.telemetry?.bump('memory_recall');
        host.emit({
          type: 'telemetry',
          name: 'memory_recall',
          counters: opts.telemetry?.counters,
          detail: String(hits.length),
        });
        content = truncateText(
          hits.length
            ? hits
                .map(
                  (h, i) =>
                    `${i + 1}. [${h.sourceSurface ?? '?'}|${h.kind}] ${h.text}`,
                )
                .join('\n\n')
            : '(no matching project memory)',
        ).text;
        // P4 — structured provenance for coding-surface recall cards (not just model text).
        {
          const surfacesSeen = [
            ...new Set(
              hits.map((h) => (h.sourceSurface ?? '?').toLowerCase()),
            ),
          ];
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: hits.length
              ? `${hits.length} hit(s) · ${surfacesSeen.join(', ')}`
              : 'no matches',
            hits: hits.map((h) => ({
              sourceSurface: (h.sourceSurface ?? 'unknown').toLowerCase(),
              kind: h.kind,
              text: h.text.slice(0, 160),
            })),
          });
          return { toolUseId: id, content, status: 'success' };
        }
      }
      case 'mirror_project_memory': {
        const pm = opts.projectMemory;
        if (!pm) {
          throw new Error(
            'Project memory is unavailable. Sign in and link this workspace to a WalkCroach project first.',
          );
        }
        const text = str(input.text).trim();
        if (!text) throw new Error('text is required');
        const kind = str(input.kind || 'decision');
        const preview = `MIRROR to project ${pm.projectId} (${kind}):\n${text.slice(0, 2000)}`;
        const decision = await host.confirmCommand(preview, {
          toolName: 'mirror_project_memory',
          stepId: id,
        });
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected mirroring to project memory.',
            status: 'rejected',
          };
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: kind,
        });
        const result = await pm.mirror({ text, kind });
        opts.telemetry?.bump('memory_mirror');
        host.emit({
          type: 'telemetry',
          name: 'memory_mirror',
          counters: opts.telemetry?.counters,
          detail: result.id,
        });
        content = `Mirrored to project ${pm.projectId} as ${kind} (id=${result.id}).`;
        break;
      }
      case 'mirror_skill': {
        const ss = opts.sharedSkills;
        if (!ss) {
          throw new Error(
            'Shared skill sync is unavailable. Sign in to WalkCroach first.',
          );
        }
        const skillName = str(input.name).trim();
        if (!skillName) throw new Error('name is required');
        const description = str(input.description).trim();
        if (!description) throw new Error('description is required');
        const skillBody = str(input.body).trim();
        if (!skillBody) throw new Error('body is required');
        const preview = `MIRROR skill "${skillName}" to your shared skill library:\n${description}`;
        const decision = await host.confirmCommand(preview, {
          toolName: 'mirror_skill',
          stepId: id,
        });
        if (decision !== 'approve') {
          host.emit({
            type: 'tool_card',
            id,
            name,
            status: 'done',
            detail: 'rejected by user',
          });
          return {
            toolUseId: id,
            content: 'User rejected mirroring to shared skill library.',
            status: 'rejected',
          };
        }
        host.emit({
          type: 'tool_card',
          id,
          name,
          status: 'running',
          detail: skillName,
        });
        const result = await ss.mirror({
          name: skillName,
          description,
          body: skillBody,
        });
        opts.telemetry?.bump('skill_mirror');
        host.emit({
          type: 'telemetry',
          name: 'skill_mirror',
          counters: opts.telemetry?.counters,
          detail: result.id,
        });
        content = `Mirrored skill "${skillName}" to your shared skill library (id=${result.id}).`;
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    host.emit({
      type: 'tool_card',
      id,
      name,
      status: 'done',
      detail: content.slice(0, 200),
    });
    return { toolUseId: id, content, status: 'success' };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const message = err instanceof Error ? err.message : String(err);
    host.emit({
      type: 'tool_card',
      id,
      name,
      status: 'error',
      detail: message,
    });
    return {
      toolUseId: id,
      content: `Error: ${message}`,
      status: 'error',
    };
  }
}

function summarizeInput(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === 'run_terminal') {
    const cmd = str(input.cmd);
    const cwd = input.cwd ? ` (cwd=${str(input.cwd)})` : '';
    const mode =
      str(input.mode || '').toLowerCase() === 'background' ? ' [bg]' : '';
    const replies = Array.isArray(input.replies)
      ? ` [${input.replies.length} replies]`
      : '';
    const hasStdin =
      input.stdin !== undefined && String(input.stdin).length > 0
        ? ' [stdin]'
        : '';
    return `${cmd}${cwd}${mode}${hasStdin}${replies}`;
  }
  if (name === 'terminal_session') {
    const action = str(input.action || '?');
    if (action === 'start') return `start ${str(input.cmd)}`;
    if (action === 'write') {
      return `write ${str(input.session_id)} (${str(input.input).length} chars)`;
    }
    if (action === 'read' || action === 'close') {
      return `${action} ${str(input.session_id)}`;
    }
    return action;
  }
  if (name === 'await_terminal') return str(input.task_id);
  if (name === 'verify') return str(input.command) || 'verify';
  if (name === 'spawn_subagent') return str(input.name);
  if (name === 'submit_plan') return 'plan artifact';
  if (name === 'present_plan') return str(input.plan_path);
  if (name === 'cockroach_mcp') return str(input.tool);
  if (name === 'mcp_call') return `${str(input.server)}.${str(input.tool)}`;
  if (name === 'load_skill') return str(input.name);
  if (name === 'load_rule') return str(input.name);
  if (name === 'glob') return str(input.pattern);
  if (name === 'semantic_search') return str(input.query);
  if (name === 'todo_write' && Array.isArray(input.todos)) {
    return `${input.todos.length} items`;
  }
  if (name === 'apply_patch' && Array.isArray(input.edits)) {
    return `${str(input.path)} (${input.edits.length} edits)`;
  }
  if (name === 'ask_user') return str(input.question).slice(0, 80);
  if (name === 'ccloud' && Array.isArray(input.args)) {
    return `ccloud ${input.args.map(String).join(' ')}`;
  }
  if (input.path) return str(input.path);
  return name;
}
