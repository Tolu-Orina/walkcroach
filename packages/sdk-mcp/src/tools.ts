import type { WalkCroach } from '@walkcroach/sdk';
import { ValidationError, WalkCroachError } from '@walkcroach/sdk';

/**
 * Tool surface exposed to MCP hosts.
 *
 * `recall_project_memory` and `remember` deliberately keep the names the
 * internal agent-harness already uses, so a prompt written against the first-
 * party surfaces ports to a third-party host without rewording.
 *
 * Every tool declares an `outputSchema`. 2026-07-28 loosened schemas to full
 * JSON Schema 2020-12, and declaring output means hosts receive
 * `structuredContent` instead of parsing prose back out of a text block.
 */

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** Scope the caller's credential must carry. */
  scope: 'memory:read' | 'memory:write';
};

const projectIdProp = {
  type: 'string',
  format: 'uuid',
  description:
    'WalkCroach project id. Required — memory is always tenant-scoped, and an ' +
    'unscoped query cannot use the vector index.',
};

/**
 * Sorted by name and frozen in this order.
 *
 * SEP-2549 asks servers to return `tools/list` deterministically so hosts can
 * cache it and so the LLM prompt prefix stays byte-identical between calls,
 * which is what makes provider-side prompt caching hit.
 */
export const TOOLS: readonly ToolDef[] = [
  {
    name: 'list_memory',
    title: 'List recent memory',
    description:
      'List recent memory entries for a project in reverse chronological order. ' +
      'Use this to show what is stored; use recall_project_memory to search by meaning.',
    scope: 'memory:read',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: projectIdProp,
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        surfaces: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to entries written by these surfaces (web, chrome, ide, cli, …).',
        },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { type: 'string' },
              text: { type: 'string' },
              surface: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'kind', 'text', 'surface', 'createdAt'],
          },
        },
      },
      required: ['entries'],
    },
  },
  {
    name: 'memory_timeline',
    title: 'Memory timeline (point-in-time)',
    description:
      'What changed in the project memory between two instants, read from CockroachDB MVCC ' +
      'via AS OF SYSTEM TIME. Answers "what did the agent believe when it made this change?". ' +
      'Bounded by the cluster retention window (currently 25 hours); older state is ' +
      'garbage-collected and unrecoverable.',
    scope: 'memory:read',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: projectIdProp,
        from: {
          type: 'string',
          format: 'date-time',
          description: 'ISO instant to compare from. Must be within the retention window.',
        },
        to: {
          type: 'string',
          description: 'ISO instant, or "now" (default).',
          default: 'now',
        },
      },
      required: ['projectId', 'from'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        added: { type: 'array', items: { type: 'object' } },
        retired: { type: 'array', items: { type: 'object' } },
        unchanged: { type: 'integer' },
      },
      required: ['from', 'to', 'added', 'retired', 'unchanged'],
    },
  },
  {
    name: 'recall_project_memory',
    title: 'Recall project memory',
    description:
      'Semantic search over the shared WalkCroach memory for a project. Returns decisions, ' +
      'preferences, and conventions previously recorded from any surface — the web builder, ' +
      'the Chrome extension, the IDE, the CLI, or another SDK client. Call this before ' +
      'making architectural choices so you do not contradict an earlier decision.',
    scope: 'memory:read',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: projectIdProp,
        query: {
          type: 'string',
          description: 'Natural-language description of what you want to remember.',
          minLength: 1,
        },
        limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        kinds: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['decision', 'preference', 'convention', 'summary', 'capture', 'qa'],
          },
        },
        surfaces: { type: 'array', items: { type: 'string' } },
        asOf: {
          type: 'string',
          format: 'date-time',
          description:
            'Optional: search memory as it stood at this instant rather than now.',
        },
      },
      required: ['projectId', 'query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        hits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { type: 'string' },
              text: { type: 'string' },
              surface: { type: 'string' },
              relevance: { type: ['number', 'null'], minimum: 0, maximum: 1 },
            },
            required: ['id', 'kind', 'text', 'surface'],
          },
        },
      },
      required: ['hits'],
    },
  },
  {
    name: 'remember',
    title: 'Remember a decision or preference',
    description:
      'Record a durable fact about this project — an architectural decision, a user ' +
      'preference, a convention. It becomes recallable from every WalkCroach surface. ' +
      'If this restates something already stored, the older entry is retired and its id is ' +
      'returned as supersededId; tell the user when that happens.',
    scope: 'memory:write',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: projectIdProp,
        text: {
          type: 'string',
          minLength: 1,
          maxLength: 20000,
          description: 'The fact to remember, stated so it makes sense months later.',
        },
        kind: {
          type: 'string',
          enum: ['decision', 'preference', 'convention', 'summary', 'capture', 'qa'],
          default: 'decision',
        },
        surface: {
          type: 'string',
          description: 'Who is writing this (e.g. your app name). Defaults to "sdk".',
        },
      },
      required: ['projectId', 'text'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        supersededId: { type: ['string', 'null'] },
        kind: { type: 'string' },
        surface: { type: 'string' },
      },
      required: ['id', 'supersededId'],
    },
  },
];

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export type ToolOutcome = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function textOf(value: string): ToolOutcome['content'] {
  return [{ type: 'text', text: value }];
}

