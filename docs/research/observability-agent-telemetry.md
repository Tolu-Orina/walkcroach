# Agent telemetry & observability (Pre–Phase 6)

WalkCroach uses a **TelemetrySink** inside `@walkcroach/agent-engine` with GenAI-inspired event names (`gen_ai.tool.call`, `walkcroach.approval`, …). Hosts may forward events without rebuilding LangSmith.

## Trace vocabulary

| Concept | WalkCroach |
|---|---|
| **run** | One tool/LLM step event |
| **trace** | One agent loop / content run (`runId`) |
| **thread** | `threadId` on run snapshots (= `runId` for content; harness `sessionId` for Web) |

## Env sinks (optional)

| Variable | Effect |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | POST OTLP JSON logs to `{endpoint}/v1/logs` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Comma `k=v` headers |
| `WALKCROACH_OTEL_SERVICE_NAME` | Default `walkcroach-agent-engine` |
| `LANGSMITH_API_KEY` | Best-effort LangSmith run POST |
| `LANGSMITH_ENDPOINT` / `LANGSMITH_PROJECT` | Optional overrides |
| `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` | Best-effort Langfuse ingestion |
| `LANGFUSE_BASE_URL` | Default `https://cloud.langfuse.com` |

Wiring: `attachEnvExporters(telemetry)` is called from `runAgentLoop`. Failures are swallowed.

## Memory path

CloudWatch namespace `WalkCroach/Memory` — see Developer Ops. Separate from agent-engine OTEL.

## Interrupt / resume

Durable content runs support LangGraph-style pause:

- Status `interrupted` + `interrupt` payload on `GET /v1/runs/{id}`
- `POST /v1/runs/{id}/resume` with `{ interruptId, value }`
- SDK: `RunInterruptedError` from `wait()`, then `run.resume({ interruptId, value })`

See `packages/sdk/src/interrupt.ts` and Developer → Governance.
