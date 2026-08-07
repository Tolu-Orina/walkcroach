# Agentic frameworks landscape — implications for `@walkcroach/agent`

**Status:** Research note (Aug 2026) — pre–Phase 6 gate  
**Audience:** Platform / SDK owners deciding reuse vs build  
**Scope:** LangChain, LangGraph, LangSmith, Strands Agents, AWS Loom, Bedrock AgentCore, Claude Agent SDK, OpenAI Agents SDK, CrewAI, Microsoft Agent Framework, Google ADK, Mastra, Vercel AI SDK, LlamaIndex, related protocols (MCP, A2A)

This note is **not** a Phase 6 build plan. It answers: *what should WalkCroach steal, wrap, or deliberately not adopt* before any public agent package ships.

---

## 1. Executive verdict

The market has split into **four layers**, not competing “agent packages”:

| Layer | Examples | Job |
|---|---|---|
| **Runtime / loop** | Strands, Claude Agent SDK, OpenAI Agents SDK, WalkCroach engine/harness | Model → tools → observe until stop |
| **Orchestration** | LangGraph, Strands Graph/Swarm/Workflow, CrewAI Flows, Mastra workflows | Deterministic or semi-deterministic control flow, HITL, multi-agent |
| **Platform / ops** | LangSmith, AgentCore Observability, Loom, CloudWatch OTEL | Trace, eval, govern, cost, registry |
| **Hosting / isolation** | AgentCore Runtime, E2B, WalkCroach sdk-host sandbox | Session microVM / sandbox, identity, long-running jobs |

**WalkCroach already owns a credible Runtime layer** (dual loops) plus a **memory platform** (`@walkcroach/sdk`) that most frameworks treat as a bolt-on. Phase 6 should **not** reimplement LangGraph or adopt Loom as a dependency. It should **productize a thin, sandboxed programmatic surface** and **selectively adopt ideas** (and a few libraries) at the ops and protocol edges.

### Hard recommendation (summary)

| Decision | Choice | Why |
|---|---|---|
| Public agent loop | **Own** (thin wrapper over sdk-host / engine subset) | Moat is memory + coding HostAdapter discipline; dumping engine or wrapping LangGraph dilutes that |
| Graph orchestration for customers | **Defer / optional adapter** | Most P6 demand is sandbox coding runs, not customer-authored StateGraphs |
| Observability | **Adopt OTEL + LangSmith-compatible / CloudWatch** patterns; don’t rebuild LangSmith | Industry standard; WalkCroach already has TelemetrySink naming |
| Evals | **Own thin harness**; optionally wire `agentevals` / OpenEvals ideas | We already have security + golden evals internally |
| Multi-agent | **Keep bounded subagents**; don’t ship CrewAI/Swarm metaphors | Engine already has depth-limited spawn; public multi-agent is a support sink |
| Hosting | **Keep E2B + own sandbox**; study AgentCore Isolation ideas | Don’t force AWS AgentCore as runtime for non-AWS customers |
| Governance platform | **Study Loom; don’t fork** | Loom is a reference *control plane* for AWS shops — pattern source, not dependency |
| Protocols | **MCP first-class; A2A watch** | We already ship sdk-mcp; A2A matters if enterprise discovery becomes a sales requirement |

---

## 2. Stack map (who does what)

```text
                    ┌─────────────────────────────────────────┐
                    │  Platform / DX (LangSmith, Loom UI,     │
                    │  Agent Registry, WalkCroach Developer)  │
                    └─────────────────┬───────────────────────┘
                                      │ traces / registry / billing
┌─────────────────────┐   ┌───────────▼───────────┐   ┌────────────────────┐
│ Orchestration       │──▶│ Runtime / Agent loop  │──▶│ Tools / MCP / Host │
│ LangGraph, Swarm,   │   │ Strands, Claude SDK,  │   │ FS, shell, APIs    │
│ CrewAI, Workflows   │   │ WC engine + harness   │   │ Gateway, E2B       │
└─────────────────────┘   └───────────┬───────────┘   └────────────────────┘
                                      │
                          ┌───────────▼───────────┐
                          │ Memory                │
                          │ AgentCore Memory,     │
                          │ LangGraph Store,      │
                          │ **WalkCroach /v1**    │
                          └───────────────────────┘
```

