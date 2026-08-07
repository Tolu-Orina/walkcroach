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
  {
    name: 'recall_creative',
    description:
      'Semantic search over this owner’s past ready creatives (decks, flyers, images) — use for “like the bakery deck”, “another flyer like last time”, brand/palette recall.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to find (topic, brand, “like last deck”, etc.)',
        },
        limit: { type: 'number' },
        kind: {
          type: 'string',
          enum: ['slide_deck', 'flyer', 'image'],
          description: 'Optional filter',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_creative_memory',
    description:
      'Save a finished creative into project memory so later chats can recall “another like this”. Requires a linked project.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        note: {
          type: 'string',
          description: 'Optional short note (defaults to title + kind)',
        },
      },
      required: ['assetId'],
    },
  },
  {
    name: 'load_skill',
    description:
      'Load a WalkCroach Web creative skill (SKILL.md) into context. Use before image generation, slide/flyer creation, or any task matching a skill name in the catalog.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name from the available-skills catalog',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate a single image with Amazon Nova Canvas. Hard-capped at 3 per rolling day for every user; paid users additionally spend 5 credits. Call load_skill("walkcroach-image-gen") first if the catalog is present.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed visual description of the image to create',
        },
        aspect: {
          type: 'string',
          enum: ['square', 'landscape', 'portrait'],
          description: 'Defaults to square (1024x1024)',
        },
        negativePrompt: {
          type: 'string',
          description: 'What to avoid in the image',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_creative_brief',
    description:
      'Paid-only. Draft a structured slide deck brief with Nova 2 Lite (title, slides, bullets). Emits a ConfirmCard for the user before render_pptx. Call load_skill("walkcroach-pptx") first.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'What the deck is about',
        },
        slideCount: {
          type: 'number',
          description: 'Content slides (3–8, default 5). Title slide is added by the renderer.',
        },
        audience: { type: 'string' },
        tone: { type: 'string' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'render_pptx',
    description:
      'Paid-only. Render a confirmed slide brief to .pptx via lambda-creative (validate_pptx exit 0 required). Costs 20 credits. Prefer after the user confirms a generate_creative_brief ConfirmCard; pass assetId when available.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description: 'creative_assets id from generate_creative_brief',
        },
        brief: {
          type: 'object',
          description: 'Inline brief JSON when assetId is unavailable',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true — user confirmed the ConfirmCard',
        },
      },
      required: ['confirmed'],
    },
  },
  {
    name: 'generate_flyer_brief',
    description:
      'Paid-only. Draft a one-page flyer brief with Nova 2 Lite, including a short visual philosophy (walkcroach-creative-philosophy). Emits a ConfirmCard before render_flyer. Call load_skill("walkcroach-flyer") first.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'What the flyer promotes (sale, event, announcement)',
        },
        template: {
          type: 'string',
          enum: ['sale', 'event', 'announcement'],
          description: 'HTML template pack variant (default sale)',
        },
        brand: { type: 'string' },
        audience: { type: 'string' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'render_flyer',
    description:
      'Paid-only. Render a confirmed flyer brief to PDF via lambda-creative (check_flyer_pdf exit 0 required). Costs 10 credits. Pass assetId from generate_flyer_brief after ConfirmCard.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        assetId: {
          type: 'string',
          description: 'creative_assets id from generate_flyer_brief',
        },
        brief: {
          type: 'object',
          description: 'Inline flyer brief when assetId is unavailable',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true — user confirmed the ConfirmCard',
        },
      },
      required: ['confirmed'],
    },
  },
  {
    name: 'generate_video_brief',
    description:
      'Paid-only. Draft a ≤30s Video Studio brief for one Nova Reel MULTI_SHOT_AUTOMATED job (durationSeconds=30) plus Polly script. Emits a ConfirmCard. Costs 270 credits on confirm; 1 video / 72h. Call load_skill("walkcroach-video-studio") first.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'What the teaser/ad is about',
        },
        brand: { type: 'string' },
        audience: { type: 'string' },
        aspect: {
          type: 'string',
          enum: ['16:9', '9:16'],
          description: 'Output aspect; 9:16 crops after compose (default 16:9)',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'start_video_job',
    description:
      'Paid-only. Start a confirmed video job (debit 270, assert 72h cap, one MULTI_SHOT_AUTOMATED 30s Reel invoke, Polly+ffmpeg). Prefer the ConfirmCard REST path; if calling the tool, pass confirmed=true and jobId.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'video_jobs id from generate_video_brief',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true after ConfirmCard',
        },
      },
      required: ['jobId', 'confirmed'],
    },
  },
  {
    name: 'list_connectors',
    description:
      'List this owner’s connected workflow providers (Gmail, Calendar, Sheets, Slack, Stripe, HubSpot) and which OAuth apps are configured. Call before proposing an action if unsure what is connected.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'propose_connector_action',
    description:
      'Propose a catalogue connector action (gmail.send, calendar.create_event, slack.post_message, sheets.*, stripe.*, hubspot.*, …). Validates args, records a workflow_run as proposed, and shows a ConfirmCard. Never executes — wait for the user to Confirm. Call load_skill("walkcroach-connectors") first.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'Catalogue action id, e.g. gmail.send, calendar.create_event, slack.post_message',
        },
        args: {
          type: 'object',
          description: 'Action arguments matching the catalogue field specs',
        },
      },
      required: ['action', 'args'],
    },
  },
  {
    name: 'recall_workflow_runs',
    description:
      'Semantic search over past connector workflow runs (“what did we email last week”, “Slack posts about the sale”). Use after load_skill("walkcroach-connectors") when the user asks about prior sends/schedules.',
    kind: 'server',
    profiles: ['chat', 'project_chat'],
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
    name: 'cockroach_mcp',
    description:
      'Call a CockroachDB Cloud Managed MCP tool (list_tables, select_query, …). Read tools run immediately when CRDB_MCP_API_KEY is configured. Write/mutating MCP tools require confirmed=true after the user explicitly approves in chat.',
    kind: 'server',
    profiles: ['chat', 'project_chat', 'builder'],
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description: 'MCP tool name (e.g. list_tables, select_query)',
        },
        args: {
          type: 'object',
          description: 'Arguments for the MCP tool',
        },
        confirmed: {
          type: 'boolean',
          description: 'Required true for write/mutating MCP tools',
        },
        listOnly: {
          type: 'boolean',
          description: 'If true, only list available MCP tools (no call)',
        },
      },
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
