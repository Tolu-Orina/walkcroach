import { createDbClient } from '@walkcroach/db';
import {
  countProjectsForOwner,
  getLatestSessionForProject,
  getSession,
  listBuildEvents,
  listMessages,
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
};

async function assertProjectOwner(
  db: ReturnType<typeof createDbClient>,
  projectId: string,
  auth: AuthContext,
): Promise<ProjectRow | null> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT id, owner_id, name, status, updated_at, created_at, template_id, memory_summary
     FROM projects
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [projectId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.owner_id !== auth.ownerId) return null;
  return row;
}

function mapProjectSummary(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status ?? 'draft',
    updatedAt: row.updated_at.toISOString(),
    memorySummary: row.memory_summary,
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
): Promise<RestResult> {
  if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
    return jsonResponse(200, { ok: true, service: 'walkcroach-backend' });
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
        `SELECT id, owner_id, name, status, updated_at, created_at, template_id, memory_summary
         FROM projects
         WHERE owner_id = $1 AND deleted_at IS NULL AND archived_at IS NULL
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
      const row = await assertProjectOwner(db, projectIdParam, authResult);
      if (!row) {
        return jsonResponse(404, { error: 'project not found' });
      }
      return jsonResponse(200, {
        ...mapProjectSummary(row),
        ownerId: row.owner_id,
        createdAt: row.created_at.toISOString(),
        templateId: row.template_id,
      });
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
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO projects (owner_id, name, template_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [authResult.ownerId, body.name ?? 'Untitled', templateId],
      );
      return jsonResponse(201, { id: rows[0]!.id, templateId });
    } finally {
      await db.close();
    }
  }

  if (method === 'POST' && (path === '/sessions' || path.endsWith('/sessions'))) {
    const authResult = await requireAuth(headers);
    if ('error' in authResult) {
      return jsonResponse(authResult.status, { error: authResult.error });
    }
    const body = JSON.parse(rawBody ?? '{}') as { projectId?: string };
    if (!body.projectId) {
      return jsonResponse(400, { error: 'projectId required' });
    }
    const db = createDbClient();
    try {
      const project = await assertProjectOwner(db, body.projectId, authResult);
      if (!project) {
        return jsonResponse(404, { error: 'project not found' });
      }
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO sessions (project_id)
         VALUES ($1::uuid)
         RETURNING id`,
        [body.projectId],
      );
      await db.query(
        `UPDATE projects SET updated_at = now() WHERE id = $1::uuid`,
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
        })),
      });
    } finally {
      await db.close();
    }
  }

  return jsonResponse(404, { error: 'not found', path, method });
}