WalkCroach’s unusual position: **memory is the public product**; agent loops are **private dual implementations**. Competitors often ship the opposite (public loop, weak memory).

---

## 3. Deep dives by system

### 3.1 LangChain (framework) vs LangGraph (runtime) vs Deep Agents (harness)

LangChain Inc now documents three layers explicitly:

1. **LangGraph** — low-level graph runtime (Pregel-inspired): nodes, edges, shared state, checkpointers, interrupts.
2. **LangChain** — integrations + minimal `create_agent` harness (often runs *on* LangGraph).
3. **Deep Agents** — opinionated long-horizon harness (planning, summarization, subagents, filesystem habits).

**Internals that matter:**

- **State is first-class.** Schema + reducers; every node reads/writes; routing is conditional on state.
- **Checkpoints per super-step** keyed by `thread_id`. Enables pause/resume, time-travel, HITL.
- **`interrupt()`** suspends a node; resume injects human value back into the call site. Side effects must be idempotent on replay.
- **Durability modes** (`exit` / `async` / `sync`) trade crash safety vs latency — checkpoints alone are *not* Temporal-style durable execution (no watchdog, no distributed lease by default; see industry critiques).
- **Two APIs:** Graph API (declarative topology) vs Functional API (procedural + same runtime).

**WalkCroach parallels:**

| LangGraph concept | Closest WalkCroach analog |
|---|---|
| Super-step checkpoint | Engine `.walkcroach/checkpoints/<turnId>.jsonl` + harness session rows |
| `interrupt()` HITL | Engine approval promises; harness `awaiting_tool` / plan-decision resume |
| `thread_id` | Session / run IDs in run-store |
| Store (cross-thread memory) | `@walkcroach/sdk` memory API — **stronger public product** |
| Graph topology | Mostly **absent** — loops are model-driven ReAct, not customer graphs |

**Reuse vs build:**

- **Do not** make LangGraph the public `@walkcroach/agent` core (Python-first culture, different event model, would orphan TypeScript surfaces).
- **Do** steal the *API shapes*: explicit `threadId`, documented interrupt/resume, durability modes on content/agent runs.
- **Optional later:** LangGraph.js adapter that calls WalkCroach tools/memory as nodes — for customers who already live in LangGraph, not as our default DX.

---

### 3.2 LangSmith (observability + evals)

Primitives: **run → trace → thread**.

- Offline evals on datasets; online evals on sampled production traffic.
- Trajectory evals (tool-call sequences), LLM-as-judge, code judges.
- Framework-agnostic via OTEL / SDKs; tightest with LangChain/LangGraph.
- Production traces become the eval corpus (“bug → dataset → regression”).

**WalkCroach today:** in-process `TelemetrySink` + CloudWatch Memory alarms + internal vitest evals. No customer-facing trace UI for agent runs.

**Reuse vs build:**

| Piece | Recommendation |
|---|---|
| Trace hierarchy (run/trace/thread) | **Adopt conceptually** in TelemetrySink + Developer Ops |
| Hosted LangSmith as dependency | **Optional customer export**; don’t require it |
| OTEL export | **Build** (AgentCore and Strands already standardize here) |
| Trajectory eval package | **Own thin suite**; borrow ideas from `agentevals` / OpenEvals, not a product dependency |
| Annotation queues | Defer until external agent volume exists |

---

### 3.3 Strands Agents SDK (AWS open source)

Model-driven **agent loop** as the foundational primitive: reason → select tool → execute → feed result → repeat until stop.

**Notable internals:**

- Explicit stop reasons, cancellation (external + in-tool), invocation limits.
- Concurrent invocation policies (dedupe vs allow).
- Session managers: file / repository / S3.
- MCP first-class (`mcp_client`, instrumentation).
- Multi-agent: **Graph** (developer edges + LLM path choice), **Swarm** (autonomous handoffs), **Workflow** (deterministic DAG, no cycles).
- Shared `invocation_state` across Graph/Swarm.
- Hooks + steering + Agent Control (Galileo) for runtime deny/steer without rewriting agent code.
- A2A client support.

