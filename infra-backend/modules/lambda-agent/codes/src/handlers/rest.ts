import { createDbClient } from '@walkcroach/db';
import {
  countProjectsForOwner,
  embedProjectDocument,
  getLatestSessionForProject,
  getSession,
  listBuildEvents,
  listMessages,
  listProjectMemoryEntries,
} from '@walkcroach/agent-harness';
import { requireAuth, type AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import {
  handleCreateCheckpoint,
  handleExportProject,
  handleListCheckpoints,
  handleRevertCheckpoint,
  handleSyncFiles,
} from './projectArtifacts.js';
import { getUsageSummary } from './billing.js';
import {
  handleListDeployments,
  handleTriggerDeploy,
} from './deploy.js';
import {
  handleGithubConnect,
  handleGithubInstallCallback,
  handleGithubPull,
  handleGithubPush,
  handleGithubStatus,
} from './github.js';
import {
  handleGetAppResources,
  handleGetSecrets,
  handleInlineEdit,
  handleInlineEditQuota,
  handleProvisionDatabase,
  handleProxyHttp,
  handleProxySql,
  handlePutSecret,
} from './phase2.js';
import {
  handleSandboxFileGet,
  handleSandboxRoutes,
} from './sandbox.js';
import {
  handleCreateCodeArtefact,
  handleGetCodeArtefact,
  handleListCodeArtefacts,
} from './codeArtefacts.js';
import { handleListMyApps } from './apps.js';

export type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const ANON_PROJECT_LIMIT = 1;

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

type ProjectRow = {
  id: string;
  owner_id: string;
  name: string;
  status: string;
  updated_at: Date;
  created_at: Date;
  template_id: string | null;
  memory_summary: string | null;
  kind?: string | null;
  description?: string | null;
  instructions?: string | null;
  archived_at?: Date | null;
};

async function assertProjectOwner(
  db: ReturnType<typeof createDbClient>,
  projectId: string,
  auth: AuthContext,
  opts?: { allowArchived?: boolean },
): Promise<ProjectRow | null> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT id, owner_id, name, status, updated_at, created_at, template_id,
            memory_summary, kind, description, instructions, archived_at
     FROM projects
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id !== auth.ownerId) return null;
  if (!opts?.allowArchived && row.archived_at) return null;
  return row;
}

function mapProjectSummary(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status ?? 'draft',
    updatedAt: row.updated_at.toISOString(),
    memorySummary: row.memory_summary,
    kind: row.kind ?? 'app',
    description: row.description ?? null,
  };
}

function mapProjectDetail(row: ProjectRow) {
  return {
    ...mapProjectSummary(row),
    ownerId: row.owner_id,
    createdAt: row.created_at.toISOString(),
    templateId: row.template_id,
    instructions: row.instructions ?? null,
  };
}

function isProjectsListPath(path: string): boolean {
  return path === '/projects' || /\/projects\/?$/.test(path);
}

