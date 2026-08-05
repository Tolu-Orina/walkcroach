/**
 * The worker: executes one submitted run to completion.
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
  publishContent,
  recallProjectMemory,
  writeMemoryEntry,
  type PublishSource,
} from '@walkcroach/agent-harness';
import { createDbClient, type DbClient } from '@walkcroach/db';
import type { WriteScope } from '@walkcroach/sdk-host';
import { createAgentRunner } from './agent-runner.js';
import { metricLog } from './util.js';

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
      repo: string;
      targetDir?: string;
      source: PublishSource;
      instructions?: string;
      writeScope: WriteScope;
      installationId: number;
      dryRun?: boolean;
    };

    const result = await publishContent({
      db,
      projectId: run.projectId,
      installationId: req.installationId,
      repo: req.repo,
      targetDir: req.targetDir,
      source: req.source,
      instructions: req.instructions,
      dryRun: req.dryRun,
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