**WalkCroach parallels:** engine `runAgentLoop` and harness `runPromptTurn` are the same *shape* as Strands’ loop. Approvals ≈ hooks. Bounded `spawn_subagent` ≈ limited Swarm. sdk-host ≈ constrained loop with policy.

**Reuse vs build:**

- Strands is **Python-first** (TS exists); WalkCroach agent surfaces are **TypeScript**. Adopting Strands as the loop would fracture the monorepo.
- **Steal:** stop-reason taxonomy, concurrent-invocation rules, hook/plugin surface for policy, Graph vs Swarm vs Workflow *vocabulary* in docs (even if we only implement one).
- **Integrate, don’t embed:** customers on AWS can run Strands agents that call WalkCroach memory via MCP (`@walkcroach/sdk-mcp`) — that strengthens the memory moat without owning their loop.

---

### 3.4 AWS Loom + Bedrock AgentCore

**AgentCore** (GA Oct 2025) is the managed agent *infrastructure* portfolio:

| Service | Role |
|---|---|
| **Runtime** | Serverless agent hosting; **per-session microVM** isolation; long windows (~8h); MCP/A2A; identity baked in |
| **Memory** | Short-term session + long-term extraction/consolidation (self-managed strategy available) |
| **Gateway** | APIs/Lambda/MCP → secure tool endpoint; IAM + OAuth |
| **Identity** | Agent identities, token vault, OBO / RFC 8693 exchange |
| **Observability** | CloudWatch dashboards + OTEL → Dynatrace/Datadog/LangSmith/Langfuse |

**Loom** (AWS Labs, Jul 2026) is an **opinionated control plane** on top of Strands + AgentCore — not a managed SaaS:

- Catalog UI for agents, memory, MCP, A2A.
- Config-driven deploy (**no runtime codegen** — pre-written agent + injected config).
- Tag profiles for cost/governance.
- RBAC/ABAC (role × group tags).
- Agent Registry review before publish.
- HITL via Strands hooks + MCP elicitations.
- Secrets stay in Secrets Manager.

**WalkCroach parallels:**

| Loom / AgentCore | WalkCroach |
|---|---|
| Control plane UI | Developer portal + Ops |
| Agent Registry | API keys + scopes (weaker discovery story) |
| Config-not-codegen deploy | Content run profiles / sdk-host policy |
| Session microVM | E2B + SandboxHostAdapter (weaker formal isolation claims) |
| AgentCore Memory | **Our differentiator** — don’t outsource the moat |
| Identity OBO chains | Cognito + API keys today; OBO is a gap for enterprise connectors |
| Tag/cost attribution | Stripe meters + ledger (P5.2) — good start |

**Reuse vs build:**

- **Do not** rebuild Loom. Study its seven challenge patterns as a **checklist** for Developer portal maturity.
- **Do not** replace WalkCroach memory with AgentCore Memory for the public product.
- **Consider** AgentCore Runtime as an *optional* deploy target for AWS-enterprise customers running *their* agents that talk to our memory — partner posture, not core runtime.
- **Steal:** config-driven agent blueprints; registry + approval-before-publish; RFC 8693-style identity propagation for connector chains; microVM session hygiene language for marketing/security reviews.

---

### 3.5 Claude Agent SDK (harness) vs OpenAI Agents SDK (orchestration)

**Claude Agent SDK** = programmable Claude Code:

- Built-in tools (Read/Write/Edit/Bash/Glob/Grep/Web…).
- MCP as native tool substrate.
- Lifecycle hooks; permission modes; context compaction.
- Subagents as isolated contexts via Agent tool.
- Anthropic-model lock-in; weak native durable exec / observability.

**OpenAI Agents SDK** = lightweight multi-agent library:

- Agents + **handoffs** + **guardrails** (input/output/tool tiers) + sessions.
- Provider-agnostic via Responses API.
- Built-in tracing; sandbox improvements (2026).

**WalkCroach engine** is philosophically closer to **Claude Agent SDK** (HostAdapter computer + approvals + MCP + subagents). Harness is closer to a **cloud ReAct product** with plan approval.

**Reuse vs build:**

