/**
 * Creative observability (Phase H4 / plan §9.3).
 *
 * Emits Embedded Metric Format (EMF) JSON to stdout so CloudWatch Logs can
 * materialize custom metrics without PutMetricData IAM on every path.
 * Namespace: WalkCroach/Creative
 */

export const CREATIVE_METRIC_NAMESPACE = 'WalkCroach/Creative';

export type CreativeMetricName =
  | 'ImageGenCount'
  | 'VideoJobSuccess'
  | 'VideoJobFail'
  | 'CreativeQuotaDenied'
  | 'ProInvokeCount';

export function creativeMetric(
  name: CreativeMetricName,
  fields: Record<string, string | number | boolean | undefined> = {},
): void {
  const env =
    process.env.ENVIRONMENT ??
    process.env.WALKCROACH_ENV ??
    process.env.NODE_ENV ??
    'dev';
  const dims: Record<string, string> = { Environment: String(env) };
  if (typeof fields.feature === 'string') dims.Feature = fields.feature;
  if (typeof fields.tier === 'string') dims.Tier = fields.tier;

  const dimensionKeys = Object.keys(dims);
  const safe: Record<string, string | number | boolean> = { ...dims };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && k !== 'feature' && k !== 'tier') safe[k] = v;
  }
  safe[name] = typeof fields.value === 'number' ? fields.value : 1;

  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: CREATIVE_METRIC_NAMESPACE,
            Dimensions: [dimensionKeys],
            Metrics: [{ Name: name, Unit: 'Count' }],
          },
        ],
      },
      ...safe,
    }),
  );
}
