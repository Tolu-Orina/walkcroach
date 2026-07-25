/**
 * Bedrock tool definitions for WalkCroach Web.
 *
 * | kind           | Examples                         | Behaviour                                      |
 * |----------------|----------------------------------|------------------------------------------------|
 * | server         | recall_*, remember_preference,   | Executed in harness; never pauses HTTP stream  |
 * |                | web_search, web_extract          |                                                |
 * | client_resume  | write_file, edit_file,           | Yielded; stream ends; POST /tool-result after  |
 * |                | run_terminal                     | client verifies apply (no optimistic acks)     |
 *
 * Tool profiles (revamp Phase A):
 *   chat          — general Chat (search + memory; no file/terminal writes)
 *   project_chat  — project-scoped Chat (search + memory; optional save artefacts later)
 *   builder       — App Builder (all tools; client sandbox for file/terminal)
 *   plan          — builder plan mode (server tools only)
 */

export type ToolKind = 'server' | 'client_resume';

/** Which product surface mounts which tools. */
export type ToolProfile = 'chat' | 'project_chat' | 'builder' | 'plan';

export type ToolDef = {
  name: string;
  description: string;
  kind: ToolKind;
  /** Profiles that include this tool. */
  profiles: ToolProfile[];
  inputSchema: Record<string, unknown>;
};

export const TOOLS: ToolDef[] = [
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the project sandbox workspace',
    kind: 'client_resume',
    profiles: ['builder'],
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
    description: 'Apply an exact search/replace edit to an existing file in the project sandbox',
    kind: 'client_resume',
    profiles: ['builder'],
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
      'Run a shell command in the project sandbox (e.g. npm install, npm run build). Use sparingly; results return after the client verifies the command.',
    kind: 'client_resume',
    profiles: ['builder'],
    inputSchema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Shell command to run' },
      },
      required: ['cmd'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the live web via SearXNG. Use for current facts, docs, and citations. Prefer this over guessing.',
    kind: 'server',
    profiles: ['chat', 'project_chat', 'builder', 'plan'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (1-10, default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_extract',
    description:
      'Fetch a URL and return cleaned text for grounding. Use after web_search when a page looks relevant.',
    kind: 'server',
    profiles: ['chat', 'project_chat', 'builder', 'plan'],
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL' },
      },
      required: ['url'],
    },
  },
  {
    name: 'recall_project_memory',
    description:
      'Semantic search over durable project memory in CockroachDB (preferences, decisions, captures)',
    kind: 'server',
    profiles: ['chat', 'project_chat', 'builder', 'plan'],
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
    profiles: ['chat', 'project_chat', 'builder', 'plan'],
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
  return getToolDef(name)?.kind ?? 'client_resume';
}

/** True when the HTTP stream must pause for POST /tool-result. */
export function toolAwaitResult(name: string): boolean {
  return getToolKind(name) === 'client_resume';
}

/**
 * Resolve tool profile from mode + optional explicit profile.
 * Legacy: mode plan|build maps to plan|builder.
 */
export function resolveToolProfile(
  modeOrProfile: 'plan' | 'build' | ToolProfile = 'builder',
): ToolProfile {
  if (modeOrProfile === 'build') return 'builder';
  if (modeOrProfile === 'plan') return 'plan';
  return modeOrProfile;
}

/** Bedrock Converse toolConfig.tools */
export function toBedrockTools(
  modeOrProfile: 'plan' | 'build' | ToolProfile = 'builder',
  opts?: { webSearchEnabled?: boolean },
) {
  const profile = resolveToolProfile(modeOrProfile);
  let list = TOOLS.filter((t) => t.profiles.includes(profile));
  if (opts?.webSearchEnabled === false) {
    list = list.filter(
      (t) => t.name !== 'web_search' && t.name !== 'web_extract',
    );
  }

  return list.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description,
      inputSchema: { json: t.inputSchema },
    },
  }));
}