- Do **not** wrap Claude Agent SDK as `@walkcroach/agent` (model lock-in, fights BYOK/Bedrock story).
- **Steal from Claude:** context compaction policy, permission_mode vocabulary, hook points around tool calls, subagent isolation rules.
- **Steal from OpenAI:** three-tier guardrails naming, typed handoff metadata if we ever expose multi-agent publicly, clean Session primitive in the public API.

---

### 3.6 CrewAI, Microsoft Agent Framework, Google ADK

| Framework | Metaphor | Take for WalkCroach |
|---|---|---|
| **CrewAI** | Role/goal/backstory teams; sequential/hierarchical/consensual; Flows | Great for demos; **poor fit** as public API — role fiction ≠ our coding HostAdapter. Don’t adopt. |
| **Microsoft Agent Framework** (AutoGen + Semantic Kernel) | Enterprise HITL, Azure/.NET, OWASP agentic | Steal HITL/governance checklists if selling to enterprises; no code reuse. |
| **Google ADK** | Hierarchical agents + **native A2A** | Watch A2A; implement agent cards only if registry/discovery becomes a sales gate. |

---

### 3.7 TypeScript ecosystem: Mastra, Vercel AI SDK, LlamaIndex

| Tool | Fit |
|---|---|
| **Vercel AI SDK** | Excellent **streaming/UI substrate** for web chat; not a durable coding agent. Could power portal chat UX; not P6 core. |
| **Mastra** | Batteries-included TS agents/workflows/evals/studio. Competing product shape — **don’t depend**. Steal Studio/playground DX ideas for Developer portal. |
| **LlamaIndex** | Best for corpus RAG. WalkCroach memory is project/episodic, not doc-index-first — optional connector, not core. |

---

## 4. Capability matrix (selected systems × WalkCroach)

Legend: ● strong / native · ◐ partial · ○ weak or absent · ◆ WalkCroach owns as product

| Capability | LangGraph | Strands | Claude SDK | OpenAI SDK | AgentCore+Loom | WalkCroach today |
|---|---|---|---|---|---|---|
| Model-driven tool loop | ◐ | ● | ● | ● | ● (via Strands) | ● (engine+harness) |
| Explicit graph DAG | ● | ● (Graph/Workflow) | ○ | ◐ handoffs | ◐ | ○ |
| Durable pause/resume | ● checkpoints | ◐ sessions | ○ | ◐ | ● Runtime | ◐ harness / run-store |
| HITL approvals | ● interrupt | ● hooks/MCP | ● permissions | ● guardrails | ● Loom | ● dual |
| Session isolation | ◐ app-level | ◐ | ◐ | ◐ sandbox | ● microVM | ◐ E2B + sdk-host |
| Long-term memory product | ◐ Store | ◐ plugins | ○ | ○ | ● AgentCore Mem | ◆ **/v1 memory** |
| MCP | ◐ | ● | ● | ◐ | ● Gateway | ● sdk-mcp + loops |
| A2A | ◐ | ● | ○ | ○ | ● Registry | ○ |
| Observability product | ◆ LangSmith | OTEL | ○ | tracing | ◆ CloudWatch | ◐ TelemetrySink |
| Coding HostAdapter (FS/PTY/worktree) | ○ | ◐ tools | ● | ○ | ○ | ● **engine** |
| Multi-tenant SaaS harness | ○ | ○ | ○ | ○ | Loom control plane | ● **harness** |
| Public npm agent package | ● | ● | ● | ● | N/A | ○ (P6 gated) |

---

## 5. Idea → WalkCroach action catalog

### 5.1 Create / own (aligns with moat)

1. **`@walkcroach/agent` thin surface** — only when P6 trigger fires: sandbox HostAdapter subset, `WriteScope`, event stream, `agent:run` scope. Not engine dump.
2. **Public interrupt/resume contract** for programmatic runs (borrow LangGraph vocabulary; implement on run-store).
3. **OTEL + run/trace/thread documentation** — export to CloudWatch / optional LangSmith.
4. **Trajectory + security eval suite** published as `@walkcroach/agent-evals` *or* docs-only fixtures (keep engine private).
5. **Memory-as-tool** remains first-class (already) — document as the differentiator vs AgentCore Memory / LangGraph Store.
6. **Identity propagation** for connector chains (Loom/AgentCore Identity lesson) when enterprise connectors expand.