/**
 * Execute a tool against the memory API.
 *
 * Errors are returned as `isError` tool results rather than JSON-RPC errors: a
 * protocol error tells the host the call was malformed, while a failed recall is
 * a normal outcome the model should read and react to.
 */
export async function executeTool(
  wc: WalkCroach,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'recall_project_memory': {
        const reader = args.asOf
          ? wc.memory.asOf(String(args.asOf))
          : wc.memory;
        const hits = await reader.recall({
          projectId: String(args.projectId ?? ''),
          query: String(args.query ?? ''),
          limit: args.limit === undefined ? undefined : Number(args.limit),
          kinds: args.kinds as never,
          surfaces: args.surfaces as string[] | undefined,
        });
        if (hits.length === 0) {
          return {
            content: textOf(
              'No matching memory for this project. This may genuinely be the first time ' +
                'the topic has come up — say so rather than inventing prior context.',
            ),
            structuredContent: { hits: [] },
          };
        }
        const rendered = hits
          .map(
            (h, i) =>
              `${i + 1}. [${h.kind} · ${h.surface}] ${h.text}` +
              (h.relevance === null ? '' : ` (relevance ${h.relevance.toFixed(2)})`),
          )
          .join('\n');
        return {
          content: textOf(`Recalled ${hits.length} memories:\n${rendered}`),
          structuredContent: { hits },
        };
      }

      case 'remember': {
        const res = await wc.memory.remember({
          projectId: String(args.projectId ?? ''),
          text: String(args.text ?? ''),
          kind: (args.kind as never) ?? 'decision',
          surface: args.surface ? String(args.surface) : 'mcp',
        });
        return {
          content: textOf(
            res.supersededId
              ? `Remembered (id ${res.id}). This replaced an earlier entry (${res.supersededId}) ` +
                  `that said something very similar — mention that to the user.`
              : `Remembered (id ${res.id}).`,
          ),
          structuredContent: { ...res },
        };
      }

      case 'list_memory': {
        const entries = await wc.memory.list({
          projectId: String(args.projectId ?? ''),
          limit: args.limit === undefined ? undefined : Number(args.limit),
          surfaces: args.surfaces as string[] | undefined,
        });
        return {
          content: textOf(
            entries.length === 0
              ? 'No memory entries for this project yet.'
              : entries
                  .map((e) => `- [${e.kind} · ${e.surface} · ${e.createdAt}] ${e.text}`)
                  .join('\n'),
          ),
          structuredContent: { entries },
        };
      }

      case 'memory_timeline': {
        const diff = await wc.memory.diff({
          projectId: String(args.projectId ?? ''),
          from: String(args.from ?? ''),
          to: args.to === undefined || args.to === 'now' ? 'now' : String(args.to),
        });
        const lines = [
          `Between ${diff.from} and ${diff.to}:`,
          `  ${diff.added.length} added, ${diff.retired.length} retired, ${diff.unchanged} unchanged.`,
          ...diff.added.map((e) => `  + [${e.kind}] ${e.text}`),
          ...diff.retired.map((e) => `  - [${e.kind}] ${e.text}`),
        ];
        return {
          content: textOf(lines.join('\n')),
          structuredContent: { ...diff },
        };
      }

      default:
        return { content: textOf(`Unknown tool: ${name}`), isError: true };
    }
  } catch (err) {
    if (err instanceof ValidationError && err.code === 'RETENTION_WINDOW_EXCEEDED') {
      return {
        content: textOf(
          `${err.message}\n\nThis is a hard storage limit, not a permission problem — the ` +
            `older state no longer exists. Pick a more recent timestamp.`,
        ),
        isError: true,
      };
    }
    if (err instanceof WalkCroachError) {
      return {
        content: textOf(
          `${err.name}: ${err.message}` + (err.requestId ? ` (request ${err.requestId})` : ''),
        ),
        isError: true,
      };
    }
    throw err;
  }
}