export async function handleRest(
  method: string,
  path: string,
  rawBody: string | undefined,
  pathParameters: Record<string, string | undefined> = {},
  headers: Record<string, string | undefined> = {},
  queryString = '',
): Promise<RestResult> {
  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return jsonResponse(200, { ok: true, service: 'walkcroach-backend' });
  }

  // Phase E — Code library + Apps hub
  if (
    method === 'GET' &&
    (path === '/code-artefacts' || path.endsWith('/code-artefacts'))
  ) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const projectId = pathParameters.projectId;
      return await handleListCodeArtefacts(db, authResult, {
        projectId: projectId || undefined,
      });
    } finally {
      await db.close();
    }
  }

  if (
    method === 'POST' &&
    (path === '/code-artefacts' || path.endsWith('/code-artefacts'))
  ) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleCreateCodeArtefact(db, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const codeArtefactMatch = path.match(/\/code-artefacts\/([^/]+)\/?$/);
  const codeArtefactId = codeArtefactMatch?.[1] ?? pathParameters.artefactId;
  if (method === 'GET' && codeArtefactId && path.includes('/code-artefacts/')) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleGetCodeArtefact(db, codeArtefactId, authResult);
    } finally {
      await db.close();
    }
  }

  if (method === 'GET' && (path === '/apps/mine' || path.endsWith('/apps/mine'))) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleListMyApps(db, authResult);
    } finally {
      await db.close();
    }
  }

  // E2B sandbox (Phase D RT-10) — before generic project routes
  if (path.includes('/sandbox')) {
    const sandboxFileMatch = path.match(
      /\/projects\/([^/]+)\/sandbox\/file\/?$/,
    );
    if (method === 'GET' && sandboxFileMatch) {
      const qPath =
        pathParameters.path ??
        (typeof pathParameters.filePath === 'string'
          ? pathParameters.filePath
          : '');
      // Query string is stripped from `path`; clients use POST /sandbox/read.
      if (qPath) {
        return handleSandboxFileGet(sandboxFileMatch[1]!, qPath, headers);
      }
    }
    const sandboxResult = await handleSandboxRoutes(
      method,
      path,
      rawBody,
      headers,
    );
    if (sandboxResult) return sandboxResult;
  }

  const projectIdParam =
    pathParameters.projectId ??
    path.match(/\/projects\/([^/]+)/)?.[1];

  if (method === 'GET' && isProjectsListPath(path)) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const { rows } = await db.query<ProjectRow>(
        `SELECT id, owner_id, name, status, updated_at, created_at, template_id,
                memory_summary, kind, description, instructions
         FROM projects
         WHERE owner_id = $1 AND deleted_at IS NULL AND archived_at IS NULL
           AND COALESCE(kind, 'app') <> 'general'
         ORDER BY updated_at DESC
         LIMIT 100`,
        [authResult.ownerId],
      );
      return jsonResponse(200, {
        projects: rows.map(mapProjectSummary),
      });
    } finally {
      await db.close();
    }
  }

  const latestSessionMatch = path.match(/\/projects\/([^/]+)\/sessions\/latest\/?$/);
  const latestProjectId = latestSessionMatch?.[1] ?? pathParameters.projectId;
  if (method === 'GET' && latestProjectId && path.includes('/sessions/latest')) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(db, latestProjectId, authResult);
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const latest = await getLatestSessionForProject(db, latestProjectId);
      if (!latest) {
        return jsonResponse(404, { error: 'no sessions for project' });
      }
      return jsonResponse(200, { sessionId: latest.id, projectId: latestProjectId });
    } finally {
      await db.close();
    }
  }

  const archiveMatch = path.match(/\/projects\/([^/]+)\/archive\/?$/);
  const archiveProjectId = archiveMatch?.[1];
  if (method === 'POST' && archiveProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(db, archiveProjectId, authResult);
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      await db.query(
        `UPDATE projects SET archived_at = now(), status = 'archived', updated_at = now()
         WHERE id = $1::uuid`,
        [archiveProjectId],
      );
      return jsonResponse(200, { ok: true, id: archiveProjectId });
    } finally {
      await db.close();
    }
  }

  if (method === 'DELETE' && projectIdParam && path.match(/\/projects\/[^/]+\/?$/)) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(db, projectIdParam, authResult);
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      await db.query(
        `UPDATE projects SET deleted_at = now(), updated_at = now()
         WHERE id = $1::uuid`,
        [projectIdParam],
      );
      return jsonResponse(200, { ok: true, id: projectIdParam });
    } finally {
      await db.close();
    }
  }

  if (
    method === 'GET' &&
    projectIdParam &&
    path.match(/\/projects\/[^/]+\/?$/)
  ) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const row = await assertProjectOwner(db, projectIdParam, authResult, {
        allowArchived: true,
      });
      if (!row) {
        return jsonResponse(404, { error: 'project not found' });
      }
      return jsonResponse(200, mapProjectDetail(row));
    } finally {
      await db.close();
    }
  }

  if (
    method === 'PATCH' &&
    projectIdParam &&
    path.match(/\/projects\/[^/]+\/?$/)
  ) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const body = JSON.parse(rawBody ?? '{}') as {
      name?: string;
      description?: string | null;
      instructions?: string | null;
      templateId?: string;
    };
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(db, projectIdParam, authResult);
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const name =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 200)
          : project.name;
      const description =
        body.description === undefined
          ? (project.description ?? null)
          : body.description === null
            ? null
            : String(body.description).slice(0, 8000);
      const instructions =
        body.instructions === undefined
          ? (project.instructions ?? null)
          : body.instructions === null
            ? null
            : String(body.instructions).slice(0, 16000);
      const templateId =
        typeof body.templateId === 'string' && body.templateId.trim()
          ? body.templateId.trim().slice(0, 80)
          : project.template_id;
      const { rows } = await db.query<ProjectRow>(
        `UPDATE projects
         SET name = $2,
             description = $3,
             instructions = $4,
             template_id = $5,
             updated_at = now()
         WHERE id = $1::uuid
         RETURNING id, owner_id, name, status, updated_at, created_at, template_id,
                   memory_summary, kind, description, instructions`,
        [projectIdParam, name, description, instructions, templateId],
      );
      return jsonResponse(200, mapProjectDetail(rows[0]!));
    } finally {
      await db.close();
    }
  }

  if (method === 'POST' && isProjectsListPath(path)) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const body = JSON.parse(rawBody ?? '{}') as {
      name?: string;
      templateId?: string;
      kind?: 'app' | 'general';
    };
    const db = createDbClient();
    try {
      if (authResult.isAnonymous) {
        const count = await countProjectsForOwner(db, authResult.ownerId);
        if (count >= ANON_PROJECT_LIMIT) {
          return jsonResponse(403, {
            error: 'guest project limit reached — sign in to create more',
          });
        }
      }

      const templateId = body.templateId ?? 'blank';
      const kind = body.kind === 'general' ? 'general' : 'app';
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO projects (owner_id, name, template_id, kind)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [authResult.ownerId, body.name ?? 'Untitled', templateId, kind],
      );
      return jsonResponse(201, { id: rows[0]!.id, templateId, kind });
    } finally {
      await db.close();
    }
  }

  // Personal Chat workspace (kind=general) — get or create
  if (
    method === 'POST' &&
    (path === '/me/chat-workspace' || path.endsWith('/me/chat-workspace'))
  ) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM projects
         WHERE owner_id = $1 AND deleted_at IS NULL
           AND COALESCE(kind, 'app') = 'general'
           AND name = $2
         ORDER BY created_at ASC
         LIMIT 1`,
        [authResult.ownerId, '__walkcroach_chat__'],
      );
      if (existing.rows[0]) {
        return jsonResponse(200, { id: existing.rows[0].id });
      }
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO projects (owner_id, name, template_id, kind, status)
         VALUES ($1, $2, NULL, 'general', 'ready')
         RETURNING id`,
        [authResult.ownerId, '__walkcroach_chat__'],
      );
      return jsonResponse(201, { id: rows[0]!.id });
    } finally {
      await db.close();
    }
  }

  if (method === 'POST' && (path === '/sessions' || path.endsWith('/sessions'))) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const body = JSON.parse(rawBody ?? '{}') as {
      projectId?: string;
      mode?: 'chat' | 'builder';
    };
    if (!body.projectId) {
      return jsonResponse(400, { error: 'projectId required' });
    }
    const mode = body.mode === 'chat' ? 'chat' : 'builder';
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(db, body.projectId, authResult);
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO sessions (project_id, mode, title)
         VALUES ($1::uuid, $2, $3)
         RETURNING id`,
        [
          body.projectId,
          mode,
          mode === 'chat' ? 'New chat' : null,
        ],
      );
      await db.query(
        `UPDATE projects SET updated_at = now() WHERE id = $1::uuid`,
        [body.projectId],
      );
      return jsonResponse(201, {
        id: rows[0]!.id,
        projectId: body.projectId,
        mode,
      });
    } finally {
      await db.close();
    }
  }

  // List sessions for a project (chat + builder timeline)
  const sessionsListMatch = path.match(/\/projects\/([^/]+)\/sessions\/?$/);
  const sessionsListProjectId = sessionsListMatch?.[1];
  if (method === 'GET' && sessionsListProjectId && !path.includes('/latest')) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(
        db,
        sessionsListProjectId,
        authResult,
      );
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const qs = new URLSearchParams(queryString);
      const modeFilter = qs.get('mode');
      const limitRaw = Number(qs.get('limit') ?? 40);
      const limit = Math.min(
        Math.max(Number.isFinite(limitRaw) ? limitRaw : 40, 1),
        100,
      );
      const params: unknown[] = [sessionsListProjectId];
      let modeSql = '';
      if (modeFilter === 'chat' || modeFilter === 'builder') {
        params.push(modeFilter);
        modeSql = ` AND COALESCE(mode, 'builder') = $${params.length}`;
      }
      params.push(limit);
      const { rows } = await db.query<{
        id: string;
        title: string | null;
        mode: string | null;
        started_at: Date;
      }>(
        `SELECT id, title, mode, started_at
         FROM sessions
         WHERE project_id = $1::uuid${modeSql}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params,
      );
      return jsonResponse(200, {
        sessions: rows.map((r) => ({
          id: r.id,
          title: r.title,
          mode: r.mode ?? 'builder',
          createdAt: r.started_at.toISOString(),
        })),
      });
    } finally {
      await db.close();
    }
  }

  // Project documents
  const documentsListMatch = path.match(
    /\/projects\/([^/]+)\/documents\/?$/,
  );
  const documentsProjectId = documentsListMatch?.[1];
  const documentItemMatch = path.match(
    /\/projects\/([^/]+)\/documents\/([^/]+)\/?$/,
  );
  const documentItemProjectId = documentItemMatch?.[1];
  const documentId = documentItemMatch?.[2];

  if (method === 'GET' && documentsProjectId && !documentId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(
        db,
        documentsProjectId,
        authResult,
      );
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const { rows } = await db.query<{
        id: string;
        name: string;
        mime: string;
        byte_size: string | number;
        created_at: Date;
        text_content: string | null;
        chunk_count: string | number;
      }>(
        `SELECT id, name, mime, byte_size, created_at, text_content,
                (SELECT count(*)::int FROM project_document_chunks c
                 WHERE c.document_id = project_documents.id) AS chunk_count
         FROM project_documents
         WHERE project_id = $1::uuid
         ORDER BY created_at DESC
         LIMIT 50`,
        [documentsProjectId],
      );
      return jsonResponse(200, {
        documents: rows.map((r) => ({
          id: r.id,
          name: r.name,
          mime: r.mime,
          byteSize: Number(r.byte_size) || 0,
          createdAt: r.created_at.toISOString(),
          hasText: Boolean(r.text_content?.trim()),
          chunkCount: Number(r.chunk_count) || 0,
          ingestStatus:
            Number(r.chunk_count) > 0
              ? 'ok'
              : r.text_content?.trim()
                ? 'failed'
                : 'skipped',
        })),
      });
    } finally {
      await db.close();
    }
  }

  if (method === 'POST' && documentsProjectId && !documentId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const body = JSON.parse(rawBody ?? '{}') as {
      name?: string;
      mime?: string;
      textContent?: string;
    };
    const name = body.name?.trim();
    if (!name) {
      return jsonResponse(400, { error: 'name required' });
    }
    const textContent = (body.textContent ?? '').slice(0, 200_000);
    const mime = body.mime?.trim() || 'text/plain';
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(
        db,
        documentsProjectId,
        authResult,
      );
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const { rows } = await db.query<{
        id: string;
        name: string;
        mime: string;
        byte_size: string | number;
        created_at: Date;
      }>(
        `INSERT INTO project_documents
           (project_id, name, mime, s3_key, byte_size, text_content)
         VALUES ($1::uuid, $2, $3, NULL, $4, $5)
         RETURNING id, name, mime, byte_size, created_at`,
        [
          documentsProjectId,
          name.slice(0, 240),
          mime.slice(0, 120),
          Buffer.byteLength(textContent, 'utf8'),
          textContent || null,
        ],
      );
      await db.query(
        `UPDATE projects SET updated_at = now() WHERE id = $1::uuid`,
        [documentsProjectId],
      );
      const row = rows[0]!;
      let chunkCount = 0;
      let ingestStatus: 'ok' | 'failed' | 'skipped' = textContent.trim()
        ? 'failed'
        : 'skipped';
      if (textContent.trim()) {
        try {
          const ingested = await embedProjectDocument({
            db,
            documentId: row.id,
            projectId: documentsProjectId,
            text: textContent,
          });
          chunkCount = ingested.chunkCount;
          ingestStatus = chunkCount > 0 ? 'ok' : 'failed';
        } catch {
          ingestStatus = 'failed';
        }
      }
      return jsonResponse(201, {
        id: row.id,
        name: row.name,
        mime: row.mime,
        byteSize: Number(row.byte_size) || 0,
        createdAt: row.created_at.toISOString(),
        hasText: Boolean(textContent.trim()),
        chunkCount,
        ingestStatus,
      });
    } finally {
      await db.close();
    }
  }

  if (method === 'DELETE' && documentItemProjectId && documentId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(
        db,
        documentItemProjectId,
        authResult,
      );
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const { rows: deleted } = await db.query<{ id: string }>(
        `DELETE FROM project_documents
         WHERE id = $1::uuid AND project_id = $2::uuid
         RETURNING id`,
        [documentId, documentItemProjectId],
      );
      if (!deleted[0]) {
        return jsonResponse(404, { error: 'document not found' });
      }
      await db.query(
        `UPDATE projects SET updated_at = now() WHERE id = $1::uuid`,
        [documentItemProjectId],
      );
      return jsonResponse(200, { ok: true, id: documentId });
    } finally {
      await db.close();
    }
  }

  // Remembered panel — project memory entries
  const memoryMatch = path.match(/\/projects\/([^/]+)\/memory\/?$/);
  const memoryProjectId = memoryMatch?.[1];
  if (method === 'GET' && memoryProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(db, memoryProjectId, authResult);
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const entries = await listProjectMemoryEntries({
        db,
        projectId: memoryProjectId,
        limit: 40,
      });
      return jsonResponse(200, {
        summary: project.memory_summary,
        entries,
      });
    } finally {
      await db.close();
    }
  }

  const activityMatch = path.match(/\/sessions\/([^/]+)\/activity\/?$/);
  const activitySessionId = activityMatch?.[1];
  if (method === 'GET' && activitySessionId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const session = await getSession(db, activitySessionId);
      if (!session) {
        return jsonResponse(404, { error: 'session not found' });
      }
      const project = await assertProjectOwner(db, session.project_id, authResult);
      if (!project) {
        return jsonResponse(404, { error: 'session not found' });
      }
      const events = await listBuildEvents(db, activitySessionId);
      return jsonResponse(200, {
        events: events.map((e) => ({
          id: e.id,
          tool: e.tool_name,
          args: e.tool_args,
          summary: e.result_summary,
          at: e.created_at.toISOString(),
        })),
      });
    } finally {
      await db.close();
    }
  }

  const revertMatch = path.match(/\/checkpoints\/([^/]+)\/revert\/?$/);
  const revertCheckpointId = revertMatch?.[1];
  if (method === 'POST' && revertCheckpointId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleRevertCheckpoint(db, revertCheckpointId, authResult);
    } finally {
      await db.close();
    }
  }

  const syncMatch = path.match(/\/projects\/([^/]+)\/files\/sync\/?$/);
  const syncProjectId = syncMatch?.[1];
  if (method === 'POST' && syncProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleSyncFiles(db, syncProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const checkpointsListMatch = path.match(/\/projects\/([^/]+)\/checkpoints\/?$/);
  const checkpointsProjectId = checkpointsListMatch?.[1];
  if (method === 'GET' && checkpointsProjectId && path.includes('/checkpoints')) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleListCheckpoints(db, checkpointsProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  if (method === 'POST' && checkpointsProjectId && path.includes('/checkpoints')) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleCreateCheckpoint(db, checkpointsProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const exportMatch = path.match(/\/projects\/([^/]+)\/export\/?$/);
  const exportProjectId = exportMatch?.[1];
  if (method === 'GET' && exportProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleExportProject(db, exportProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  const resourcesMatch = path.match(/\/projects\/([^/]+)\/resources\/?$/);
  const resourcesProjectId = resourcesMatch?.[1];
  if (method === 'GET' && resourcesProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleGetAppResources(db, resourcesProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  const secretsMatch = path.match(/\/projects\/([^/]+)\/secrets\/?$/);
  const secretsProjectId = secretsMatch?.[1];
  if (method === 'GET' && secretsProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleGetSecrets(db, secretsProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  if (method === 'POST' && secretsProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handlePutSecret(db, secretsProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const provisionMatch = path.match(/\/projects\/([^/]+)\/provision-database\/?$/);
  const provisionProjectId = provisionMatch?.[1];
  if (method === 'POST' && provisionProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleProvisionDatabase(db, provisionProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  const inlineQuotaMatch = path.match(/\/projects\/([^/]+)\/inline-edit\/quota\/?$/);
  const inlineQuotaProjectId = inlineQuotaMatch?.[1];
  if (method === 'GET' && inlineQuotaProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleInlineEditQuota(db, inlineQuotaProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  const inlineEditMatch = path.match(/\/projects\/([^/]+)\/inline-edit\/?$/);
  const inlineEditProjectId = inlineEditMatch?.[1];
  if (method === 'POST' && inlineEditProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleInlineEdit(db, inlineEditProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const deployMatch = path.match(/\/projects\/([^/]+)\/deploy\/?$/);
  const deployProjectId = deployMatch?.[1];
  if (method === 'POST' && deployProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleTriggerDeploy(db, deployProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const deploymentsMatch = path.match(/\/projects\/([^/]+)\/deployments\/?$/);
  const deploymentsProjectId = deploymentsMatch?.[1];
  if (method === 'GET' && deploymentsProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleListDeployments(db, deploymentsProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  if (method === 'POST' && (path === '/github/callback' || path.endsWith('/github/callback'))) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleGithubInstallCallback(db, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const githubConnectMatch = path.match(/\/projects\/([^/]+)\/github\/connect\/?$/);
  const githubConnectProjectId = githubConnectMatch?.[1];
  if (method === 'POST' && githubConnectProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleGithubConnect(db, githubConnectProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const githubPushMatch = path.match(/\/projects\/([^/]+)\/github\/push\/?$/);
  const githubPushProjectId = githubPushMatch?.[1];
  if (method === 'POST' && githubPushProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleGithubPush(db, githubPushProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const githubPullMatch = path.match(/\/projects\/([^/]+)\/github\/pull\/?$/);
  const githubPullProjectId = githubPullMatch?.[1];
  if (method === 'POST' && githubPullProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleGithubPull(db, githubPullProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  const githubStatusMatch = path.match(/\/projects\/([^/]+)\/github\/?$/);
  const githubStatusProjectId = githubStatusMatch?.[1];
  if (method === 'GET' && githubStatusProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleGithubStatus(db, githubStatusProjectId, authResult);
    } finally {
      await db.close();
    }
  }

  if (method === 'GET' && (path === '/me/usage' || path.endsWith('/me/usage'))) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const usage = await getUsageSummary(db, authResult.ownerId);
      return jsonResponse(200, usage);
    } finally {
      await db.close();
    }
  }

  const proxySqlMatch = path.match(/\/proxy\/([^/]+)\/sql\/?$/);
  const proxySqlProjectId = proxySqlMatch?.[1];
  if (method === 'POST' && proxySqlProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleProxySql(db, proxySqlProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const proxyHttpMatch = path.match(/\/proxy\/([^/]+)\/http\/?$/);
  const proxyHttpProjectId = proxyHttpMatch?.[1];
  if (method === 'POST' && proxyHttpProjectId) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      return await handleProxyHttp(db, proxyHttpProjectId, rawBody, authResult);
    } finally {
      await db.close();
    }
  }

  const sessionMatch = path.match(/\/sessions\/([^/]+)\/?$/);
  const sessionId = pathParameters.sessionId ?? sessionMatch?.[1];
  if (
    method === 'GET' &&
    sessionId &&
    !path.includes('/prompt') &&
    !path.includes('/tool-result') &&
    !path.includes('/activity') &&
    !path.includes('/plan-decision')
  ) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const db = createDbClient();
    try {
      const session = await getSession(db, sessionId);
      if (!session) {
        return jsonResponse(404, { error: 'session not found' });
      }
      const project = await assertProjectOwner(db, session.project_id, authResult);
      if (!project) {
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
              files:
                session.pending_tool.awaiting.tool === 'plan_approval'
                  ? (session.pending_tool.awaiting.args.files as Array<{
                      path: string;
                      reason: string;
                    }>)
                  : undefined,
            }
          : null,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: textFromContent(m.content),
          raw: m.content,
          attachments: Array.isArray(m.attachments) ? m.attachments : null,
          citations: Array.isArray(m.citations) ? m.citations : null,
        })),
      });
    } finally {
      await db.close();
    }
  }

  return jsonResponse(404, { error: 'not found', path, method });
}
