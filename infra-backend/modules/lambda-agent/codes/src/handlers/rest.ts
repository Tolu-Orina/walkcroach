import { createDbClient } from '@walkcroach/db';
import { getSession, listMessages } from '@walkcroach/agent-harness';
import { jsonResponse } from '../http.js';

export type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (typeof b.text === 'string') parts.push(b.text);
    else if (b.toolUse && typeof b.toolUse === 'object') {
      const tu = b.toolUse as { name?: string };
      parts.push(`[tool_use ${tu.name ?? 'unknown'}]`);
    } else if (b.toolResult) {
      parts.push('[tool_result]');
    }
  }
  return parts.join('\n').trim();
}

export async function handleRest(
  method: string,
  path: string,
  rawBody: string | undefined,
  pathParameters: Record<string, string | undefined> = {},
): Promise<RestResult> {
  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return jsonResponse(200, { ok: true, service: 'walkcroach-backend' });
  }

  if (method === 'POST' && (path === '/projects' || path.endsWith('/projects'))) {
    const body = JSON.parse(rawBody ?? '{}') as {
      name?: string;
      ownerId?: string;
    };
    const db = createDbClient();
    try {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO projects (owner_id, name)
         VALUES ($1, $2)
         RETURNING id`,
        [body.ownerId ?? 'anonymous', body.name ?? 'Untitled'],
      );
      return jsonResponse(201, { id: rows[0]!.id });
    } finally {
      await db.close();
    }
  }

  if (method === 'POST' && (path === '/sessions' || path.endsWith('/sessions'))) {
    const body = JSON.parse(rawBody ?? '{}') as { projectId?: string };
    if (!body.projectId) {
      return jsonResponse(400, { error: 'projectId required' });
    }
    const db = createDbClient();
    try {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO sessions (project_id)
         VALUES ($1::uuid)
         RETURNING id`,
        [body.projectId],
      );
      return jsonResponse(201, {
        id: rows[0]!.id,
        projectId: body.projectId,
      });
    } finally {
      await db.close();
    }
  }

  const sessionMatch = path.match(/\/sessions\/([^/]+)\/?$/);
  const sessionId = pathParameters.sessionId ?? sessionMatch?.[1];
  if (method === 'GET' && sessionId && !path.includes('/prompt') && !path.includes('/tool-result')) {
    const db = createDbClient();
    try {
      const session = await getSession(db, sessionId);
      if (!session) {
        return jsonResponse(404, { error: 'session not found' });
      }
      const messages = await listMessages(db, sessionId);
      return jsonResponse(200, {
        id: session.id,
        projectId: session.project_id,
        status: session.status,
        pendingTool: session.pending_tool
          ? {
              toolCallId: session.pending_tool.awaiting.toolCallId,
              tool: session.pending_tool.awaiting.tool,
              args: session.pending_tool.awaiting.args,
            }
          : null,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: textFromContent(m.content),
          raw: m.content,
        })),
      });
    } finally {
      await db.close();
    }
  }

  return jsonResponse(404, { error: 'not found', path, method });
}
