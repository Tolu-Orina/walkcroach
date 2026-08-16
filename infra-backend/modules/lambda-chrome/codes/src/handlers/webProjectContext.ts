import { recallProjectMemory } from '@walkcroach/agent-harness';
import type { AuthContext } from '../auth.js';
import { getLinkedProjectId } from './link.js';
import { metricLog } from '../util.js';

type Db = {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type WebProjectContext = {
  projectId: string | null;
  projectName: string | null;
  memoryLines: string[];
  chatLines: string[];
};

/** Pull plain text out of a stored Converse-style message body. */
export function textFromMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        return textFromMessageContent(JSON.parse(trimmed));
      } catch {
        return content.slice(0, 1200);
      }
    }
    return content.slice(0, 1200);
  }
  if (!Array.isArray(content)) {
    if (content && typeof content === 'object' && 'text' in content) {
      const t = (content as { text?: unknown }).text;
      return typeof t === 'string' ? t.slice(0, 1200) : '';
    }
    return '';
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const t = (block as { text?: unknown }).text;
    if (typeof t === 'string' && t.trim()) parts.push(t.trim());
  }
  return parts.join('\n').slice(0, 1200);
}

export function formatWebProjectBlock(ctx: WebProjectContext): string {
  if (!ctx.memoryLines.length && !ctx.chatLines.length) return '';
  const title = ctx.projectName
    ? `WalkCroach Web project “${ctx.projectName}”`
    : 'WalkCroach Web project';
  const parts = [`${title} (shared memory — use this when the page does not answer):`];
  if (ctx.memoryLines.length) {
    parts.push(`Project memory:\n${ctx.memoryLines.join('\n')}`);
  }
  if (ctx.chatLines.length) {
    parts.push(`Recent Web chat:\n${ctx.chatLines.join('\n')}`);
  }
  return parts.join('\n\n');
}

export function hasWebProjectContext(ctx: WebProjectContext): boolean {
  return ctx.memoryLines.length > 0 || ctx.chatLines.length > 0;
}

/**
 * Linked workspace project, else the owner's most recently updated Web project.
 * Used so Chrome Ask/Recall can see Web chats without a second surface hop.
 */
export async function loadWebProjectContext(
  db: Db,
  auth: AuthContext,
  opts: { workspaceId?: string | null; question: string },
): Promise<WebProjectContext> {
  const empty: WebProjectContext = {
    projectId: null,
    projectName: null,
    memoryLines: [],
    chatLines: [],
  };
  if (auth.isAnonymous || auth.source === 'device') return empty;

  let projectId: string | null = null;
  if (opts.workspaceId) {
    projectId = await getLinkedProjectId(db as never, opts.workspaceId, auth.ownerId);
  }

  if (!projectId) {
    const { rows } = await db.query<{ id: string; name: string }>(
      `SELECT id, name
         FROM projects
        WHERE owner_id = $1
          AND deleted_at IS NULL
          AND archived_at IS NULL
          AND kind IN ('app', 'knowledge')
        ORDER BY updated_at DESC
        LIMIT 1`,
      [auth.ownerId],
    );
    projectId = rows[0]?.id ?? null;
    if (!projectId) return empty;
  }

  const { rows: projects } = await db.query<{ name: string }>(
    `SELECT name FROM projects
      WHERE id = $1::uuid AND owner_id = $2 AND deleted_at IS NULL`,
    [projectId, auth.ownerId],
  );
  const projectName = projects[0]?.name ?? null;
  if (!projectName) return empty;

  const memoryLines: string[] = [];
  try {
    const hits = await recallProjectMemory({
      db: db as never,
      projectId,
      query: opts.question,
      limit: 6,
    });
    for (const hit of hits) {
      memoryLines.push(
        `- [${(hit.sourceSurface ?? 'unknown').toLowerCase()}|${hit.kind}] ${hit.text.slice(0, 400)}`,
      );
    }
  } catch (err) {
    metricLog('chrome.web_context.memory', {
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 80) : 'error',
    });
  }

  const { rows: chats } = await db.query<{
    role: string;
    content: unknown;
    created_at: string;
  }>(
    `SELECT m.role, m.content, m.created_at
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
      WHERE s.project_id = $1::uuid
        AND m.role IN ('user', 'assistant')
      ORDER BY m.created_at DESC
      LIMIT 16`,
    [projectId],
  );

  const chatLines = chats
    .reverse()
    .map((row) => {
      const text = textFromMessageContent(row.content).replace(/\s+/g, ' ').trim();
      if (!text) return null;
      const who = row.role === 'user' ? 'You' : 'WalkCroach';
      return `${who}: ${text.slice(0, 500)}`;
    })
    .filter((line): line is string => Boolean(line));

  metricLog('chrome.web_context.loaded', {
    ok: true,
    memory: memoryLines.length,
    chat: chatLines.length,
    linked: Boolean(opts.workspaceId && projectId),
  });

  return { projectId, projectName, memoryLines, chatLines };
}
