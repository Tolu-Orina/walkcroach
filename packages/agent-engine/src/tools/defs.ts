/**
 * Bedrock tool definitions for WalkCroach IDE (local host execution).
 */

export type ToolDef = {
  name: string;
  description: string;
  /** If true, never eligible for low-friction auto-approve. */
  infra?: boolean;
  inputSchema: Record<string, unknown>;
};

export const PHASE_A_TOOLS: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file relative to the workspace root',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to workspace root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and directories at a path relative to the workspace root',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to workspace root (default ".")',
        },
      },
      required: [],
    },
  },
  {
    name: 'search',
    description:
      'Search file contents for a regex/text pattern (ripgrep if available, else recursive scan)',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        glob: {
          type: 'string',
          description: 'Optional glob filter, e.g. "*.ts"',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file (requires user approval of the diff)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string', description: 'Full file contents' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Apply an exact search/replace edit to an existing file (requires approval)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'run_terminal',
    description:
      'Run a shell command in the workspace root (requires approval; never auto-approved)',
    infra: true,
    inputSchema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Shell command to run' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'update_walkcroach_md',
    description:
      'Propose an update to WALKCROACH.md (project memory). Shown as a reviewable diff.',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Full proposed WALKCROACH.md contents',
        },
        append_section: {
          type: 'string',
          description:
            'Optional: append this markdown section instead of replacing the whole file',
        },
      },
      required: [],
    },
  },
  {
    name: 'spawn_subagent',
    description:
      'Fan out a focused sub-task to an isolated sub-agent (read-only tools). Returns a summary only.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short label shown in the UI' },
        prompt: {
          type: 'string',
          description: 'Instructions for the sub-agent',
        },
      },
      required: ['name', 'prompt'],
    },
  },
];

/** Phase B — CockroachDB Managed MCP, Agent Skills, ccloud CLI. */
export const PHASE_B_TOOLS: ToolDef[] = [
  {
    name: 'cockroach_mcp',
    description:
      'Call the CockroachDB Cloud Managed MCP server (schema inspect, SELECT, EXPLAIN). Read-only by default; write tools require extra consent. Audit logging is provided by Managed MCP — do not proxy.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description:
            'MCP tool name, e.g. list_tables, get_table_schema, select_query, explain_query',
        },
        arguments: {
          type: 'object',
          description: 'Arguments for the MCP tool',
        },
      },
      required: ['tool'],
    },
  },
  {
    name: 'load_skill',
    description:
      'Load the full body of a CockroachDB Agent Skill by name (progressive disclosure). Use after matching a skill from the catalog for schema/index/ops tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Skill name, e.g. cockroachdb-schema-design, cockroachdb-indexes-and-queries, cockroachdb-operations',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'ccloud',
    description:
      'Run the CockroachDB Cloud ccloud CLI for provisioning/lifecycle (always requires explicit approval; never auto-approved). Output forced to JSON (-o json).',
    infra: true,
    inputSchema: {
      type: 'object',
      properties: {
        args: {
          type: 'array',
          items: { type: 'string' },
          description:
            'ccloud arguments only (without the binary name), e.g. ["cluster", "list"]',
        },
      },
      required: ['args'],
    },
  },
];

/** Phase C — available only when the workspace is linked to a WalkCroach project. */
export const PHASE_C_TOOLS: ToolDef[] = [
  {
    name: 'recall_project_memory',
    description:
      'Vector-search the shared WalkCroach project memory (Web, Chrome, IDE). Use when prior decisions/preferences from any surface would help. Optional sourceSurfaces filter: web | chrome | ide.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language recall query',
        },
        limit: {
          type: 'number',
          description: 'Max hits (default 5, max 20)',
        },
        sourceSurfaces: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional filter, e.g. ["web","chrome"] or ["ide"] (FR-D16)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'mirror_project_memory',
    description:
      'Write a distilled decision/preference/convention into shared CockroachDB project memory (source_surface=ide). Prefer short bullets, not raw chat.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Distilled memory text to mirror',
        },
        kind: {
          type: 'string',
          description:
            'decision | preference | convention | summary (default decision)',
        },
      },
      required: ['text'],
    },
  },
];

export const ALL_TOOLS: ToolDef[] = [
  ...PHASE_A_TOOLS,
  ...PHASE_B_TOOLS,
  ...PHASE_C_TOOLS,
];

export function getToolDef(name: string): ToolDef | undefined {
  return ALL_TOOLS.find((t) => t.name === name);
}

export function toBedrockTools(opts?: {
  includeSubagents?: boolean;
  includePhaseB?: boolean;
  includePhaseC?: boolean;
}) {
  const includeSubagents = opts?.includeSubagents !== false;
  const includePhaseB = opts?.includePhaseB !== false;
  const includePhaseC = opts?.includePhaseC === true;
  let list = PHASE_A_TOOLS;
  if (includePhaseB) list = [...list, ...PHASE_B_TOOLS];
  if (includePhaseC) list = [...list, ...PHASE_C_TOOLS];
  return list
    .filter((t) => includeSubagents || t.name !== 'spawn_subagent')
    .map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: { json: t.inputSchema },
      },
    }));
}

export const READ_ONLY_TOOL_NAMES = new Set([
  'read_file',
  'list_dir',
  'search',
  'load_skill',
  'cockroach_mcp',
  'recall_project_memory',
]);
