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
} from '../mcp.js';
import type { SkillsRegistry } from '../skills.js';
import { ensureJsonOutput, runCcloud, plainCcloudError } from '../ccloud.js';
import type { TelemetrySink } from '../telemetry.js';
import type { ProjectMemoryBridge } from '../project-memory.js';
import type { WorkspacePolicy } from '../workspace-policy.js';
import { isVerifyCommand } from '../workspace-config.js';

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
  }) => Promise<string>;
  /** Phase B context */
  mcp?: CockroachMcpClient | null;
  skills?: SkillsRegistry | null;
  telemetry?: TelemetrySink | null;
  ccloudApiKey?: string;
  /** Phase C — shared project memory when linked */
  projectMemory?: ProjectMemoryBridge | null;
  /** P1 — settings / verify recipes */
  policy?: WorkspacePolicy | null;
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

export async function executeTool(
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
        try {
          before = await host.readFile(path);
        } catch {
          before = '';
        }
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
        await host.writeFile(path, next);
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
        const before = await host.readFile(path);
        if (!before.includes(old_str)) {
          throw new Error(`old_str not found in ${path}`);
        }
        const occurrences = before.split(old_str).length - 1;
        if (occurrences > 1) {
          throw new Error(
            `old_str matches ${occurrences} locations in ${path}. Provide more surrounding context so the match is unique.`,
          );
        }
        const after = before.replace(old_str, new_str);
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
        await host.writeFile(path, after);
        content = `Edited ${path}`;
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
        const timeoutRaw = input.timeout_ms;
        const defaultTimeout =
          opts.policy?.defaultTimeoutMs ?? 120_000;
        const timeoutMs =
          typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw)
            ? Math.max(1_000, Math.min(600_000, Math.floor(timeoutRaw)))
            : defaultTimeout;
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
        content = `Updated ${WALKCROACH_MD}`;
        break;
      }
      case 'spawn_subagent': {
        if (!opts.spawnSubagent) {
          throw new Error('Sub-agents are disabled');
        }
        const subName = str(input.name) || 'subagent';
        const prompt = str(input.prompt);
        host.emit({
          type: 'subagent',
          id,
          name: subName,
          status: 'running',
        });
        host.emit({ type: 'tool_card', id, name, status: 'running', detail: subName });
        const summary = await opts.spawnSubagent({
          name: subName,
          prompt,
          signal,
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
        break;
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
    return `${cmd}${cwd}${mode}`;
  }
  if (name === 'await_terminal') return str(input.task_id);
  if (name === 'verify') return str(input.command) || 'verify';
  if (name === 'spawn_subagent') return str(input.name);
  if (name === 'cockroach_mcp') return str(input.tool);
  if (name === 'load_skill') return str(input.name);
  if (name === 'glob') return str(input.pattern);
  if (name === 'todo_write' && Array.isArray(input.todos)) {
    return `${input.todos.length} items`;
  }
  if (name === 'ask_user') return str(input.question).slice(0, 80);
  if (name === 'ccloud' && Array.isArray(input.args)) {
    return `ccloud ${input.args.map(String).join(' ')}`;
  }
  if (input.path) return str(input.path);
  return name;
}
