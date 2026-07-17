import type { DbClient } from '@walkcroach/db';

export type SessionRow = {
  id: string;
  project_id: string;
  surface: string;
  model_config: Record<string, unknown>;
  pending_tool: PendingToolState | null;
  status: string;
};

export type PendingToolState = {
  awaiting: {
    toolCallId: string;
    tool: string;
    args: Record<string, unknown>;
  };
  /** Tool results already resolved (server / auto-acked client-local) in this batch */
  resolvedResults: BedrockToolResult[];
  /** Assistant content blocks from the tool_use turn (for Converse continuity) */
  assistantContent: unknown[];
};

export type BedrockToolResult = {
  toolUseId: string;
  content: Array<{ text: string }>;
  status: 'success' | 'error';
};

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: unknown;
};

export async function getSession(
  db: DbClient,
  sessionId: string,
): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT id, project_id, surface, model_config, pending_tool, status
     FROM sessions WHERE id = $1::uuid`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    pending_tool:
      typeof row.pending_tool === 'string'
        ? (JSON.parse(row.pending_tool) as PendingToolState)
        : row.pending_tool,
    model_config:
      typeof row.model_config === 'string'
        ? (JSON.parse(row.model_config) as Record<string, unknown>)
        : row.model_config ?? {},
  };
}

export async function setSessionStatus(
  db: DbClient,
  sessionId: string,
  status: string,
  pendingTool: PendingToolState | null = null,
): Promise<void> {
  await db.query(
    `UPDATE sessions
     SET status = $2,
         pending_tool = $3::jsonb,
         updated_at = now()
     WHERE id = $1::uuid`,
    [sessionId, status, pendingTool ? JSON.stringify(pendingTool) : null],
  );
}

export async function appendMessage(
  db: DbClient,
  sessionId: string,
  role: 'user' | 'assistant' | 'tool',
  content: unknown,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO messages (session_id, role, content)
     VALUES ($1::uuid, $2, $3::jsonb)
     RETURNING id`,
    [sessionId, role, JSON.stringify(content)],
  );
  return rows[0]!.id;
}

export async function listMessages(
  db: DbClient,
  sessionId: string,
): Promise<StoredMessage[]> {
  const { rows } = await db.query<{
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: unknown;
  }>(
    `SELECT id, role, content FROM messages
     WHERE session_id = $1::uuid
     ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content:
      typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
  }));
}

export async function appendBuildEvent(
  db: DbClient,
  sessionId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  resultSummary?: string,
): Promise<void> {
  await db.query(
    `INSERT INTO build_events (session_id, surface, tool_name, tool_args, result_summary)
     VALUES ($1::uuid, 'web', $2, $3::jsonb, $4)`,
    [
      sessionId,
      toolName,
      JSON.stringify(toolArgs),
      resultSummary ?? null,
    ],
  );
}
