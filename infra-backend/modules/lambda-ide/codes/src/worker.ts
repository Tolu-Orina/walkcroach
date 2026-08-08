/**
 * The worker: executes one submitted run to completion (or interrupt).
 *
 * Takes only a run id and reads everything else from the database, so it
 * behaves identically whether it was invoked across the network or called
 * in-process by the inline dispatcher.
 */
import {
  appendRunEvent,
  claimRun,
  completeRun,
  heartbeatRun,
  interruptRun,
  publishContent,
  recallProjectMemory,
  runPublicGraph,
  writeMemoryEntry,
  type PublishSource,
  type PublicGraphDefinition,
} from '@walkcroach/agent-harness';
import { createDbClient, type DbClient } from '@walkcroach/db';
import type { WriteScope } from '@walkcroach/sdk-host';
import { createAgentRunner } from './agent-runner.js';
import { metricLog } from './util.js';
import { randomUUID } from 'node:crypto';

/**
 * Heartbeat interval.
 *
 * Comfortably inside the 90-second lease so a single slow Bedrock call cannot
 * cost the worker its claim, while still surrendering a dead worker's run
 * quickly enough that the caller is not left polling.
 */
const HEARTBEAT_MS = 25_000;

export async function runWorker(runId: string): Promise<void> {
  const db = createDbClient();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  try {
    const run = await claimRun(db, runId);
    if (!run) {
      // Already claimed, already finished, or cancelled. At-least-once delivery
      // makes this normal, not an error.
      metricLog('sdk.run.claim_skipped', { runId });
      return;
    }

    heartbeat = setInterval(() => {
      void heartbeatRun(db, runId).catch(() => {});
    }, HEARTBEAT_MS);

    await appendRunEvent({ db, runId, type: 'started', payload: { kind: run.kind } });

    if (run.kind === 'graph.run') {
      await executeGraphRun(db, runId, run.projectId, run.request);
      return;
    }

    if (run.kind !== 'content.publish') {
      await completeRun({
        db,
        runId,
        status: 'failed',
        error: `unknown run kind "${run.kind}"`,
      });
      return;
    }

    const req = run.request as {
      repo?: string;
      targetDir?: string;
      source: PublishSource;
      instructions?: string;
      writeScope: WriteScope;
      installationId?: number;
      dryRun?: boolean;
      noTarget?: boolean;
      resume?: { interruptId: string; value: unknown; resumedAt?: string };
    };

    const answers = resumeAnswers(req.resume);

    const result = await publishContent({
      db,
      projectId: run.projectId,
      installationId: req.installationId,
      repo: req.repo,
      targetDir: req.targetDir,
      source: req.source,
      instructions: req.instructions,
      dryRun: req.dryRun,
      noTarget: req.noTarget,
      answers,
      runId,
      onStageEvent: (type, payload) => {
        void appendRunEvent({
          db,
          runId,
          type,
          payload,
        }).catch(() => {});
      },
      runAgent: createAgentRunner({
        writeScope: req.writeScope,
        memory: memoryBridge(db, run.projectId),
        // Progress is written as it happens, so a poller sees the run move
        // rather than a spinner followed by a result.
        onEvent: (event) => {
          void appendRunEvent({
            db,
            runId,
            type: event.type,
            payload: event as unknown as Record<string, unknown>,
          }).catch(() => {});
        },
      }),
    });

    if (result.inputRequired || result.reason === 'input_required') {
      const interrupt = {
        id: randomUUID(),
        kind: 'ask_user',
        payload: {
          question: result.inputRequired?.question ?? result.error ?? 'input required',
          options: result.inputRequired?.options ?? [],
        },
        createdAt: new Date().toISOString(),
      };
      await appendRunEvent({
        db,
        runId,
        type: 'interrupt',
        payload: { interrupt },
      });
      await interruptRun({
        db,
        runId,
        interrupt,
        result: {
          ok: false,
          filesWritten: result.filesWritten,
          signals: result.signals,
          flags: result.flags,
          refusals: result.refusals,
          learned: result.learned,
          reason: 'interrupted',
          ...(result.error ? { error: result.error } : {}),
        },
      });
      metricLog('sdk.run.interrupted', { kind: interrupt.kind });
      return;
    }

    await appendRunEvent({
      db,
      runId,
      type: 'finished',
      payload: { ok: result.ok, files: result.filesWritten.length },
    });

    await completeRun({
      db,
      runId,
      status: result.ok ? 'succeeded' : 'failed',
      result: result as unknown as Record<string, unknown>,
      error: result.error ?? null,
    });

    metricLog('sdk.run.completed', { ok: result.ok, files: result.filesWritten.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendRunEvent({ db, runId, type: 'error', payload: { message } }).catch(() => {});
    // May return false if the lease already lapsed and the reaper got there
    // first. That is the correct outcome — the reaper's verdict stands.
    await completeRun({ db, runId, status: 'failed', error: message }).catch(() => {});
    metricLog('sdk.run.failed', { error: message.slice(0, 200) });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await db.close();
  }
}

async function executeGraphRun(
  db: DbClient,
  runId: string,
  projectId: string,
  request: Record<string, unknown>,
): Promise<void> {
  const graph = request.graph as PublicGraphDefinition;
  const input = (request.input as Record<string, unknown> | undefined) ?? {};
  const writeScope = request.writeScope as WriteScope | undefined;

  const needsAgent =
    Array.isArray(graph?.nodes) &&
    graph.nodes.some((n) =>
      ['plan', 'draft', 'implement', 'revise'].includes(String(n.type)),
    );

  const result = await runPublicGraph({
    db,
    projectId,
    runId,
    graph,
    input,
    durable: true,
    runAgent: needsAgent
      ? createAgentRunner({
          writeScope: writeScope ?? { mode: 'additive' },
          memory: memoryBridge(db, projectId),
          onEvent: (event) => {
            void appendRunEvent({
              db,
              runId,
              type: event.type,
              payload: event as unknown as Record<string, unknown>,
            }).catch(() => {});
          },
        })
      : undefined,
    onEvent: (type, payload) => {
      void appendRunEvent({ db, runId, type, payload }).catch(() => {});
    },
  });

  const publicResult = {
    ok: result.ok,
    contractVersion: result.contractVersion,
    graphId: result.graphId,
    nodeExecutionCount: result.nodeExecutionCount,
    reviseCount: result.reviseCount,
    visitCounts: result.visitCounts,
    reason: result.reason,
    ...(result.error ? { error: result.error } : {}),
    rememberedId: result.state.rememberedId,
    criticFindings: result.state.criticFindings,
    hits: result.state.hits,
    pipelineOk: result.state.pipelineOk,
  };

  await appendRunEvent({
    db,
    runId,
    type: 'finished',
    payload: {
      ok: result.ok,
      nodeExecutionCount: result.nodeExecutionCount,
      visitCounts: result.visitCounts,
    },
  });

  await completeRun({
    db,
    runId,
    status: result.ok ? 'succeeded' : 'failed',
    result: publicResult as unknown as Record<string, unknown>,
    error: result.error ?? null,
  });

  metricLog('sdk.graphs.completed', {
    ok: result.ok,
    graphId: result.graphId,
    nodeExecutionCount: result.nodeExecutionCount,
    reviseCount: result.reviseCount,
    visitCountKeys: Object.keys(result.visitCounts).length,
  });
}

/**
 * Map a resume value onto ask_user answers.
 * String → answer for the pending question; object with `answer` / question keys preferred.
 */
function resumeAnswers(
  resume: { value: unknown } | undefined,
): Record<string, string> | undefined {
  if (!resume) return undefined;
  const value = resume.value;
  if (typeof value === 'string') {
    return { '*': value };
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, string> = {};
    if (typeof obj.answer === 'string') out['*'] = obj.answer;
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'answer') continue;
      if (typeof v === 'string') out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

function memoryBridge(db: DbClient, projectId: string) {
  return {
    projectId,
    recall: async (p: { query: string; limit?: number; sourceSurfaces?: string[] }) => {
      const hits = await recallProjectMemory({ db, projectId, ...p });
      return hits.map((h) => ({
        id: h.id,
        kind: h.kind,
        text: h.text,
        distance: h.distance ?? 0,
        sourceSurface: h.sourceSurface ?? 'unknown',
      }));
    },
    mirror: async (p: { text: string; kind?: string }) => ({
      id: await writeMemoryEntry({
        db,
        projectId,
        sourceSurface: 'sdk',
        kind: (p.kind ?? 'decision') as never,
        text: p.text,
      }),
    }),
  };
}

/** True when a Lambda event is a worker envelope rather than an HTTP request. */
export function isWorkerEvent(event: unknown): event is { walkcroachWorker: { runId: string } } {
  return (
    !!event &&
    typeof event === 'object' &&
    typeof (event as { walkcroachWorker?: { runId?: unknown } }).walkcroachWorker?.runId ===
      'string'
  );
}
