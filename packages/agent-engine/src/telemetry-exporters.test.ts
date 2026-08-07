import { describe, expect, it, vi } from 'vitest';
import {
  attachEnvExporters,
  createTelemetryForwarder,
  toOtlpLogBody,
} from './telemetry-exporters.js';
import { TelemetrySink } from './telemetry.js';

describe('telemetry exporters (Pre-P6)', () => {
  it('builds an OTLP log body with service.name', () => {
    const body = toOtlpLogBody(
      { name: 'gen_ai.tool.call', ts: 1_700_000_000_000, attrs: { 'gen_ai.tool.name': 'read' } },
      'walkcroach-agent-engine',
    );
    expect(JSON.stringify(body)).toContain('service.name');
    expect(JSON.stringify(body)).toContain('gen_ai.tool.call');
  });

  it('returns undefined when no exporter env is set', () => {
    expect(createTelemetryForwarder({})).toBeUndefined();
  });

  it('posts to OTLP when endpoint is set', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const forwarder = createTelemetryForwarder(
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(forwarder).toBeTypeOf('function');
    forwarder!({ name: 'walkcroach.approval', ts: Date.now(), attrs: { outcome: 'resolved' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchImpl).toHaveBeenCalled();
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/v1/logs');
  });

  it('attachEnvExporters chains with existing onEvent', () => {
    const sink = new TelemetrySink();
    const seen: string[] = [];
    sink.onEvent = (e) => seen.push(e.name);
    const attached = attachEnvExporters(sink, {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
    });
    expect(attached).toBe(true);
    sink.emit('walkcroach.test', {});
    expect(seen).toContain('walkcroach.test');
  });
});
