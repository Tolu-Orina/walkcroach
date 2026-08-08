/**
 * Phase 6b — public Run Graph DSL HTTP handlers (ADR-I).
 *
 * Catalog-only composition. BYO tools / HostAdapter payloads fail at validate.
 */
import {
  graphNeedsAgentRunner,
  listCatalogNodes,
  listPresets,
  submitRun,
  validatePublicGraph,
  GRAPH_RUN_CONTRACT_VERSION,
  PUBLIC_EDGE_PREDICATES,
  PUBLIC_MAX_EDGES,
  PUBLIC_MAX_NODE_EXECUTIONS_CAP,
  PUBLIC_MAX_NODES,
  type PublicGraphDefinition,
} from '@walkcroach/agent-harness';
import { createDbClient } from '@walkcroach/db';
import { debitCredits } from '@walkcroach/ledger';
import type { WriteScope } from '@walkcroach/sdk-host';
import type { AuthContext } from '../auth.js';
import { resolveDispatcher } from '../dispatch.js';
import { creditHeaders, jsonResponse } from '../http.js';
import { isUuid, metricLog, parseJsonBody } from '../util.js';
import { runWorker } from '../worker.js';
import { handleContentPublish } from './content.js';
import { requireScope } from './sdk-memory.js';
import { assertOwnsProject } from './me.js';
import { ensureSdkDefaultProject } from './sdk-projects.js';

const dispatchRun = resolveDispatcher(runWorker);

const PLATFORM_PRESETS = new Set(['content.publish']);

function parseWriteScope(raw: unknown): WriteScope | { error: string } {
  if (!raw || typeof raw !== 'object') {
    return {
      error:
        'writeScope is required when the graph includes plan/draft/revise nodes. Use {"mode":"additive"}.',
    };
  }
  const scope = raw as { mode?: string; allow?: unknown };
  if (scope.mode === 'additive' || scope.mode === 'full') return { mode: scope.mode };
  if (scope.mode === 'scoped') {
    const allow = Array.isArray(scope.allow)
      ? scope.allow.map(String).filter(Boolean)
      : [];
    if (allow.length === 0) {
      return { error: 'writeScope.allow must list at least one path in scoped mode' };
    }
    return { mode: 'scoped', allow };
  }
  return { error: `unknown writeScope.mode "${String(scope.mode)}"` };
}

export async function handleGraphsCatalog(
  auth: AuthContext,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'content:run');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  return jsonResponse(200, {
    contractVersion: GRAPH_RUN_CONTRACT_VERSION,
    nodes: listCatalogNodes(),
    presets: listPresets(),
    predicates: [...PUBLIC_EDGE_PREDICATES],
    caps: {
      maxNodeExecutions: PUBLIC_MAX_NODE_EXECUTIONS_CAP,
      maxNodes: PUBLIC_MAX_NODES,
      maxEdges: PUBLIC_MAX_EDGES,
    },
    note:
      'Platform nodes only. content.publish is a named preset — not a node type. BYO tools are rejected.',
  });
}

export async function handleGraphsValidate(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'content:run');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const parsed = parseJsonBody<{
    graph?: unknown;
    preset?: string;
  }>(rawBody);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });

  const preset = parsed.data.preset?.trim();
  if (preset) {
    if (!PLATFORM_PRESETS.has(preset)) {
      return jsonResponse(400, {
        ok: false,
        errors: [`unknown preset "${preset}"`],
      });
    }
    return jsonResponse(200, {
      ok: true,
      preset,
      contractVersion: GRAPH_RUN_CONTRACT_VERSION,
      note: 'Preset runs via the content.publish pipeline (same as POST /v1/content/publish).',
    });
  }

  const result = validatePublicGraph(parsed.data.graph);
  if (!result.ok) {
    metricLog('sdk.graphs.validate', { ok: false, errors: result.errors.length });
    return jsonResponse(400, {
      ok: false,
      errors: result.errors,
      contractVersion: GRAPH_RUN_CONTRACT_VERSION,
    });
  }

  metricLog('sdk.graphs.validate', { ok: true });
  return jsonResponse(200, {
    ok: true,
    contractVersion: GRAPH_RUN_CONTRACT_VERSION,
    needsAgent: graphNeedsAgentRunner(result.normalized),
    graph: result.normalized,
  });
}

