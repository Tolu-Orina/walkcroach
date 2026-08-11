# Agentic Pattern Upgrade — Implementation Plan
## Quality-first: internal Graph capability, Planner-as-subagent everywhere, deterministic critic, durable checkpointing

**Status:** Complete (Phases 0–8; quality-first + public Run Graph DSL / A11)
**Extends:** `agentic-patterns-walkcroach-upgrades-v2.md` + prior amended draft of this plan
**Ranking attribute (sole):** **Outcome quality** of agentic runs (correctness, recoverability, isolation of failure, bounded thrash) — *not* time-to-ship, *not* token cost, *not* latency. Cost/latency are measured and capped against runaway, but they do not win trade-offs against quality.
**Written using:** `walkcroach-enterprise-systems-architecture` (ADRs, fitness functions, Decision/Ask) + `agentic-systems.md` + web research (LangGraph production checkpointing 2026; Strands Graph; AWS LangGraph+Strands on AgentCore; OpenDev arXiv:2603.05344)

### Assumptions architected against (explicit)

1. Quality is the only ranking attribute for design conflicts (user directive, Aug 2026).
2. SDK is a **platform product**: memory + durable runs + (after internal Graph is proven) a **public Run Graph DSL** over platform nodes — not a BYO-tools LangGraph clone. Differentiated VP = memory-native durable graphs on WalkCroach infrastructure (AgentCore-class “platform” framing, not Strands/LangGraph “framework” framing).
3. Dual loops stay: Graph orchestration lives where durable product pipelines already live (**harness / sdk-host / ide-worker**); **agent-engine** remains the node-level ReAct reasoning loop (HostAdapter). Matches the AWS production split: LangGraph-class macro orchestration + Strands/engine-class node reasoning ([AWS ML Blog — Market surveillance on AgentCore](https://aws.amazon.com/blogs/machine-learning/market-surveillance-agent-with-langgraph-and-strands-on-agentcore/)).
4. We **build** an internal Graph capability on CockroachDB checkpoints — we do **not** adopt LangGraph or Strands as a runtime dependency for WalkCroach (ideas + contracts, not a framework fork).

### Supersessions (never delete — mark superseded)

| Prior decision | Status | Why superseded |
|---|---|---|
| Non-goal: “no general Graph runtime — fixed publish SM only” | **Superseded** | Quality-first: reusable internal Graph raises ceiling for all run kinds; one-off SMs reintroduce orchestration bugs per product (LangGraph/Strands production practice) |
| Amendment A2: lightweight Plan node default for publish | **Superseded** | Quality-first: **always** schema-restricted Planner subagent for Plan stage (OpenDev); same for IDE and publish |
| Non-goal / prior ask: “SDK stays without public Graph DSL” | **Superseded (A11)** | Public **Run Graph DSL** (platform nodes only) improves SDK VP: memory alone commoditizes; AgentCore-class platforms sell memory **with** durable orchestration ([AgentCore platform framing](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)); `content.publish` becomes one catalog graph, not the only way to buy patterned quality |
| Phase ordering that prioritized CriticGate-lite *instead of* Graph | Softened | 4a may still run **in parallel** as a safety net on the live path, but Graph capability is a **first-class phase**, not deferred convenience |

**Still in force:** A1 (SDK auto-approve Plan — no live HITL channel), A3 (mtime capability gate), A4 (thrash storage split), A5 (lease→recoverable checkpoint), A6 (events-first findings), A8 (Phase 0 live surfaces only).

---

## 0. Scope and the boundary that must not move

**In scope:**
- `@walkcroach/agent-engine` — bounded executor, Planner subagent, CriticGate primitives, HostAdapter hooks.
- **Internal Graph orchestration capability** — typed nodes/edges/cycles/checkpoints — owned by harness/sdk-host (durable runs), invoked by ide-worker for `content.publish` and customer run graphs.
- `@walkcroach/sdk` — memory, productized run kinds (`content.publish`), progress/result contracts, and (Phase 6b) **public Run Graph DSL** over the **platform node catalog**.

**The invariant:**

> `agent-engine` owns node-level patterns (tools, thrash, subagents, critique). It stays private.
> **Internal Graph** owns stage-level orchestration (edges, bounds, checkpoints, interrupts). It stays private as a *runtime*.
> `@walkcroach/sdk` exposes **platform contracts**: memory, run kinds, and a versioned **Run Graph DSL** that composes **WalkCroach platform nodes only** — never engine internals, never arbitrary customer tools/HostAdapter in v1.

**Explicit non-goals:**
- Public BYO-tools / HostAdapter GraphBuilder (LangGraph/Strands competitor) — **rejected**; that dilutes the moat and becomes a support sink (sdk-platform.md + landscape research).
- Merging agent-engine and harness into one binary.
- Publishing agent-engine as the SDK.
- Adopting LangGraph / Strands / CrewAI as production dependencies (steal patterns; own the CRDB-backed runtime).
- ACE playbook / role-named subagents beyond Planner / model critic — **Phase 8 go/no-go: deferred/no** (see ADR-J). Model critic shipped opt-in only.

---

## 0.05 VP judgment — public Graph DSL (A11)

**Question:** Does a public Graph DSL improve `@walkcroach/sdk`'s value proposition?

**Answer: Yes — if and only if it is a memory-native Run Graph DSL over platform nodes.**

| Option | Improves differentiated VP? | Why |
|---|---|---|
| Memory + hard-coded `content.publish` only | Partial | Strong for one job; customers needing a second patterned pipeline wait on WalkCroach to ship a new run kind |
| **Public Run Graph DSL (platform nodes: fence, plan, draft, critique, remember, memory.\*, gates)** | **Yes** | Matches AgentCore-class pitch: shared memory + durable orchestration + paved nodes ([AgentCore “agent platforms”](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)); customers compose quality graphs; WC meters durable runs; memory stays the glue |
| Public BYO Graph DSL (customer tools, arbitrary nodes) | **No** for WalkCroach | Undifferentiated vs LangGraph/Strands/Mastra; couples public API to engine; infinite support surface; landscape note already warned against this |

**Trade-off accepted:** SDK surface grows; semver discipline on the node catalog is mandatory; v1 forbids customer tools so quality rails (Planner schema, CriticGate, writeScope, checkpoints) remain enforceable.
---

## 0.1 Quality attribute scenarios (acceptance spine)

Per EA quality-attributes practice — these are the measures that decide pass/fail:

1. **Thrash:** Source=agent · Stimulus=identical tool fingerprint ≥3 in window · Artifact=engine · Response=warn then hard halt (interactive: Allow/Break; async: fail-closed/strategy-switch) · Measure=execution stopped by threshold+1; FP rate tracked.
2. **Plan isolation:** Source=Plan stage · Stimulus=Planner runs · Artifact=subagent schema · Response=zero write tools in schema · Measure=schema assert 100%; zero stuck-in-plan-mode incidents (OpenDev failure mode eliminated).
3. **Checkpoint recoverability:** Source=worker kill or lease expiry mid-stage · Artifact=Graph + `agent_runs` · Response=resume from last completed stage · Measure=0 re-execution of completed Draft/Fence; lease-loss recoverable (not fail-wipe).
4. **Critique enforcement:** Source=Draft output · Stimulus=forbidden import / schema break · Artifact=CriticGate · Response=block + revise ≤N · Measure=0 succeeded runs with `@/` (or listed forbidden) reaching consumer typecheck.
5. **Graph reuse:** Source=second run kind · Stimulus=new pipeline · Artifact=internal Graph · Response=new graph definition, no new orchestrator · Measure=second kind adds nodes/edges only — no copy-paste of resume/lease/cycle code.
6. **Public Run Graph:** Source=SDK customer · Stimulus=`graphs.run(definition)` using only catalog nodes · Artifact=SDK + ide-api · Response=durable run with checkpoints/events like `content.publish` · Measure=customer graph cannot register non-catalog tools; OpenAPI forbids BYO tool nodes in v1.

---

## 0.2 Research grounding for the quality-first decisions

### Why an *internal* Graph capability (decision #1)

| Source | Finding that binds us |
|---|---|
| [Strands Graph](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/) | Deterministic directed graphs with **cycles**, conditional edges, **max_node_executions** / timeouts, custom nodes, output propagation — the shape of Fence→Plan→Draft→Critique⇄Revise→Remember |
| [Strands multi-agent patterns](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/) | Graph vs Workflow: Workflow forbids cycles; **iterative refine needs Graph** |
| AWS LangGraph + Strands on AgentCore | Macro orchestration (state, directed graph, checkpoint recovery, HITL) **separate from** node-level reasoning agents — maps to harness Graph + engine loop |
| LangGraph production 2026 (Postgres/Redis checkpointers) | Durable checkpoint after each node; typed serializable state; `thread_id` isolation; recursion/step ceilings; **idempotent node side effects**; TTL/GC for checkpoint growth ([production guides](https://rapidclaw.dev/blog/deploy-langgraph-production-tutorial-2026), [field lessons](https://devops.gheware.com/blog/posts/langgraph-production-ai-agents-2026.html)) |
| WalkCroach agentic-systems §7 | Loop/thrash, silent partial failure, cascading multi-agent error — mitigations are **bounded execution, verification steps, validate at boundaries** — Graph stages are the structure those mitigations attach to |
| Platform (**verified**) | `agent_runs` + `agent_run_events` already are the durable job + progress channel; `reapExpiredRuns` fail-wipes today — Graph + checkpoint redesign is required for quality of long jobs |

**Rejected alternative — fixed publish-only state machine:** wins on calendar; loses on scenario #5 (Graph reuse) and repeats orchestration defects for every new run kind. Rejected under quality ranking.

**Rejected alternative — depend on LangGraph/Strands in Lambda:** wins on feature completeness; loses on dual-loop identity, TypeScript stack coherence, and coupling public durability to a third-party Pregel runtime. Steal contracts; implement on CRDB.

### Why *always* Planner-as-subagent for publish Plan (decision #3)

| Source | Finding that binds us |
|---|---|
| OpenDev (arXiv:2603.05344) | Mode-toggle plan failed (stuck read-only); **Planner subagent with write tools absent from schema** is the replacement; explore→analyze→structured plan; `present_plan` for review |
| Agentic-systems §3 | Separate read from write **in the registry** — strongest isolation |
| Agentic-systems §4 | Sub-agents earn keep by returning **summaries**, isolating exploration noise from parent — exactly what Plan needs before Draft |
| Field / multi-agent practice | Plan-then-execute with restricted architect/planner roles improves scope fidelity vs one-shot generation |

**Supersedes A2:** a single structured-JSON Plan call is cheaper and faster but skips explore/analyze isolation — unacceptable when quality is sole ranking. Publish still **auto-approves** the present_plan artifact on SDK hosts (A1) — the Planner still *runs*; humans are not required on the default async path.

**Trade-off accepted:** higher token/latency on every publish Plan stage; paid deliberately for plan quality and schema-level write impossibility.

---

## 1. Architecture decisions (binding)

### ADR-G: Own an internal Graph orchestration capability (quality-first)

**Decision:** Build a private Graph runtime (nodes, directed edges, conditional edges, bounded cycles, stage-typed state, CRDB checkpointer keyed by `run_id` ≈ LangGraph `thread_id`) in harness/sdk-host. `content.publish` is the **first consumer**, not the only intended one.

**Minimum Graph surface (internal):**
- `defineGraph({ nodes, edges, entry, maxNodeExecutions, nodeTimeouts })`
- Node kinds: `code` (deterministic), `agent` (engine `runAgentLoop` / role), `subagent` (Planner), `gate` (CriticGate)
- After each node: persist checkpoint (`current_stage`, `stage_state`, `stage_state_version`, `checkpoint_at`)
- On revisit: configurable reset vs accumulate (Strands `reset_on_revisit` analogue)
- Cycle bound: Critique→Revise→Critique via `revise_count` + `maxNodeExecutions`

**Dominant trade-off:** build/maintain cost and calendar vs one-off SM simplicity. Quality ranking picks Graph.

**Revisit trigger:** only if a second run kind never materializes *and* Graph maintenance cost dominates — reopen after Phase 8 retrospective with evidence.

### ADR-A: Planning is always a schema-restricted Planner subagent

**Decision:** Interactive *and* `content.publish` Plan stages spawn the same `Planner` SubAgentSpec (read-only tool schema). Interactive: `present_plan` → human approve/revise. SDK/async: Planner runs fully → plan artifact auto-approved and injected as non-negotiable Draft context (A1).

**Supersedes:** mode:plan toggle; lightweight Plan-node default (A2).

### ADR-B: `content.publish` is a Graph with one bounded cycle

Unchanged in intent; now **implemented on ADR-G**, not as bespoke control flow.

### ADR-C: Checkpoint at stage granularity + lease-recoverable pause

Unchanged + A5: lease expiry → recoverable interrupt preserving checkpoint columns; resume must not clear `stage_state`; Draft idempotent.

### ADR-D: Deterministic CriticGate floor before model tiers

Unchanged; Phase 7 gated.

### ADR-E: HITL policy is host-capability based

Unchanged (A1).

### ADR-F: Events-first audit channel

Unchanged (A6).

### ADR-H: Build vs buy for Graph

**Decision:** **Build** thin internal Graph + CRDB checkpointer. **Buy/adopt** nothing as the orchestration kernel.

**Would have to be true for LangGraph to win:** team accepts Python worker split or TS LangGraph equivalent with production maturity matching CRDB tenancy — currently false for WalkCroach dual-loop TypeScript platform.

### ADR-I: Public Run Graph DSL on `@walkcroach/sdk` (A11) — platform nodes only

**Decision:** After Phase 5 proves internal Graph + `content.publish`, ship a versioned public API:

```ts
// Illustrative — exact names in OpenAPI
wc.graphs.run({
  graph: {
    nodes: [ /* catalog ids only */ ],
    edges: [ /* including bounded cycles */ ],
    entry: 'fence',
    maxNodeExecutions: 40,
  },
  input: { /* typed per entry node */ },
})
```

**v1 node catalog (closed):** e.g. `fence`, `plan` (Planner subagent), `draft` / `implement`, `critique` (CriticGate), `revise`, `remember`, `memory.recall`, `memory.remember`, plus documented `content.publish` as a **named preset graph** built from the same catalog.

**v1 forbids:** customer tool registration, HostAdapter plugins, arbitrary code nodes that escape writeScope/sandbox policy, CriticGate schema authoring that disables the deterministic floor.

**Dominant trade-off:** richer platform VP and customer self-serve pipelines vs semver/support load on the catalog. Rejected alternative (BYO tools) would improve “framework checklist” appeal but **not** WalkCroach’s differentiated VP (memory + durable quality rails).

**Revisit trigger for BYO tools:** only after catalog graphs are stable in production *and* a paid support tier exists — Phase 8+ explicit go/no-go, not sneaking in during 6b.

---

## 2. Data model changes

```sql
-- Durable Graph checkpoint (LangGraph PostgresSaver analogue on CockroachDB)
ALTER TABLE agent_runs ADD COLUMN current_stage STRING;
ALTER TABLE agent_runs ADD COLUMN stage_state JSONB NOT NULL DEFAULT '{}';
ALTER TABLE agent_runs ADD COLUMN stage_state_version INT NOT NULL DEFAULT 1;
ALTER TABLE agent_runs ADD COLUMN checkpoint_at TIMESTAMPTZ;
ALTER TABLE agent_runs ADD COLUMN revise_count INT NOT NULL DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN graph_id STRING;           -- which graph definition
ALTER TABLE agent_runs ADD COLUMN node_execution_count INT NOT NULL DEFAULT 0;
  -- Strands/LangGraph-style global execution ceiling companion
ALTER TABLE agent_runs ADD COLUMN tool_fingerprints JSONB NOT NULL DEFAULT '[]';
  -- durable runs only (A4)

-- Progress / critic: agent_run_events (existing). Optional critic_findings table deferred (A6).
```

**Resume (**verified** gap):** today’s `resumeRun` nulls `result`; checkpoint columns must survive. **Reaper (**verified**):** today’s `reapExpiredRuns` fails running rows — staged graphs require recoverable pause instead.

---

## 3. Phased plan (quality-first sequence)

### Phase 0 — Baseline instrumentation

Unchanged intent: log-only thrash/error distributions on IDE/CLI/sdk-host (A8). Time-box sample collection, but **do not** let calendar pressure shrink Phase 1 thresholds below Phase 0 evidence.

**Implementation (shipped in `@walkcroach/agent-engine`):**
- Module: `packages/agent-engine/src/tool-call-observe.ts`
- Wired in `loop.ts` after every tool result (observe-only alongside Phase 1)
- Emits `walkcroach.tool_call.observe` + `tool_call_observe` host telemetry per call; `walkcroach.tool_call.observe_summary` / `tool_call_observe_summary` at session end
- Sliding window default 20; probes would-halt at 2/3/4; error classes: permission | not_found | edit_mismatch | syntax | rate_limit | timeout | other
- Phase 0 data report: aggregate `tool_call_observe_summary` detail JSON from IDE/CLI/sdk-host sessions

**Educated guess used to unlock Phase 1 before a field report** (revisit when summaries accumulate):

| Constant | Value | Basis |
|---|---|---|
| Window | 20 | OpenDev doom-loop |
| Thrash threshold | 3 | OpenDev + existing `DEFAULT_IDENTICAL_FAILURE_LIMIT` tests |
| Nudge budget | 3 | OpenDev error-recovery cap |
| Any-status thrash | yes | OpenDev correction; happy-path fix-test changes args → different fingerprints → expected low FP; identical re-read 3× is the main FP (one-shot Allow mitigates) |
| Interactive vs async | IDE/CLI interactive; sdk-host `interactive: false` | No Allow UI on programmatic runs |

### Phase 1 — Bounded executor primitives

**Shipped.** Thrash two-tier (warn_skip → escalate Allow/Break or fail-closed), nudge budget with classified recovery hints, stale-read where `supportsMtimeFreshness`.

| Piece | Location |
|---|---|
| Thrash + nudge | `bounded-executor.ts` + `loop.ts` `runOneTool` |
| Stale-read | `read-freshness.ts` + `execute.ts` write/edit/patch |
| IDE/CLI mtime | `VsCodeHostAdapter` / `CliHostAdapter` `supportsMtimeFreshness` + `getFileMtimeMs` |
| sdk-host | `runProgrammatic` → `boundedExecutor: { interactive: false }` |
| Disable legacy-only | `boundedExecutor: { enabled: false }` |

**Exit criteria status:** unit tests cover thrash warn→escalate→one-shot, nudge budget, stale reject 100% when capability on / no-op when off. IDE canary FP rate still to measure in the field.

### Phase 2 — Planner-as-subagent (ADR-A) — **all Plan consumers**

**Shipped in `@walkcroach/agent-engine`** (publish Plan *stage* wires the same Planner in Phase 5 on ADR-G).

| Piece | Location |
|---|---|
| Planner allowlist + seven-section schema | `planner.ts` (`PLANNER_TOOL_ALLOWLIST`, `validatePlanArtifact`, `assertPlannerSchemaHasNoWriteTools`) |
| `submit_plan` / `present_plan` tools | `tools/defs.ts` + `tools/execute.ts` (plannerMode gate; planSession Approve/Revise/auto-approve) |
| Plan-then-execute routing | `loop.ts` `runPlanThenExecute` — sticky `mode:plan` / permissionMode plan → Planner → present → execute with `approvedPlan` |
| Intent heuristic | `looksLikePlanningTask` + `plannerFirstOnIntent` (default true; sdk-host false) |
| Parent spawn | `spawn_subagent` `role=planner` → same SubAgentSpec |
| sdk-host | `autoApprovePlan: true`, `plannerFirstOnIntent: false` (A1) |
| Tests | `planner.test.ts` (schema zero-writes + artifact + tool gates); guardrails still sticky on bare `readOnly: true` |

**Routing precision:** bare `readOnly: true` stays a sticky explore loop (no plan-then-execute). Only `mode: 'plan'`, permissionMode plan (`resolved.readOnly`), or planning-intent (when enabled) enter Planner → present → execute.

**Still open until Phase 5 canary:** publish worker Plan stage using this Planner; field “zero stuck-plan” metric; sunset of any remaining host UX that implies sticky plan-without-execute.

**Exit (engine):** schema assert 100%; plan artifact conformance on submit; interactive present_plan Approve/Revise; async auto-approve — **met in unit tests**.

### Phase 3 — Internal Graph runtime + durable checkpointing (ADR-G, ADR-C, A5)

**Shipped in `@walkcroach/agent-harness`** (product `content.publish` rewire is Phase 5).

| Piece | Location |
|---|---|
| Migration | `db/migrations/040_agent_run_graph_checkpoint.sql` |
| define / registry / executor | `agent-harness/src/graph/{define,registry,executor,types}.ts` |
| Checkpointers | `MemoryGraphCheckpointer` + `CrdbGraphCheckpointer` |
| Dummy graphs (cycle + linear) | `graph/dummy-graphs.ts` — second graph proves scenario #5 |
| A5 reaper | `reapExpiredRuns`: `graph_id` → re-queue preserving checkpoint; legacy → fail-wipe |
| A5 resume | `resumeRun`: never clears stage columns; graph runs keep non-interrupt `result` |
| Events | executor emits `stage.*`; `runGraphOnAgentRun` appends them to `agent_run_events` |
| Tests | `graph/graph.test.ts` (exit 1/3/4/5); `graph/a5-run-store.test.ts` (reaper + resume SQL) |

**Exit criteria status:**
1. Kill mid-node → resume at same stage with prior state + idempotent writes — **met (unit)**
2. Lease expiry recoverable with stage preserved — **met (reaper SQL + resume SQL unit)**; CRDB integration when migration applied
3. Cyclic dummy hits `maxNodeExecutions` — **met**
4. Checkpoint `writeMs` recorded on every save — **met** (never skipped for speed)
5. Second dummy graph via registry — **met** (`dummy.linear`)

**Not in Phase 3:** wiring `publishContent` onto the Graph (Phase 5); public Run Graph DSL (Phase 6b).

### Phase 4 — Deterministic CriticGate (general primitive)

**Shipped in `@walkcroach/agent-harness`** (`src/critic-gate/`).

| Piece | Location |
|---|---|
| Enforcement API | `runCriticGate` → `pass` / `revise` / `fail` (evaluation alone is not a gate) |
| Tier-1 checks | `createForbiddenImportCheck`, `createOutputRedFlagCheck`, `createJsonObjectSchemaCheck`, `createMinArtifactsCheck`, `defaultPublishCriticChecks` |
| Events | `critic.findings`, `critic.enforcement`, `critic.model_skipped` (A6) |
| Graph adapter | `createCriticGateGraphNode` for Phase 5 Critique stage |
| Tier 2/3 | `createTier2ModelCriticStub` / `createTier3ModelCriticStub` — throw unless Phase 7 enables |
| Tests | `critic-gate/critic-gate.test.ts` (block `@/`, schema, events, graph cycle, stubs unused by default) |

**Invariant:** model critic never runs on the default path (`enableModelCritic` default false).

### Phase 4a — CriticGate on live publish path (parallel safety net)

**Superseded by Phase 5.** Linear fail-closed CriticGate in `publishContent` was deleted when Graph Critique⇄Revise took ownership (no dual Critique).

### Phase 5 — `content.publish` on the internal Graph

**Shipped.**

| Piece | Location |
|---|---|
| Graph | `content-publish-graph.ts` — Fence → Plan → Draft → Critique ⇄ Revise → OpenPR → Remember |
| `planOnly` | agent-engine + sdk-host — Plan stage stops after auto-approve; emits `plan.auto_approved` |
| AgentRunner roles | `plan` / `draft` / `revise` via `createAgentRunner` |
| Worker | passes `runId` + `onStageEvent` for CRDB checkpoints + `stage.*` / `plan.auto_approved` events |
| Eval suite | `content-publish-graph.test.ts` — 10 cases, explicit 100% success rate on suite |

**Exit criteria status:**
1. Eval suite ≥10 with explicit success rate — **met (unit, mock AgentRunner)**
2. Kill + lease-loss resume on real publish — **infra from Phase 3**; live canary still field
3. Zero forbidden `@/` on succeeded outputs — **met (suite asserts)**
4. Planner schema assert — **met in agent-engine `planner.test.ts`**; Plan stage uses same Planner allowlist via `mode:plan` + `planOnly`
5. Auto-approved plan in Draft + `plan.auto_approved` — **met**

### Phase 6 — SDK surface for productized runs

**Shipped in `@walkcroach/sdk` (+ harness stamp).**

| Piece | Location |
|---|---|
| Contract id | `CONTENT_PUBLISH_CONTRACT_VERSION = 'content.publish/v1'` (SDK + harness) |
| Richer `PublishResult` | `contractVersion`, `criticFindings`, `planAutoApproved`, `approvedPlan` |
| Progress helpers | `isStageProgressEvent` / `isCriticProgressEvent` / `isPlanProgressEvent` / `RUN_PROGRESS_EVENT_TYPES` |
| Plan policy | `planApproval: 'auto' \| 'required'` — **required rejected** on v1 (A1 auto-approve); `requirePlanApproval` alias |
| OpenAPI | `RunSnapshot`, `RunEvent`, `PublishResult`, `CriticFinding`; `afterSeq` on GET `/runs/{id}`; publish docs for auto-approve |
| Docs | SDK README “Content publish” section |
| Reuse for 6b | Same poll/`wait`/`onProgress` + progress type helpers — **no GraphBuilder** |

**Not in Phase 6:** `wc.graphs.*`, implementing async HITL for plan approval, Field Press progress UI.

### Phase 6b — Public Run Graph DSL (ADR-I / A11)

**Shipped.**

| Surface | What |
|---|---|
| Harness | `public-catalog` / `validatePublicGraph` / `compilePublicGraph` / `runPublicGraph`; sample `sample.quality.fence_critique_remember` |
| ide-api | `GET /v1/graphs/catalog`, `POST /v1/graphs/validate`, `POST /v1/graphs/run`; worker `kind: 'graph.run'`; capability `graphs:run` |
| SDK | `wc.graphs.catalog` / `validate` / `run` → `RunHandle`; `GRAPH_RUN_CONTRACT_VERSION`; OpenAPI schemas |
| Metering | `graph_run` ledger debit on submit; `sdk.graphs.completed` with `visitCounts` |
| Contract tests | BYO forbidden keys fail closed 100%; sample graph completes with checkpoints |

**Exit criteria:**
1. Scenario #6 fitness function green (catalog-only) — **met** (`public-graph.test.ts`)
2. Third-party-shaped sample graph completes — **met** (`buildSampleQualityGraph`)
3. OpenAPI: no engine/CriticGate internals / HostAdapter in public types — **met**
4. Metering per node/execution — **met** (`visitCounts` on result + metricLog)

**Not in Phase 6b:** BYO tools; GraphBuilder; async HITL plan approval on custom graphs; Field Press UI for graph composer.

### Phase 7 — Model critic tiers (evidence-gated)

**Shipped (opt-in; default off).** See `docs/adr/ADR-J-phase7-8-retrospective.md`.

| Piece | Location |
|---|---|
| Tier 2 heuristic | `createTier2HeuristicModelCritic` |
| Tier 3 LLM judge | `createTier3LlmModelCritic` (Bedrock; fail-soft; inject `invoke` in tests) |
| Env resolve | `WALKCROACH_ENABLE_MODEL_CRITIC` + `WALKCROACH_MODEL_CRITIC_TIER=2\|3` |
| Wiring | `content-publish-graph` Critique + public `critique` node |
| Events | `critic.model_invoked` / `critic.model_skipped` |
| Invariant | Tier-1 floor always runs first; model critic never on by default |

**Revisit for default-on:** ADR-J trigger (escape rate / revise thrash).

### Phase 8 — Hardening, CI fitness functions, retrospective

**Shipped.** See ADR-J.

| Go/no-go | Decision |
|---|---|
| ACE playbook | **No** |
| Role subagents + compaction | **No (deferred)** |
| `critic_findings` table | **No** (A6 events-first) |
| BYO tools on Graph DSL | **No** |
| Always-Planner | **Keep** |

| Hardening | Location |
|---|---|
| Fitness suite (scenarios 1–6) | `agent-harness/src/fitness/*`, `agent-engine/src/fitness/*` |
| Checkpoint GC | migration `041_*` + `pruneStaleGraphCheckpoints` (30d) |

**Programme status:** Phases 0–8 closed for this plan. Further expansion requires a new ADR.
---

## 4. Rollout order

| Surface | Phases 0–2 | Graph (3) / publish (5) / DSL (6b) | Notes |
|---|---|---|---|
| IDE | First for engine + Planner | — | Interactive present_plan |
| CLI | Second | — | |
| sdk-host | Phase 0/1; Planner in Phase 5 | Primary Graph + DSL executor | MemoryFileSystem: no mtime; Plan auto-approve |
| Desktop | When loop live | — | |
| SDK consumers | — | Phase 6 then 6b | Public Run Graph after publish proven |

---

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Graph build becomes unbounded science project | Minimum surface in ADR-G; dummy graph exit criteria before publish wiring |
| Always-Planner doubles publish cost/latency | Accepted under quality ranking; meter cost; do not swap back to light Plan without Phase 8 evidence |
| Auto-approve + rich Planner still drafts wrong | CriticGate + revise cycle + eval suite — not light Plan |
| Checkpoint bloat | TTL/GC policy (LangGraph production lesson); versioned state trimming |
| Dual Critique (4a + Graph) | Phase 5 delete-bypass exit criterion |
| Public DSL drifts into BYO LangGraph clone | ADR-I closed catalog; Phase 6b fail-closed tests; Phase 8 default-no on BYO tools |
| Catalog semver breaks customer graphs | Version node catalog; additive nodes only in minor; deprecate with migration notes |
| LangGraph envy / rewrite mid-flight | ADR-H revisit only with explicit dual-runtime acceptance |

---

## 6. Success metrics

- Eval success rate and forbidden-artifact escape rate (primary quality SLIs)
- Resume + lease-loss recovery rate
- Thrash halt vs FP rate
- Stuck-in-plan-mode count (target 0)
- Graph reuse: second run kind / customer graph effort (nodes/edges only)
- Public DSL: % of graph.run requests rejected for non-catalog nodes (should be 100% of invalid attempts)
- Critic cost/check (cap runaway; does not outrank quality)
- SDK: zero engine internals in public types; Run Graph DSL is intentional public surface

---

## Decision / Ask

Approve this **quality-first plan including A11**:

1. **Internal Graph capability (ADR-G)** as Phase 3 — `content.publish` is first consumer.
2. **Always Planner-as-subagent for publish Plan** — A2 superseded.
3. **Public Run Graph DSL (ADR-I)** in Phase 6b — platform node catalog only; improves SDK VP; **BYO tools still rejected**.
4. Prior A1/A3–A6/A8 and lease/checkpoint recoverability remain in force.

If approved, Phase 0 starts on IDE/CLI/sdk-host; Graph (Phase 3) is not optional; public DSL ships only after Phase 5 proves the runtime.

### Follow-on — tool sync hardening (post Phases 0–8)

Content-aware freshness in `agent-engine` (`read-freshness.ts`): track SHA-256 + optional mtime; hash-stable allows despite mtime drift (autosave/format); `write_file` rejects on content change with `[stale_read]` + excerpt; edits may proceed when `old_str` still unique. Session-scoped `formatOnSave` suppress on IDE (`webviewProvider`) and Desktop (`startDesktopSession` + hooks). Desktop HostAdapter gains `supportsMtimeFreshness` / `getFileMtimeMs` parity with IDE/CLI. sdk-host / MemoryFS remain mtime-off.

### Sources (web + internal)

- OpenDev — arXiv:2603.05344 (Planner subagent; doom-loop; stale-read)
- Strands — [Graph](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/), [Multi-agent patterns](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/)
- AWS — [LangGraph + Strands on AgentCore](https://aws.amazon.com/blogs/machine-learning/market-surveillance-agent-with-langgraph-and-strands-on-agentcore/), [AgentCore overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) (platform vs framework framing for A11)
- LangGraph production checkpointing 2026 — Postgres/Redis checkpointers, recursion limits, idempotent nodes, TTL ([Rapid Claw](https://rapidclaw.dev/blog/deploy-langgraph-production-tutorial-2026), [Gheware](https://devops.gheware.com/blog/posts/langgraph-production-ai-agents-2026.html), [AliceLabs](https://alicelabs.ai/en/insights/langgraph-guide-2026))
- WalkCroach — `agentic-systems.md`, `sdk-platform.md`, `walkcroach-context.md`; verified `run-store.ts` / `036_agent_runs.sql` / `memory-fs.ts`
