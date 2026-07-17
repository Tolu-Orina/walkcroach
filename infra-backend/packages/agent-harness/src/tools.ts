/**
 * Bedrock tool definitions for WalkCroach Web.
 *
 * | kind           | Examples                         | Behaviour                                      |
 * |----------------|----------------------------------|------------------------------------------------|
 * | server         | recall_*, remember_preference    | Executed in harness; never pauses HTTP stream  |
 * | client_local   | write_file, edit_file            | Yielded to client; auto-acked for Converse     |
 * | client_resume  | run_terminal                     | Yielded; stream ends; POST /tool-result        |
 */

export type ToolKind = 'server' | 'client_local' | 'client_resume';

export type ToolDef = {
  name: string;
  description: string;
  kind: ToolKind;
  inputSchema: Record<string, unknown>;
};

export const TOOLS: ToolDef[] = [
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the project workspace',
    kind: 'client_local',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to project root' },
        content: { type: 'string', description: 'Full file contents' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Apply an exact search/replace edit to an existing file',
    kind: 'client_local',
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
      'Run a shell command in the WebContainer (e.g. npm install, npm run build). Use sparingly; results return asynchronously.',
    kind: 'client_resume',
    inputSchema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Shell command to run' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'recall_project_memory',
    description:
      'Semantic search over durable project memory in CockroachDB (preferences, decisions, captures)',
    kind: 'server',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'remember_preference',
    description:
      'Persist a lasting user preference or architectural decision into project memory',
    kind: 'server',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Clear statement of the preference or decision',
        },
        kind: {
          type: 'string',
          enum: ['preference', 'decision'],
          description: 'Defaults to preference',
        },
      },
      required: ['text'],
    },
  },
];

export function getToolDef(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function getToolKind(name: string): ToolKind {
  return getToolDef(name)?.kind ?? 'client_local';
}

/** @deprecated use getToolKind — kept for callers expecting awaitResult flag */
export function toolAwaitResult(name: string): boolean {
  return getToolKind(name) === 'client_resume';
}

/** Bedrock Converse toolConfig.tools */
export function toBedrockTools(mode: 'plan' | 'build' = 'build') {
  const list =
    mode === 'plan'
      ? TOOLS.filter((t) => t.kind === 'server')
      : TOOLS;

  return list.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description,
      inputSchema: { json: t.inputSchema },
    },
  }));
}
