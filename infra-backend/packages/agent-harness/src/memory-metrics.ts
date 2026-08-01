/**
 * Memory-layer observability — namespace WalkCroach/Memory.
 *
 * WalkCroach's whole thesis is that CockroachDB is the agent's memory, yet until
 * now the only instrumented subsystem was Creative. That meant the questions you
 * actually need answered in production about a memory layer — is recall getting
 * slower, is it returning anything, are embeddings failing silently — had no
 * signal at all.
 *
 * Emitted as CloudWatch Embedded Metric Format on stdout (same transport as
 * `creativeMetric`), so no PutMetricData IAM is needed on the recall hot path.
 *
 * Cardinality note: `surface` and `operation` are dimensions (bounded sets —
 * web/chrome/ide/cli, recall/write/supersede). Identifiers such as projectId are
 * deliberately NOT dimensions; they ride along as log fields so a single project
 * can still be traced in Logs Insights without exploding metric cardinality.
 */

import { emitEmf } from './metrics.js';

export const MEMORY_METRIC_NAMESPACE = 'WalkCroach/Memory';

export type MemoryMetricName =
  /** Wall-clock for a full recall: embed + vector search. */
  | 'RecallLatencyMs'
  /** Rows returned. A zero here is the signal that memory is silently empty. */
  | 'RecallHits'
  /** Cosine distance of the best hit ×1000 (EMF has no float-precision issues at Count). */
  | 'RecallTopDistanceMilli'
  /** Recall that matched nothing — tracked separately so it can be alarmed on. */
  | 'RecallEmpty'
  | 'MemoryWrite'
  /** An older entry was retired because a new one contradicted it. */
  | 'MemorySuperseded'
  | 'EmbedLatencyMs'
  | 'EmbedFailure';

const UNITS: Record<MemoryMetricName, 'Count' | 'Milliseconds'> = {
  RecallLatencyMs: 'Milliseconds',
  RecallHits: 'Count',
  RecallTopDistanceMilli: 'Count',
  RecallEmpty: 'Count',
  MemoryWrite: 'Count',
  MemorySuperseded: 'Count',
  EmbedLatencyMs: 'Milliseconds',
  EmbedFailure: 'Count',
};

export type MemoryMetricFields = {
  /** 'web' | 'chrome' | 'ide' | 'cli' — dimension. */
  surface?: string;
  /** 'recall' | 'write' | 'supersede' | 'embed' — dimension. */
  operation?: string;
  /** Non-dimension context (projectId, ownerId, kind, error) for Logs Insights. */
  [key: string]: string | number | boolean | undefined;
};

export function memoryMetric(
  name: MemoryMetricName,
  value?: number,
  fields: MemoryMetricFields = {},
): void {
  emitEmf({
    namespace: MEMORY_METRIC_NAMESPACE,
    name,
    unit: UNITS[name],
    value,
    dimensionFields: ['surface', 'operation'],
    fields,
  });
}

/**
 * Times `fn`, emits latency plus hit-count/top-distance, and never lets a
 * metrics problem break recall — instrumentation must not be able to take down
 * the thing it observes.
 */
export async function observeRecall<T>(
  params: { surface?: string; projectId?: string; ownerId?: string; kind?: string },
  fn: () => Promise<T[]>,
): Promise<T[]> {
  const started = Date.now();
  try {
    const hits = await fn();
    try {
      const context = {
        surface: params.surface,
        operation: 'recall',
        projectId: params.projectId,
        ownerId: params.ownerId,
        kind: params.kind,
      };
      memoryMetric('RecallLatencyMs', Date.now() - started, context);
      memoryMetric('RecallHits', hits.length, context);
      if (hits.length === 0) {
        memoryMetric('RecallEmpty', 1, context);
      } else {
        const top = (hits[0] as { distance?: unknown })?.distance;
        if (typeof top === 'number' && Number.isFinite(top)) {
          memoryMetric('RecallTopDistanceMilli', Math.round(top * 1000), context);
        }
      }
    } catch {
      // Never fail a recall because a metric could not be emitted.
    }
    return hits;
  } catch (err) {
    try {
      memoryMetric('EmbedFailure', 1, {
        surface: params.surface,
        operation: 'recall',
        projectId: params.projectId,
        error: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
      });
    } catch {
      // ignore
    }
    throw err;
  }
}
