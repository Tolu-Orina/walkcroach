import { describe, expect, it, vi } from 'vitest';
import { creativeMetric, CREATIVE_METRIC_NAMESPACE } from './metrics.js';

describe('Phase H4 — creative EMF metrics', () => {
  it('emits CloudWatch Embedded Metric Format for ImageGenCount', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.ENVIRONMENT = 'dev';
    creativeMetric('ImageGenCount', { feature: 'canvas', tier: 'paid' });
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload._aws.CloudWatchMetrics[0].Namespace).toBe(
      CREATIVE_METRIC_NAMESPACE,
    );
    expect(payload._aws.CloudWatchMetrics[0].Metrics[0].Name).toBe(
      'ImageGenCount',
    );
    expect(payload.Environment).toBe('dev');
    expect(payload.ImageGenCount).toBe(1);
    spy.mockRestore();
  });
});
