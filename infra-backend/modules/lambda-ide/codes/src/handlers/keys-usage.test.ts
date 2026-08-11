import { describe, expect, it } from 'vitest';
import {
  aggregateApiKeyUsage,
  SDK_KEY_USAGE_ACTIONS,
} from './keys-usage.js';

describe('aggregateApiKeyUsage', () => {
  it('builds per-key counters, byAction, and SKU A invoice metadata', () => {
    const payload = aggregateApiKeyUsage([
      {
        key_id: 'k1',
        action_type: 'memory_remember',
        count: '3',
        credits: '3',
      },
      {
        key_id: 'k1',
        action_type: 'memory_list',
        count: '2',
        credits: '2',
      },
      {
        key_id: 'k1',
        action_type: 'graph_run',
        count: '1',
        credits: '3',
      },
      {
        key_id: 'k2',
        action_type: 'content_publish',
        count: '1',
        credits: '5',
      },
      {
        key_id: 'k2',
        action_type: 'memory_export',
        count: '4',
        credits: '8',
      },
    ]);

    expect(payload.period).toBe('month');
    expect(payload.sku).toBe('shared_pool');
    expect(payload.invoice.model).toBe('shared_pool');
    expect(payload.invoice.summary).toMatch(/shared|pool|BYOK/i);

    const k1 = payload.keys.find((k) => k.keyId === 'k1')!;
    expect(k1.remember).toBe(3);
    expect(k1.list).toBe(2);
    expect(k1.graphRun).toBe(1);
    expect(k1.credits).toBe(8);
    expect(k1.byAction).toEqual([
      { action: 'memory_remember', count: 3, credits: 3 },
      { action: 'memory_list', count: 2, credits: 2 },
      { action: 'graph_run', count: 1, credits: 3 },
    ]);

    const k2 = payload.keys.find((k) => k.keyId === 'k2')!;
    expect(k2.contentPublish).toBe(1);
    expect(k2.export).toBe(4);
    expect(k2.credits).toBe(13);

    expect(payload.byAction).toEqual([
      { action: 'memory_remember', count: 3, credits: 3 },
      { action: 'memory_list', count: 2, credits: 2 },
      { action: 'memory_export', count: 4, credits: 8 },
      { action: 'content_publish', count: 1, credits: 5 },
      { action: 'graph_run', count: 1, credits: 3 },
    ]);
  });

  it('covers every SDK_KEY_USAGE_ACTIONS entry in the allowlist constant', () => {
    expect(SDK_KEY_USAGE_ACTIONS).toContain('memory_diff');
    expect(SDK_KEY_USAGE_ACTIONS).toContain('memory_erase');
    expect(SDK_KEY_USAGE_ACTIONS).toContain('memory_audit');
    expect(SDK_KEY_USAGE_ACTIONS).toHaveLength(10);
  });

  it('returns empty keys when there are no ledger rows', () => {
    const payload = aggregateApiKeyUsage([]);
    expect(payload.keys).toEqual([]);
    expect(payload.byAction).toEqual([]);
    expect(payload.sku).toBe('shared_pool');
  });
});
