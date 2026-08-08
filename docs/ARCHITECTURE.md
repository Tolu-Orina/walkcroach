# WalkCroach architecture — dual loops and non-goals

**Status:** Living document (Phase 4 + Pre–Phase 6)  
**Related:** `skills/EA/references/sdk-platform.md`, `docs/walkcroach-sdk-implementation-plan.md`, ADR-0003, `docs/research/agentic-frameworks-landscape-2026.md`, `docs/observability-agent-telemetry.md`

## Public API domain

- **Hostname:** `api.walkcroach.rinegansolutions.com` (owned zone `rinegansolutions.com`)
- **Portal:** `walkcroach.rinegansolutions.com` (unchanged)
- Terraform: `infra-backend/modules/apigw-rest/domain.tf` + `api_custom_domain_name` in prod.tfvars
- Do **not** use `*.walkcroach.dev` / `api.walkcroach.com` — we do not own those

## Durable runs — interrupt / resume (Pre-P6)

- Status `interrupted` is a pause, not a failure.
- Snapshot includes `threadId` (= `runId` for content) and `interrupt`.
- Resume: `POST /v1/runs/{id}/resume` with `{ interruptId, value }`.
- Harness pauses (`awaiting_tool` / `awaiting_plan_approval`) map to interrupt kinds in `packages/sdk/src/interrupt.ts` (state machines stay separate).

## Observability (Pre-P6)

- Engine `TelemetrySink` + optional OTEL/LangSmith/Langfuse env exporters.
- Eval suite: `packages/agent-engine/src/eval/README.md` (`npm run eval`).
- Governance checklist: portal `/app/developer/governance`.

## Two agent loops (intentional)

| Loop | Package | Surfaces | Why it exists |
|---|---|---|---|
| **Harness** | `@walkcroach/agent-harness` | Web, Chrome, content runs | Multi-tenant inference, creatives, E2B, connectors |
| **Engine** | `@walkcroach/agent-engine` (private) | IDE, CLI, Desktop, sdk-host | Local FS, approvals, worktrees, BYOK |

We **do not** merge these into one binary. Drift is controlled by **shared contracts**, not by forcing one runtime.

## Shared contracts (must stay single-source)

| Package | Owns |
|---|---|
| `@walkcroach/memory-contracts` | `MemoryKind`, export envelope (`walkcroach-memory-export/1.0`), supersede/`RememberResult`, `normalizeMemoryKind`, minimal `SharedMemoryUiEvent` |
| `@walkcroach/agent-protocol` | Desktop agent-ui ↔ workbench messages (PROTOCOL_VERSION) |
| `@walkcroach/sdk` + OpenAPI `/v1` | Public HTTP memory/content contract |

**First-party SDK consumers:** IDE / CLI / Desktop (`createHostMemoryBridge`); **Web** + **Chrome** (`sdkClient` + Cognito for memory list/remember/export). Agent turns (Web/Chrome) stay on harness streams. Capture→project mirror remains server-side in lambda-chrome.

Fitness: `packages/memory-contracts` tests + `npm run check:drift` must stay green. A memory semantic fix that only lands in harness **or** SDK is a Phase 4 regression.

## Explicit non-goals

1. **Do not publish `@walkcroach/agent-engine` to npm** until Phase 6 triggers fire (external HostAdapter demand).
2. **Do not merge harness ↔ engine** until the revisit trigger below is met and an ADR accepts the merge.
3. **Do not unify full `AgentEvent` unions** across loops — only the minimal memory UI subset in `memory-contracts`.
4. **Do not claim multi-year MVCC asOf** — see ADR-0001 / ADR-0002.

## Revisit trigger — merge vs forever-dual

From `sdk-platform.md` §8, **quantified** for engineering review:

**Revisit engine↔harness merge only if, within a single calendar quarter, either:**

| Metric | Threshold |
|---|---|
| **A. Dual-fix bugs** | ≥ **3** distinct defects in memory kinds, export/import envelope, supersede semantics, or tool-registry behaviour that required **identical** fixes in both loops |
| **B. Dual LOC churn** | ≥ **500** net LOC changed in *both* `agent-engine` and `agent-harness` tool/memory surfaces for the **same** semantic change set |

Until **A or B** is measured and recorded in a quarterly note:

> We will not merge loops. We keep forever-dual with `@walkcroach/memory-contracts` + OpenAPI as the convergence surface.

When A or B fires: open an ADR proposing a shared core with two adapters (or reject with evidence). Do not “just merge” mid-sprint.

## Fitness functions (ongoing)

- Cross-surface remember→recall across `web|chrome|ide|cli|sdk|desktop`
- Memory-contracts drift check vs OpenAPI `MemoryKind`
- Harness export fixture validates via contracts `validateExport` (SDK-readable)
- Agent-engine security evals + harness memory unit tests
- **Agentic-pattern upgrade (Phases 0–8):** `agent-engine` + `agent-harness` `src/fitness/agentic-pattern-fitness.test.ts` (thrash, plan isolation, CriticGate, Graph bounds/reuse, BYO fail-closed, checkpoint GC policy). Retrospective: `docs/adr/ADR-J-phase7-8-retrospective.md`.
- **Tool sync hardening:** content-hash freshness (mtime alone is insufficient); session `formatOnSave` suppress on IDE/Desktop; Desktop `supportsMtimeFreshness` parity with IDE/CLI.

## Agentic Graph / Critic (Phases 3–8)

- Internal Graph + CRDB checkpoints in `@walkcroach/agent-harness` (not agent-engine).
- Public Run Graph DSL: platform catalog only — **BYO tools rejected** (ADR-I / ADR-J).
- CriticGate Tier 1 always on; Tier 2/3 opt-in via `WALKCROACH_ENABLE_MODEL_CRITIC` (default off).
- Checkpoint bulky state retention: 30 days (`pruneStaleGraphCheckpoints`).
