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
    name: 'glob',
    description:
      'Find files by glob pattern relative to the workspace root (e.g. "test/**", "**/*.ts"). Prefer this over recursive list_dir.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern relative to workspace root',
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
    name: 'apply_patch',
    description:
      'Apply multiple sequential unique search/replace hunks to one existing file (requires approval). Prefer this over many edit_file calls when changing several places in the same file. Each old_str must match exactly once.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: {
          type: 'array',
          description: '1–20 hunks applied in order',
          items: {
            type: 'object',
            properties: {
              old_str: { type: 'string' },
              new_str: { type: 'string' },
            },
            required: ['old_str', 'new_str'],
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  {
    name: 'run_terminal',
    description:
      'Run a shell command. Critical/infra commands always need approval; routine local commands may auto-run in low-friction mode. Use mode=blocking (default) for npm install/test/build. Use mode=background for long-lived processes (dev servers, watchers) so the agent can keep working — then poll with await_terminal. Prefer non-interactive flags (-y/--yes) when available; otherwise pass stdin or replies for planned confirmations (e.g. replies: ["y"]). Unexpected [y/N] prompts are surfaced via ask_user when interactive (default on without preload). Prefer write_file for source files.',
    infra: true,
    inputSchema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Shell command to run' },
        cwd: {
          type: 'string',
          description:
            'Working directory relative to workspace root (default ".")',
        },
        timeout_ms: {
          type: 'number',
          description:
            'Blocking mode only: kill after this many ms (default 120000, max 600000)',
        },
        mode: {
          type: 'string',
          description:
            'blocking (wait for exit) | background (return task_id immediately)',
        },
        stdin: {
          type: 'string',
          description:
            'Blocking only: raw text written to the process stdin first (include \\n if the CLI expects Enter). Exact bytes — no auto newline.',
        },
        replies: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Blocking only: up to 20 planned answers written after stdin, each with a trailing newline if missing (e.g. ["y","n"]). Stdin is then closed (EOF) unless interactive=true.',
        },
        interactive: {
          type: 'boolean',
          description:
            'Blocking only: when true, keep stdin open and surface unexpected [y/N] prompts via ask_user (Tier B). Default true if no stdin/replies; default false when stdin/replies are set. Password prompts abort.',
        },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'await_terminal',
    description:
      'Poll a background terminal started with run_terminal mode=background. Returns status, exit code if finished, and a log tail.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Task id returned by run_terminal in background mode',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'terminal_session',
    description:
      'Tier C interactive terminal session for REPLs/TUIs and multi-step stdin. Actions: start (approval like run_terminal; returns session_id + backend pty|pipe), write (send input; newline appended by default), read (wait for output settle; returns new output since last read), close, list. Prefer this over blocking run_terminal when you must converse with a process mid-run (python -i, psql, node REPL, debuggers). Use run_terminal for one-shot installs/builds/tests. Max 4 concurrent sessions. Password prompts are not supported — close and use a non-secret flow.',
    infra: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'start | write | read | close | list',
        },
        cmd: {
          type: 'string',
          description:
            'start only: program/command line (e.g. "python -i", "node", "psql -U ...")',
        },
        cwd: {
          type: 'string',
          description:
            'start only: working directory relative to workspace (default ".")',
        },
        session_id: {
          type: 'string',
          description: 'write/read/close: id returned by start',
        },
        input: {
          type: 'string',
          description: 'write only: text to send to the session stdin',
        },
        append_newline: {
          type: 'boolean',
          description:
            'write only: append \\n if missing (default true). Set false for raw control sequences.',
        },
        timeout_ms: {
          type: 'number',
          description:
            'read only: max wait for output (default 8000, max 120000)',
        },
        settle_ms: {
          type: 'number',
          description:
            'read only: quiet period before returning (default 300)',
        },
        cols: {
          type: 'number',
          description: 'start only: terminal columns (default 120)',
        },
        rows: {
          type: 'number',
          description: 'start only: terminal rows (default 40)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'verify',
    description:
      'Run a project check from .walkcroach/verify.json (tests/typecheck/build). Prefer this after mutating work. command must be an exact entry from verify.json (or omit to run the first). Exit 0 marks the session verified.',
    infra: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description:
            'Exact command from .walkcroach/verify.json (default: first listed command)',
        },
        cwd: {
          type: 'string',
          description:
            'Working directory relative to workspace (default: verify.json cwd or ".")',
        },
      },
      required: [],
    },
  },
  {
    name: 'todo_write',
    description:
      'Replace the agent task checklist (1–20 items). Keep exactly one item in_progress while working. Update statuses as you finish steps. Call this early on multi-step tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: {
                type: 'string',
                description: 'pending | in_progress | completed | cancelled',
              },
            },
            required: ['id', 'content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
  {
    name: 'ask_user',
    description:
      'Ask the user a structured multiple-choice question when a real decision is required before proceeding. Prefer acting when the goal is already clear. Do not use this to dump option menus as a substitute for work.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2–6 short choices',
        },
        allow_free_text: {
          type: 'boolean',
          description: 'Allow an optional free-text answer in addition to choices',
        },
      },
      required: ['question', 'options'],
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
      'Load a CockroachDB Agent Skill by name (progressive disclosure). Official skills from cockroachlabs/cockroachdb-skills ship bundled — pick a name from the skills catalog for schema, SQL, observability, security, MOLT, or ops.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Skill name, e.g. cockroachdb-sql, designing-application-transactions, triaging-live-sql-activity, cockroachdb-walkcroach-tools',
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
      'Vector-search the shared WalkCroach project memory (Web, Chrome, IDE, Desktop). Use when prior decisions/preferences from any surface would help. Optional sourceSurfaces filter: web | chrome | ide | desktop.',
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
      'Write a distilled decision/preference/convention into shared CockroachDB project memory (source_surface set by the host: ide or desktop). Prefer short bullets, not raw chat.',
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
  'glob',
  'load_skill',
  'cockroach_mcp',
  'recall_project_memory',
  'ask_user',
  'await_terminal',
]);
/** Subagents / plan mode must not own the parent checklist. */