/**
 * Agent harness telemetry (P3.5).
 *
 * Counters remain for backward-compatible `AgentEvent` payloads.
 * Structured events follow OpenTelemetry GenAI-inspired naming so hosts can
 * forward to CloudWatch EMF / OTLP without inventing a second vocabulary.
 */

export type TelemetryName =
  | 'mcp_call'
  | 'mcp_write_consent'
  | 'ccloud_action'
  | 'skill_invoked'
  | 'skill_loaded'
  | 'memory_recall'
  | 'memory_mirror'
  | 'skill_mirror'
  | 'semantic_search'
  | 'tool_dispatch'
  | 'tool_error'
  | 'approval_wait'
  | 'approval_abandon';

/** Named SLIs for dashboards / exit criteria. */
export const AGENT_SLIS = {
  /** p95 latency of recall_project_memory tool observations (ms). */
  MEMORY_RECALL_P95_MS: 'walkcroach.agent.memory_recall_p95_ms',
  /** tool_error / tool_dispatch. */
  TOOL_ERROR_RATE: 'walkcroach.agent.tool_error_rate',
  /** approval_abandon / (approval_wait + approval_abandon). */
  APPROVAL_ABANDON_RATE: 'walkcroach.agent.approval_abandon_rate',
} as const;

export type AgentSliName = (typeof AGENT_SLIS)[keyof typeof AGENT_SLIS];

export type TelemetryCounters = Record<TelemetryName, number>;

export type StructuredTelemetryEvent = {
  /** e.g. `gen_ai.tool.call`, `walkcroach.approval.wait` */
  name: string;
  ts: number;
  attrs: Record<string, string | number | boolean | undefined>;
};

export function emptyTelemetry(): TelemetryCounters {
  return {
    mcp_call: 0,
    mcp_write_consent: 0,
    ccloud_action: 0,
    skill_invoked: 0,
    skill_loaded: 0,
    memory_recall: 0,
    memory_mirror: 0,
    skill_mirror: 0,
    semantic_search: 0,
    tool_dispatch: 0,
    tool_error: 0,
    approval_wait: 0,
    approval_abandon: 0,
  };
}

export class TelemetrySink {
  readonly counters = emptyTelemetry();
  readonly events: StructuredTelemetryEvent[] = [];
  /** Optional forwarder (EMF logger, OTLP, host.emit). */
  onEvent?: (event: StructuredTelemetryEvent) => void;

  private readonly toolLatenciesMs: number[] = [];
  private readonly recallLatenciesMs: number[] = [];

  bump(name: TelemetryName, n = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + n;
  }

  emit(name: string, attrs: StructuredTelemetryEvent['attrs'] = {}): void {
    const event: StructuredTelemetryEvent = {
      name,
      ts: Date.now(),
      attrs,
    };
    this.events.push(event);
    this.onEvent?.(event);
  }

  recordTool(params: {
    name: string;
    status: 'success' | 'error' | 'rejected';
    latencyMs: number;
  }): void {
    this.bump('tool_dispatch');
    this.toolLatenciesMs.push(params.latencyMs);
    if (params.status === 'error') this.bump('tool_error');
    if (params.name === 'recall_project_memory') {
      this.recallLatenciesMs.push(params.latencyMs);
    }
    this.emit('gen_ai.tool.call', {
      'gen_ai.tool.name': params.name,
      'gen_ai.tool.status': params.status,
      'gen_ai.tool.latency_ms': params.latencyMs,
    });
  }

  recordApprovalWait(params: {
    kind: string;
    outcome: 'resolved' | 'abandoned' | 'waiting';
    waitMs?: number;
  }): void {
    if (params.outcome === 'abandoned') this.bump('approval_abandon');
    else if (params.outcome === 'waiting' || params.outcome === 'resolved') {
      this.bump('approval_wait');
    }
    this.emit('walkcroach.approval', {
      kind: params.kind,
      outcome: params.outcome,
      wait_ms: params.waitMs,
    });
  }

  toolErrorRate(): number {
    const total = this.counters.tool_dispatch;
    if (total <= 0) return 0;
    return this.counters.tool_error / total;
  }

  approvalAbandonRate(): number {
    const waited = this.counters.approval_wait;
    if (waited <= 0) return 0;
    return this.counters.approval_abandon / waited;
  }

  memoryRecallP95Ms(): number | undefined {
    return percentile(this.recallLatenciesMs, 0.95);
  }

  /**
   * CloudWatch Embedded Metric Format payload (one log event).
   * Hosts JSON.stringify and write to stdout / CW Logs.
   */
  toEmf(namespace = 'WalkCroach/Agent'): Record<string, unknown> {
    const recallP95 = this.memoryRecallP95Ms();
    return {
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: namespace,
            Dimensions: [['Service']],
            Metrics: [
              { Name: 'ToolDispatch', Unit: 'Count' },
              { Name: 'ToolError', Unit: 'Count' },
              { Name: 'ToolErrorRate', Unit: 'None' },
              { Name: 'ApprovalAbandonRate', Unit: 'None' },
              ...(recallP95 !== undefined
                ? [{ Name: 'MemoryRecallP95', Unit: 'Milliseconds' as const }]
                : []),
            ],
          },
        ],
      },
      Service: 'agent-engine',
      ToolDispatch: this.counters.tool_dispatch,
      ToolError: this.counters.tool_error,
      ToolErrorRate: this.toolErrorRate(),
      ApprovalAbandonRate: this.approvalAbandonRate(),
      ...(recallP95 !== undefined ? { MemoryRecallP95: recallP95 } : {}),
      sli: { ...AGENT_SLIS },
    };
  }
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[idx];
}
