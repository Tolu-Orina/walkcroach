export type TelemetryName =
  | 'mcp_call'
  | 'mcp_write_consent'
  | 'ccloud_action'
  | 'skill_invoked'
  | 'skill_loaded'
  | 'memory_recall'
  | 'memory_mirror';

export type TelemetryCounters = Record<TelemetryName, number>;

export function emptyTelemetry(): TelemetryCounters {
  return {
    mcp_call: 0,
    mcp_write_consent: 0,
    ccloud_action: 0,
    skill_invoked: 0,
    skill_loaded: 0,
    memory_recall: 0,
    memory_mirror: 0,
  };
}

export class TelemetrySink {
  readonly counters = emptyTelemetry();

  bump(name: TelemetryName, n = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + n;
  }
}
