import { truncateText, DEFAULT_WALK_CROACH_MD_MAX_CHARS } from './truncate.js';
import type { SystemContentBlock } from '@aws-sdk/client-bedrock-runtime';

export const AGENT_SYSTEM_PROMPT = [
  'You are WalkCroach IDE, a local coding agent in the developer\'s workspace.',
  'Follow gather → act → verify: inspect context, make minimal correct changes, then verify.',
  'Use tools for all file and shell operations. Paths are relative to the workspace root.',
  'Prefer edit_file for surgical changes; use write_file for new files or full rewrites.',
  'Every file write and terminal command is shown to the user for approval unless they enabled low-friction edits.',
  'Never invent file contents you have not read. Keep WALKCROACH.md updated with durable conventions via update_walkcroach_md.',
  'For large multi-file work, you may call spawn_subagent for read-only exploration; you apply writes yourself.',
  'Do not run destructive or infrastructure-provisioning commands unless the user explicitly asked.',
  'CockroachDB: use cockroach_mcp for interactive schema/data (read-only default); load_skill before schema/index design; ccloud only for cloud provisioning/lifecycle (always approval-gated).',
  'When linked to a WalkCroach project, use recall_project_memory for prior decisions from Web/Chrome/IDE, and mirror_project_memory for distilled decisions (never raw chat dumps).',
].join(' ');

/**
 * Cache-stable prompt assembly: tools handled separately; system + skills meta +
 * walkcroach.md sit behind cachePoint breakpoints (static → dynamic).
 */
export function assembleSystemBlocks(params: {
  walkcroachMd?: string;
  skillsCatalog?: string;
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

  return blocks;
}

export function buildUserTurn(params: {
  prompt: string;
  gitStatus?: string;
  workspaceRoot?: string;
  mcpConnected?: boolean;
  mcpTools?: string[];
  linkedProjectId?: string;
  linkedProjectName?: string;
}): string {
  const parts = [`# Task\n\n${params.prompt.trim()}`];
  if (params.workspaceRoot) {
    parts.push(`\n# Workspace\n\n\`${params.workspaceRoot}\``);
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
      '\n# WalkCroach project link\n\nNot linked. Sign in and link a project to enable cross-surface memory recall/mirror. Local WALKCROACH.md still works.',
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
      '\n# CockroachDB MCP\n\nNot configured. User can run WalkCroach: Configure CockroachDB. File tools still work.',
    );
  }
  return parts.join('\n');
}