### 5.2 Reuse / integrate (don’t reinvent)

| External | How to use |
|---|---|
| **MCP** | Already; keep as the tool interoperability layer |
| **OTEL** | Standard export; AgentCore-compatible |
| **LangSmith / Langfuse / Phoenix** | Optional sinks for customers who already pay for them |
| **E2B** | Keep for harness isolation; document isolation claims honestly vs AgentCore microVMs |
| **OpenEvals / agentevals patterns** | Copy test ideas; optional peer dep for advanced users |
| **A2A agent cards** | Spec compliance only if registry becomes required |

### 5.3 Study but do not depend

- LangGraph / LangGraph.js as *core*
- Strands as *core* loop
- Loom fork
- CrewAI / AutoGen metaphors
- Claude Agent SDK as product shell
- AgentCore Memory as WalkCroach memory backend

### 5.4 Explicit non-goals (reinforced by research)

- Merging harness ↔ engine to “be like LangGraph one graph.”
- Publishing full HostAdapter power without sandbox + abuse controls.
- Competing with LangSmith as a general LLM observability SaaS.
- Building a greenfield Loom-class control plane before P6 demand exists.

---

## 6. Suggested architecture for a future `@walkcroach/agent` (if triggered)

```text
Customer app
    │
    ▼
@walkcroach/agent          ← thin, versioned, sandbox-only
    │  run({ prompt, writeScope, threadId, hooks? })
    │  events / result / interrupt?
    ▼
sdk-host patterns          ← SandboxHostAdapter + policy
    │
    ├──▶ agent-engine (private)   local coding loop
    └──▶ OR /v1 content:run       hosted path via @walkcroach/sdk

Side channels (optional):
    MCP ──▶ @walkcroach/sdk-mcp ──▶ memory /v1
    OTEL ──▶ customer collector / LangSmith
```

**Public API must feel like:** OpenAI Agents SDK simplicity + Claude-style computer constraints + LangGraph interrupt clarity — **without** importing those codebases.

---

## 7. Decision checklist before starting P6

- [ ] P6 trigger met (≥3 HostAdapter consumers **or** App Builder SLA need)?
- [x] Interrupt/resume + threadId designed for sandbox runs? *(Pre-P6)*
- [x] OTEL export path defined (even if UI is later)? *(Pre-P6)*
- [ ] Abuse: timeouts, write scopes, no stdio MCP, credit/`agent:run` metering? *(partial — content scopes exist; `agent:run` awaits P6)*
- [x] Docs position memory SDK as primary; agent package as optional coding runner?
- [x] Explicit “we are not LangGraph/CrewAI/Loom” positioning written?

If the P6 trigger is unmet, **do not ship P6** — keep selling `@walkcroach/sdk` + mcp. Pre-P6 platform hardening may proceed independently.

---

## 8. Primary sources

- LangChain layers: [Deep Agents vs LangChain vs LangGraph](https://www.langchain.com/blog/deep-agents-vs-langchain-vs-langgraph)
- LangGraph: [checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers), [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), [choosing APIs](https://docs.langchain.com/oss/python/langgraph/choosing-apis)
- LangSmith: [observability concepts](https://docs.langchain.com/langsmith/observability-concepts)
- Strands: [agent loop](https://strandsagents.com/docs/user-guide/concepts/agents/agent-loop/), [multi-agent patterns](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/), [Agent Control](https://strandsagents.com/blog/strands-agents-with-agent-control/)
- Loom: [AWS Open Source blog](https://aws.amazon.com/blogs/opensource/building-secure-ai-agents-at-scale-introducing-loom-for-aws/), [awslabs/loom](https://github.com/awslabs/loom/)
- AgentCore: [what is AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html), [GA announcement](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available/)
- Comparative surveys (May–Jul 2026): DeepResearch Ninja framework analysis; LangChain “best frameworks” resource; Claude vs OpenAI Agents SDK essays

---

## 9. Changelog

| Date | Note |
|---|---|
| 2026-08-07 | Initial deep research for pre–Phase 6 decision |
