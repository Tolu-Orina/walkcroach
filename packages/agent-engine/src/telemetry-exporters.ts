/**
 * Optional telemetry exporters (Pre–Phase 6).
 *
 * Zero hard dependencies — hosts wire `TelemetrySink.onEvent` when env is set.
 * Does not rebuild LangSmith; only best-effort OTLP JSON / LangSmith / Langfuse
 * HTTP sinks behind feature flags.
 */

import type { StructuredTelemetryEvent } from './telemetry.js';

export type TelemetryForwarder = (event: StructuredTelemetryEvent) => void;

export type ExporterEnv = {
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  WALKCROACH_OTEL_SERVICE_NAME?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_ENDPOINT?: string;
  LANGSMITH_PROJECT?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_BASE_URL?: string;
};

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

/** Map a WalkCroach structured event → OTLP-ish log/span attributes. */
export function toOtlpLogBody(
  event: StructuredTelemetryEvent,
  serviceName: string,
): Record<string, unknown> {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
          ],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: String(event.ts * 1_000_000),
                body: { stringValue: event.name },
                attributes: Object.entries(event.attrs)
                  .filter(([, v]) => v !== undefined)
                  .map(([key, value]) => ({
                    key,
                    value:
                      typeof value === 'number'
                        ? { doubleValue: value }
                        : typeof value === 'boolean'
                          ? { boolValue: value }
                          : { stringValue: String(value) },
                  })),
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Build a composite forwarder from env. Returns undefined when nothing is configured.
 * Failures are swallowed — telemetry must never break the agent loop.
 */
export function createTelemetryForwarder(
  env: ExporterEnv = process.env as ExporterEnv,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): TelemetryForwarder | undefined {
  const sinks: TelemetryForwarder[] = [];
  const serviceName = env.WALKCROACH_OTEL_SERVICE_NAME?.trim() || 'walkcroach-agent-engine';

  const otlp = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (otlp) {
    const base = otlp.replace(/\/$/, '');
    const url = base.endsWith('/v1/logs') ? base : `${base}/v1/logs`;
    const headers = {
      'content-type': 'application/json',
      ...parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    };
    sinks.push((event) => {
      void fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(toOtlpLogBody(event, serviceName)),
      }).catch(() => {});
    });
  }

  const lsKey = env.LANGSMITH_API_KEY?.trim();
  if (lsKey) {
    const endpoint = (env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com').replace(
      /\/$/,
      '',
    );
    const project = env.LANGSMITH_PROJECT?.trim() || 'walkcroach';
    sinks.push((event) => {
      void fetchImpl(`${endpoint}/runs/multipart`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': lsKey,
        },
        body: JSON.stringify({
          name: event.name,
          run_type: 'tool',
          start_time: new Date(event.ts).toISOString(),
          end_time: new Date(event.ts).toISOString(),
          extra: { metadata: { ...event.attrs, project } },
        }),
      }).catch(() => {});
    });
  }

  const lfPub = env.LANGFUSE_PUBLIC_KEY?.trim();
  const lfSec = env.LANGFUSE_SECRET_KEY?.trim();
  if (lfPub && lfSec) {
    const base = (env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
    const auth = Buffer.from(`${lfPub}:${lfSec}`).toString('base64');
    sinks.push((event) => {
      void fetchImpl(`${base}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          batch: [
            {
              id: `${event.ts}-${event.name}`,
              type: 'event-create',
              timestamp: new Date(event.ts).toISOString(),
              body: {
                name: event.name,
                metadata: event.attrs,
              },
            },
          ],
        }),
      }).catch(() => {});
    });
  }

  if (sinks.length === 0) return undefined;
  return (event) => {
    for (const sink of sinks) sink(event);
  };
}

/** Attach env-based forwarders to a sink when configured. */
export function attachEnvExporters(
  sink: { onEvent?: TelemetryForwarder },
  env?: ExporterEnv,
): boolean {
  const forwarder = createTelemetryForwarder(env);
  if (!forwarder) return false;
  const prev = sink.onEvent;
  sink.onEvent = (event) => {
    prev?.(event);
    forwarder(event);
  };
  return true;
}
