import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  memoryMetric,
  observeRecall,
  MEMORY_METRIC_NAMESPACE,
} from './memory-metrics.js';

let spy: ReturnType<typeof vi.spyOn>;

function emitted(index = 0) {
  return JSON.parse(String(spy.mock.calls[index]?.[0]));
}

function emittedNamed(name: string) {
  for (const call of spy.mock.calls) {
    const payload = JSON.parse(String(call[0]));
    if (payload._aws.CloudWatchMetrics[0].Metrics[0].Name === name) return payload;
  }
  return undefined;
}

beforeEach(() => {
  process.env.ENVIRONMENT = 'test';
  spy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  spy.mockRestore();
});

describe('memoryMetric', () => {
  it('emits EMF in the WalkCroach/Memory namespace', () => {
    memoryMetric('MemoryWrite', 1, { surface: 'ide', operation: 'write' });
    const payload = emitted();
    expect(payload._aws.CloudWatchMetrics[0].Namespace).toBe(MEMORY_METRIC_NAMESPACE);
    expect(payload.MemoryWrite).toBe(1);
    expect(payload.Environment).toBe('test');
  });

  it('marks latency metrics as Milliseconds, not Count', () => {
    memoryMetric('RecallLatencyMs', 42, { surface: 'web' });
    expect(emitted()._aws.CloudWatchMetrics[0].Metrics[0].Unit).toBe('Milliseconds');
  });

  it('promotes only surface and operation to dimensions', () => {
    memoryMetric('RecallHits', 3, {
      surface: 'chrome',
      operation: 'recall',
      projectId: 'p-1',
    });
    const payload = emitted();
    expect(payload._aws.CloudWatchMetrics[0].Dimensions[0]).toEqual([
      'Environment',
      'Surface',
      'Operation',
    ]);
    // Identifiers stay queryable in Logs Insights without exploding cardinality.
    expect(payload.projectId).toBe('p-1');
  });

  it('records a zero value rather than defaulting it to 1', () => {
    memoryMetric('RecallHits', 0, { surface: 'web' });
    expect(emitted().RecallHits).toBe(0);
  });
});

describe('observeRecall', () => {
  it('emits latency and hit count, and passes the hits through untouched', async () => {
    const hits = [{ id: 'a', distance: 0.125 }];
    const out = await observeRecall({ surface: 'web', projectId: 'p-1' }, async () => hits);

    expect(out).toBe(hits);
    expect(emittedNamed('RecallLatencyMs')).toBeDefined();
    expect(emittedNamed('RecallHits')?.RecallHits).toBe(1);
  });

  it('records the top distance in milli-units for CloudWatch', async () => {
    await observeRecall({ surface: 'web' }, async () => [{ distance: 0.125 }]);
    expect(emittedNamed('RecallTopDistanceMilli')?.RecallTopDistanceMilli).toBe(125);
  });

  it('flags an empty recall separately so it can be alarmed on', async () => {
    await observeRecall({ surface: 'ide', projectId: 'p-2' }, async () => []);
    expect(emittedNamed('RecallEmpty')?.RecallEmpty).toBe(1);
    expect(emittedNamed('RecallTopDistanceMilli')).toBeUndefined();
  });

  it('emits EmbedFailure and rethrows when recall throws', async () => {
    await expect(
      observeRecall({ surface: 'web' }, async () => {
        throw new Error('Titan unavailable');
      }),
    ).rejects.toThrow('Titan unavailable');
    expect(emittedNamed('EmbedFailure')?.error).toContain('Titan unavailable');
  });

  it('never lets a metrics failure break recall', async () => {
    spy.mockImplementation(() => {
      throw new Error('stdout closed');
    });
    await expect(
      observeRecall({ surface: 'web' }, async () => [{ distance: 0.1 }]),
    ).resolves.toHaveLength(1);
  });
});