export async function handleGraphsRun(
  auth: AuthContext,
  rawBody: string | undefined,
): Promise<ReturnType<typeof jsonResponse>> {
  const denied = requireScope(auth, 'content:run');
  if (denied) return jsonResponse(denied.status, { error: denied.error });

  const parsed = parseJsonBody<{
    projectId?: string;
    graph?: unknown;
    preset?: string;
    input?: Record<string, unknown>;
    writeScope?: unknown;
    idempotencyKey?: string;
    source?: Record<string, string>;
    target?: { repo?: string; path?: string };
    instructions?: string;
    dryRun?: boolean;
    publish?: {
      source?: Record<string, string>;
      target?: { repo?: string; path?: string };
      instructions?: string;
      dryRun?: boolean;
      writeScope?: unknown;
    };
  }>(rawBody);
  if (!parsed.ok) return jsonResponse(400, { error: parsed.error });
  const body = parsed.data;

  const preset = body.preset?.trim();
  if (preset && !PLATFORM_PRESETS.has(preset)) {
    return jsonResponse(400, { error: `unknown preset "${preset}"` });
  }
  if (!preset && body.graph === undefined) {
    return jsonResponse(400, {
      error: 'Provide graph (catalog definition) or preset (e.g. "content.publish")',
    });
  }
  if (preset && body.graph !== undefined) {
    return jsonResponse(400, {
      error: 'Pass either graph or preset, not both',
    });
  }

  // Named preset → existing content.publish pipeline (same durable run path).
  if (preset === 'content.publish') {
    const pub = body.publish ?? {};
    return handleContentPublish(
      auth,
      JSON.stringify({
        projectId: body.projectId,
        source: pub.source ?? body.source,
        target: pub.target ?? body.target,
        writeScope: pub.writeScope ?? body.writeScope,
        instructions: pub.instructions ?? body.instructions,
        dryRun: pub.dryRun ?? body.dryRun,
        idempotencyKey: body.idempotencyKey,
      }),
    );
  }

  let projectId = body.projectId?.trim() || '';
  if (projectId) {
    if (!isUuid(projectId)) {
      return jsonResponse(400, { error: 'projectId must be a uuid' });
    }
    const owned = await assertOwnsProject(auth.ownerId, projectId);
    if (!owned.ok) return jsonResponse(owned.status, { error: owned.error });
  } else {
    const ensured = await ensureSdkDefaultProject(auth.ownerId);
    projectId = ensured.id;
  }

  const validated = validatePublicGraph(body.graph);
  if (!validated.ok) {
    metricLog('sdk.graphs.run.reject', {
      reason: 'validation',
      errors: validated.errors.length,
    });
    return jsonResponse(400, {
      error: 'graph validation failed',
      errors: validated.errors,
      code: 'GRAPH_VALIDATION_FAILED',
    });
  }
  const graph: PublicGraphDefinition = validated.normalized;
  let writeScope: WriteScope | undefined;
  if (graphNeedsAgentRunner(graph)) {
    const scope = parseWriteScope(body.writeScope);
    if ('error' in scope) return jsonResponse(400, { error: scope.error });
    writeScope = scope;
  }

  const db = createDbClient();
  try {
    const { run, created } = await submitRun({
      db,
      ownerId: auth.ownerId,
      projectId,
      kind: 'graph.run',
      idempotencyKey: body.idempotencyKey,
      request: {
        graph,
        input: body.input ?? {},
        ...(writeScope ? { writeScope } : {}),
      },
    });

    if (created) {
      const charged = await debitCredits(db, auth.ownerId, 'graph_run', projectId, {
        keyId: auth.keyId ?? null,
        source: auth.source,
      });
      if (!charged.ok) {
        await db.query(
          `UPDATE agent_runs
              SET status = 'failed',
                  error = $2,
                  finished_at = now(),
                  lease_expires_at = NULL
            WHERE id = $1::uuid AND owner_id = $3 AND status = 'queued'`,
          [run.id, 'quota exceeded', auth.ownerId],
        );
        return jsonResponse(
          429,
          {
            error: 'quota exceeded',
            code: 'QUOTA_EXCEEDED',
            remaining: charged.remaining,
            action: 'graph_run',
            runId: run.id,
          },
          {
            'retry-after': '3600',
            ...creditHeaders({
              remaining: charged.remaining,
              limit: charged.limit,
              cost: 0,
            }),
          },
        );
      }
      await dispatchRun(run.id);
      metricLog('sdk.graphs.submit', { created, kind: 'graph.run' });
      return jsonResponse(
        202,
        {
          runId: run.id,
          status: run.status,
          createdAt: run.createdAt,
          pollUrl: `/v1/runs/${run.id}`,
          contractVersion: GRAPH_RUN_CONTRACT_VERSION,
        },
        creditHeaders({
          remaining: charged.remaining,
          limit: charged.limit,
          cost: charged.credits,
        }),
      );
    }

    metricLog('sdk.graphs.submit', { created, kind: 'graph.run' });
    return jsonResponse(200, {
      runId: run.id,
      status: run.status,
      createdAt: run.createdAt,
      pollUrl: `/v1/runs/${run.id}`,
      contractVersion: GRAPH_RUN_CONTRACT_VERSION,
    });
  } finally {
    await db.close();
  }
}
