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

/** EMF units used across WalkCroach namespaces. */
export type MetricUnit = 'Count' | 'Milliseconds' | 'None';

export function resolveEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return String(
    env.ENVIRONMENT ?? env.WALKCROACH_ENV ?? env.NODE_ENV ?? 'dev',
  );
}

/**
 * Low-level EMF writer shared by every WalkCroach metric namespace.
 *
 * `dimensionFields` names the entries of `fields` that become CloudWatch
 * dimensions; everything else rides along as a searchable log property but does
 * not multiply the metric's cardinality. Environment is always a dimension.
 */
export function emitEmf(params: {
  namespace: string;
  name: string;
  unit?: MetricUnit;
  value?: number;
  dimensionFields?: readonly string[];
  fields?: Record<string, string | number | boolean | undefined>;
}): void {
  const fields = params.fields ?? {};
  const dims: Record<string, string> = { Environment: resolveEnvironment() };
  for (const key of params.dimensionFields ?? []) {
    const v = fields[key];
    if (typeof v === 'string') dims[key.charAt(0).toUpperCase() + key.slice(1)] = v;
  }

  const dimensionKeys = Object.keys(dims);
  const payload: Record<string, string | number | boolean> = { ...dims };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && !(params.dimensionFields ?? []).includes(k)) {
      payload[k] = v;
    }
  }
  payload[params.name] =
    typeof params.value === 'number'
      ? params.value
      : typeof fields.value === 'number'
        ? fields.value
        : 1;

  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: params.namespace,
            Dimensions: [dimensionKeys],
            Metrics: [{ Name: params.name, Unit: params.unit ?? 'Count' }],
          },
        ],
      },
      ...payload,
    }),
  );
}

export function creativeMetric(
  name: CreativeMetricName,
  fields: Record<string, string | number | boolean | undefined> = {},
): void {
  emitEmf({
    namespace: CREATIVE_METRIC_NAMESPACE,
    name,
    unit: 'Count',
    dimensionFields: ['feature', 'tier'],
    fields,
  });
}
