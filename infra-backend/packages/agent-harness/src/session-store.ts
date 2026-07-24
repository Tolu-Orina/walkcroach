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
  /** Tool results already resolved (server / verified client) in this batch */
  resolvedResults: BedrockToolResult[];
  /** Assistant content blocks from the tool_use turn (for Converse continuity) */
  assistantContent: unknown[];
  /** File writes held for plan approval (tool === plan_approval) */
  deferredToolUses?: Array<{
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  /**
   * Remaining client tools from the same Converse batch, applied one-by-one
   * after each verified POST /tool-result (P1 — no optimistic acks).
   */
  queuedClientTools?: Array<{
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
  }>;
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
  attachments: unknown | null;
  citations: unknown | null;
};

export type MessageAttachmentMeta = {
  name: string;
  mime: string;
  textPreview: string;
  byteSize?: number;
  /** Object storage key when body was persisted (S3 / local artefacts). */
  storageKey?: string;
};

export type MessageCitationMeta = {
  title: string;
  url: string;
};

export type AppendMessageMeta = {
  attachments?: MessageAttachmentMeta[] | null;
  citations?: MessageCitationMeta[] | null;
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

/** Persist identical-failure streak across client tool resumes. */
export async function setToolLoopGuard(
  db: DbClient,
  sessionId: string,
  guard: { fingerprint: string | null; streak: number },
): Promise<void> {
  await db.query(
    `UPDATE sessions
     SET model_config = jsonb_set(
           COALESCE(model_config, '{}'::jsonb),
           '{toolLoopGuard}',
           $2::jsonb,
           true
         ),
         updated_at = now()
     WHERE id = $1::uuid`,
    [sessionId, JSON.stringify(guard)],
  );
}

function parseJsonCol(value: unknown): unknown | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

/** Extract http(s) citations from assistant content blocks / plain text. */
export function extractCitationsFromContent(
  content: unknown,
): MessageCitationMeta[] {
  const text = textFromStoredContent(content);
  if (!text) return [];
  const citations: MessageCitationMeta[] = [];
  const urlRe = /https?:\/\/[^\s)\]>'"]+/g;
  const urls = text.match(urlRe) ?? [];
  for (const url of urls.slice(0, 12)) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (!citations.some((c) => c.url === url)) {
        citations.push({ title: host, url });
      }
    } catch {
      /* skip */
    }
  }
  return citations;
}

function textFromStoredContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content ?? '');
    }
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n');
}

export async function appendMessage(
  db: DbClient,
  sessionId: string,
  role: 'user' | 'assistant' | 'tool',
  content: unknown,
  meta?: AppendMessageMeta,
): Promise<string> {
  const citations =
    meta?.citations ??
    (role === 'assistant' ? extractCitationsFromContent(content) : null);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO messages (session_id, role, content, attachments, citations)
     VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5::jsonb)
     RETURNING id`,
    [
      sessionId,
      role,
      JSON.stringify(content),
      meta?.attachments?.length ? JSON.stringify(meta.attachments) : null,
      citations?.length ? JSON.stringify(citations) : null,
    ],
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
    attachments: unknown | null;
    citations: unknown | null;
  }>(
    `SELECT id, role, content, attachments, citations FROM messages
     WHERE session_id = $1::uuid
     ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content:
      typeof r.content === 'string' ? JSON.parse(r.content) : r.content,
    attachments: parseJsonCol(r.attachments),
    citations: parseJsonCol(r.citations),
  }));
}

export async function getLatestSessionForProject(
  db: DbClient,
  projectId: string,
): Promise<{ id: string } | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM sessions
     WHERE project_id = $1::uuid
     ORDER BY updated_at DESC
     LIMIT 1`,
    [projectId],
  );
  return rows[0] ?? null;
}

export async function countProjectsForOwner(
  db: DbClient,
  ownerId: string,
): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::string AS count FROM projects
     WHERE owner_id = $1 AND deleted_at IS NULL`,
    [ownerId],
  );
  return Number(rows[0]?.count ?? 0);
}

export type BuildEventRow = {
  id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  result_summary: string | null;
  created_at: Date;
};

export async function listBuildEvents(
  db: DbClient,
  sessionId: string,
  limit = 100,
): Promise<BuildEventRow[]> {
  const { rows } = await db.query<{
    id: string;
    tool_name: string;
    tool_args: unknown;
    result_summary: string | null;
    created_at: Date;
  }>(
    `SELECT id, tool_name, tool_args, result_summary, created_at
     FROM build_events
     WHERE session_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    tool_name: r.tool_name,
    tool_args:
      typeof r.tool_args === 'string'
        ? (JSON.parse(r.tool_args) as Record<string, unknown>)
        : (r.tool_args as Record<string, unknown>) ?? {},
    result_summary: r.result_summary,
    created_at: r.created_at,
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
  // Dual-write §7 tool_invocations (project_id from session)
  await db.query(
    `INSERT INTO tool_invocations (session_id, project_id, tool_name, tool_args, result_summary)
     SELECT $1::uuid, s.project_id, $2, $3::jsonb, $4
     FROM sessions s
     WHERE s.id = $1::uuid`,
    [
      sessionId,
      toolName,
      JSON.stringify(toolArgs),
      resultSummary ?? null,
    ],
  );
}
