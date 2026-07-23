import { truncateText, DEFAULT_WALK_CROACH_MD_MAX_CHARS } from './truncate.js';
import type { SystemContentBlock } from '@aws-sdk/client-bedrock-runtime';

export const AGENT_SYSTEM_PROMPT = [
  'You are WalkCroach IDE, a local coding agent in the developer\'s workspace.',
  'Follow gather → act → verify: inspect only what you need, make the changes, then verify.',
  'Use tools for all file and shell operations. Paths must be relative to the workspace root (never absolute Windows/macOS paths).',
  'Prefer glob over recursive list_dir. Prefer edit_file for surgical changes; use write_file for new files or full rewrites.',
  'Use run_terminal for installs, builds, tests (mode=blocking, default). For long-lived processes (vite/dev servers/watchers), use mode=background then await_terminal to poll — never block the loop on a forever-running server. Prefer write_file for source files so the user sees a diff.',
  'On multi-step work, call todo_write early and keep exactly one item in_progress until done (persisted under .walkcroach/todos.json).',
  'After mutating work, call verify (commands from .walkcroach/verify.json) before claiming the task is done. Do not treat a prior failing test run as success — run a fresh verify.',
  'Use ask_user only when a real choice is required before you can proceed; otherwise act.',
  'Every file write and terminal command is shown to the user for approval unless they enabled low-friction edits.',
  'Never invent file contents you have not read. Keep WALKCROACH.md updated with durable conventions via update_walkcroach_md.',
  'Honor .walkcroach/rules/*.md and .walkcroach/settings.json (deny paths, terminal timeouts, background allowlist).',
  'For large multi-file work, you may call spawn_subagent for read-only exploration; you apply writes yourself.',
  'Do not run destructive or infrastructure-provisioning commands unless the user explicitly asked.',
  'CockroachDB: call load_skill for official CockroachDB Agent Skills (bundled from cockroachlabs/cockroachdb-skills); use cockroach_mcp for interactive schema/data (read-only default); ccloud only for cloud provisioning/lifecycle (always approval-gated). Prefer cockroachdb-walkcroach-tools when unsure which surface to use.',
  'When linked to a WalkCroach project, use recall_project_memory for prior decisions from Web/Chrome/IDE, and mirror_project_memory for distilled decisions (never raw chat dumps).',
  'CRITICAL — execution bias: When the user asks to scaffold, create, implement, fix, or start something, you MUST call write_file / edit_file / run_terminal in that session. Do not end your turn after only list_dir/read_file/search/glob. Do not replace doing the work with a long status summary. Do not re-explore the whole monorepo when the task names a specific folder. Prefer a small working app over perfect architecture.',
].join(' ');

/**
 * Cache-stable prompt assembly: tools handled separately; system + skills meta +
 * walkcroach.md + rules sit behind cachePoint breakpoints (static → dynamic).
 */
export function assembleSystemBlocks(params: {
  walkcroachMd?: string;
  skillsCatalog?: string;
  rulesMd?: string;
}): SystemContentBlock[] {
  const blocks: SystemContentBlock[] = [
    { text: AGENT_SYSTEM_PROMPT },
    { cachePoint: { type: 'default' } },
  ];

  if (params.skillsCatalog?.trim()) {
    blocks.push({
      text: `# Available Agent Skills (metadata only — call load_skill for full body)\n\n${params.skillsCatalog.trim()}`,
    });
    blocks.push({ cachePoint: { type: 'default' } });
  }

  if (params.walkcroachMd?.trim()) {
    const { text } = truncateText(
      params.walkcroachMd,
      DEFAULT_WALK_CROACH_MD_MAX_CHARS,
    );
    blocks.push({
      text: `# WALKCROACH.md (project memory)\n\n${text}`,
    });
    blocks.push({ cachePoint: { type: 'default' } });
  }

  if (params.rulesMd?.trim()) {
    blocks.push({
      text: `# Project rules (.walkcroach/rules)\n\n${params.rulesMd.trim()}`,
    });
    blocks.push({ cachePoint: { type: 'default' } });
  }

  return blocks;
}

/** Heuristic: user asked for create/scaffold/run — needs writes/terminal. */
export function looksLikeActionTask(prompt: string): boolean {
  return /\b(scaffold|create|implement|build|add|write|fix|start|run|setup|init|generate|make)\b/i.test(
    prompt,
  );
}

export function buildUserTurn(params: {
  prompt: string;
  gitStatus?: string;
  workspaceRoot?: string;
  mcpConnected?: boolean;
  mcpTools?: string[];
  linkedProjectId?: string;
  linkedProjectName?: string;
  verifyCommands?: string[];
}): string {
  const parts = [`# Task\n\n${params.prompt.trim()}`];
  if (params.workspaceRoot) {
    parts.push(`\n# Workspace\n\n\`${params.workspaceRoot}\``);
    parts.push(
      '\nUse **relative** paths from this workspace root in every tool call.',
    );
  }
  if (looksLikeActionTask(params.prompt)) {
    parts.push(
      '\n# Execution requirement\n\nThis task requires creating/changing files and/or running commands. Call `todo_write` to plan steps, then `write_file` / `edit_file` / `run_terminal` before you end your turn. Do not stop after exploration alone. Use `ask_user` only if a real decision blocks progress.',
    );
  }
  if (params.verifyCommands?.length) {
    parts.push(
      `\n# Verify recipes (.walkcroach/verify.json)\n\nAfter changes, call \`verify\` with one of:\n${params.verifyCommands
        .map((c) => `- \`${c}\``)
        .join('\n')}\nDo not claim done until a fresh verify exits 0.`,
    );
  }
  if (params.gitStatus?.trim()) {
    parts.push(`\n# git status\n\n\`\`\`\n${params.gitStatus.trim()}\n\`\`\``);
  }
  if (params.linkedProjectId) {
    parts.push(
      `\n# WalkCroach project link\n\nLinked to project \`${params.linkedProjectId}\`${
        params.linkedProjectName ? ` (“${params.linkedProjectName}”)` : ''
      }. Tools recall_project_memory and mirror_project_memory are available.`,
    );
  } else {
    parts.push(
      '\n# WalkCroach project link\n\nNot linked (optional). Proceed with the local task; do not block on sign-in or project linking unless the user asked for memory sync.',
    );
  }
  if (params.mcpConnected) {
    const tools =
      params.mcpTools?.length
        ? params.mcpTools.join(', ')
        : 'list_tables, get_table_schema, select_query, explain_query, …';
    parts.push(
      `\n# CockroachDB MCP\n\nConnected. Available tools: ${tools}`,
    );
  } else {
    parts.push(
      '\n# CockroachDB MCP\n\nNot configured. File tools still work; skip Cockroach unless the user asked for it.',
    );
  }
  return parts.join('\n');
}

/** Lightweight follow-up / Continue turn (session already has context). */
export function buildFollowUpTurn(prompt: string): string {
  return `# Follow-up\n\n${prompt.trim()}`;
}
