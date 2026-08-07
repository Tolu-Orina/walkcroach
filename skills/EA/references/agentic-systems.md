# Agentic Systems Architecture

> The organising fact: **most production AI failures between 2024 and 2026 were architectural, not model-quality problems.** The model worked; the system around it didn't. Treat agent reliability as a systems-design discipline, not a prompt-tuning one.

## Contents
1. Is this actually agentic?
2. Memory architecture
3. Tool design
4. Orchestration topologies
5. Context engineering
6. Guardrails and human-in-the-loop
7. Agent-specific failure modes
8. Evaluation
9. Cost and latency

---

## 1. Is this actually agentic?

A non-agentic LLM interaction produces text; a human decides and acts. A system is **agentic** when the model can perceive external state, choose actions, invoke tools, observe results, and iterate toward a goal without a human in each loop.

**Design the least agentic thing that solves the problem.** The escalation ladder, cheapest and most reliable first:

1. **Single call** — one prompt, one response. Most "AI features" should stop here.
2. **Chained calls** — fixed sequence, deterministic control flow.
3. **Routing** — a classifier picks one of N fixed paths.
4. **Tool-using loop (ReAct)** — model chooses tools dynamically until done.
5. **Plan-and-execute** — plan produced and (ideally) approved, then executed.
6. **Multi-agent** — multiple agents with separate contexts and roles.

Each rung adds capability *and* failure surface. Justify each step up with a failure the rung below cannot handle. Multi-agent in particular should be a last resort: it multiplies context cost, adds coordination failure modes, and is frequently slower than a well-designed single agent.

## 2. Memory architecture

Separate two things practitioners routinely conflate:

- **Memory types** (what is stored): *working* (current context), *episodic* (what happened), *semantic* (facts/knowledge), *procedural* (how to do things).
- **Memory architectures** (how it's stored and retrieved).

Five production patterns, roughly ordered by infrastructure cost. Reported 2026 benchmarks span ~72.9% accuracy at 17.12s p95 down to ~66.9% at 1.44s — **accuracy and latency trade against each other**; there is no free tier of the trade-off.

| Pattern | Mechanism | Fits when |
|---|---|---|
| 1. In-process / working-only | Everything in the context window | Short tasks, no cross-session need |
| 2. Flat external vector store | Single vector DB, top-k semantic retrieval | Simple recall, moderate corpus |
| 3. Tiered memory | Hot/warm/cold, agent-managed | Long sessions, context-window pressure |
| 4. Knowledge graph + vector hybrid | Graph for relational reasoning, vectors for semantic entry | Relationships matter as much as similarity |
| 5. Enterprise context layer | Governed metadata graph as organisational memory | Cross-team, governance and lineage required |

**These are layers, not alternatives.** The common 2026 production combination is working memory + (flat or tiered) experiential memory + an enterprise context layer.

**WalkCroach's position**: pattern 2/3 (C-SPANN vector index over `memory_entries`) plus structured relational state, all in CockroachDB, shared across surfaces. Public access path is `@walkcroach/sdk` → `/v1/memory/*`; first-party surfaces still use bespoke BFF clients that write the same tables. The differentiating property is not retrieval quality alone — it's that memory is **cross-surface and durable**, where competitors' memory dies with the tool or the machine.

**Dual loop (implementation fact):** coding hosts (IDE/CLI/Desktop/sdk-host) run `@walkcroach/agent-engine` locally; Web/Chrome run `@walkcroach/agent-harness` in Lambda. Design memory and tool *semantics* to stay aligned; do not assume a single `runAgentLoop` serves App Builder.

**Design questions to force:**
- What is written, by whom, on what trigger? (Silent writes destroy trust.)
- What is the retrieval query, and is it *scoped* — project, workspace, surface?
- How does a wrong or stale memory get corrected? (`superseded_by`, never delete.)
- Is the memory **visible to the user**? Memory the user can't see contributes nothing to their trust and nothing to retention.
- What's the growth curve, and does retrieval latency hold at 10× today's rows?

## 3. Tool design

Tool quality drives agent reliability more than model choice. Treat a tool definition as an API contract with a non-human, easily-confused consumer.

- **Name and describe for the model, not the developer.** The description is the routing logic. Ambiguity between two tools is the single most common cause of wrong-tool selection.
- **Few, well-scoped tools beat many overlapping ones.** If two tools' descriptions need "use this one when…" disambiguation, consider merging or renaming.
- **Return structured, bounded results.** Unbounded output floods context. Truncate with an explicit marker and a way to fetch more.
- **Make errors instructive.** `"file not found: src/foo.ts — did you mean src/Foo.ts?"` lets the agent recover; `"Error: ENOENT"` does not.
- **Idempotency where possible.** Agents retry. Non-idempotent write tools produce duplicate side effects.
- **Separate read from write in the registry, not just in policy.** WalkCroach coding surfaces do this via modes (`chat` / `plan` / `agent`): read-only modes omit write tools from the registry rather than hoping a guardrail catches them. Stronger than a post-hoc permission check.
- **MCP is the integration standard.** Prefer official vendor MCP servers; audit community servers. WalkCroach ships `@walkcroach/sdk-mcp` over the memory layer and embeds Cockroach MCP in agent-engine — keep those paths coherent.
- **Uniform dispatch beats special cases.** Industry practice (e.g. Claude Code's multi-phase tool pipeline) puts every tool through the same validate → permission → execute path. When adding tools to agent-engine or harness, extend the shared pipeline rather than adding one-off bypasses.
- **Lazy worktree isolation.** Prefer enter-worktree on first write intent over eager isolation for every chat — matches current engine nudges and reduces read-only overhead.

## 4. Orchestration topologies

| Topology | Shape | Strengths | Costs |
|---|---|---|---|
| Single agent + tools | One loop, one context | Simplest, cheapest, most debuggable | Context pressure on long tasks |
| Supervisor / sub-agents | Parent delegates, children return summaries | Isolates exploration noise from the main context | Coordination overhead, summary information loss |
| Sequential pipeline | Fixed stages | Predictable, easy to test | Rigid |
| Parallel fan-out | N independent workers, merged | Wall-clock speed | Merge conflicts; result reconciliation is the hard part |
| Hierarchical | Multi-level delegation | Handles genuinely large scope | Debugging becomes very hard; usually premature |

**Sub-agents earn their keep specifically by returning summaries, not transcripts.** Exploratory work that would otherwise bloat the parent context runs isolated and returns a conclusion. That is the whole benefit — a sub-agent that returns everything it saw is worse than no sub-agent.

**Parallel agent work needs isolation.** The proven mechanism is a git worktree per agent (one branch, one directory), merged back through explicit review. Field experience converges on **~6 concurrent tasks** as the practical ceiling before the human's cognitive switching cost cancels the throughput gain.

## 5. Context engineering

The scarce resource. Three techniques, in order of leverage:

- **Selection** — retrieve narrowly and on demand rather than front-loading. Search/glob first, read only what's needed. This is the single biggest efficiency lever and is architectural, not a prompt trick.
- **Compression** — summarise older turns when approaching the window limit. Some platforms offer server-side compaction; where the model in use doesn't, implement it at the application layer (track cumulative size, generate a summary turn, evict older blocks). Do not defer this on long-running sessions — without it, cost and quality degrade together.
- **Isolation** — sub-agents (above), and separate contexts per concern.

Two further mechanics worth designing for:

- **Prompt caching** — structure the system prompt, project-memory file, and tool definitions as a *stable cacheable prefix*, with only per-turn content appended. This is an ordering discipline in how requests are assembled, not new infrastructure. Check current model support before relying on it.
- **Advertised vs. usable context.** Advertised windows routinely exceed the length at which quality actually holds. **Measure on real workloads before claiming an efficiency win** — never infer it from a vendor comparison.

## 6. Guardrails and human-in-the-loop

Layer controls; don't rely on one.

1. **Registry-level** — the tool isn't offered (strongest).
2. **Input validation** — schema-check tool arguments before execution.
3. **Policy engine** — deterministic rules on what may run (destructive-command patterns, path allowlists, spend caps).
4. **Model-evaluated risk tiering** — auto-proceed on low-risk, escalate uncertain ones. Useful for reducing approval fatigue, but **never the only control on a genuinely destructive action.**
5. **Human approval** — explicit, with the actual diff or command visible.
6. **Post-hoc audit** — structured logs sufficient to reconstruct the decision.

**The tiering rule that matters**: the set of always-escalate actions must be **static and explicit**, not model-judged. Model-evaluated risk is fine for the boundary between "silent" and "notify"; it is not fine as the only thing standing between an agent and dropping a production database.

**Approval fatigue is a real failure mode.** A wall of identical approve prompts trains users to click through. Tier deliberately: silent for reads, batched or auto for low-risk writes, always-explicit for destructive/irreversible/spending actions.

**Prompt injection** is the security model's hardest problem. Content the agent reads (a web page, a file, a ticket) can contain instructions. Mitigations: never grant a tool the agent doesn't need for the task; treat retrieved content as data, not instruction; confirm before acting on instructions that originated in fetched content; keep destructive actions behind human approval regardless of apparent authorisation.

## 7. Agent-specific failure modes

Design against these explicitly; each has a known mitigation.

| Failure | Looks like | Mitigation |
|---|---|---|
| Context exhaustion | Quality degrades mid-session; forgets earlier constraints | Compaction, sub-agent isolation, narrower retrieval |
| Loop / thrash | Same action repeatedly, no progress | Bounded execution: step caps, repeat detection, circuit breaker |
| Tool-parameter hallucination | Invents arguments or tool names | Strict schemas, instructive errors, fewer/clearer tools |
| Wrong-tool selection | Plausible but incorrect tool | Disambiguate descriptions; merge overlapping tools |
| Silent partial failure | Reports success, work incomplete | Verification step in the loop; check results, don't trust claims |
| Cascading multi-agent error | One agent's wrong output poisons others | Validate at boundaries; summaries not transcripts |
| Runaway cost | Unbounded retries/tokens | Spend caps, step caps, pre-authorisation for expensive operations |
| Stale memory | Confidently recalls superseded facts | `superseded_by` provenance; show memory age to the user |
| Non-determinism in tests | Flaky evals | Fixed seeds where available; assert on properties, not exact strings |

## 8. Evaluation

Agentic systems need evaluation designed in, not retrofitted.

- **Trajectory, not just outcome.** A correct answer via a wrong path will fail differently next time.
- **Golden set of representative tasks**, including ones the agent *should decline*.
- **Regression on failure modes** — every production incident becomes a test case.
- **Human review on subjective quality** — don't force assertions onto things needing judgement.
- **Track approve/reject ratio** as a live signal: a rising rejection rate means proposals are drifting from intent, independent of task-completion metrics.

## 9. Cost and latency

- **Model routing**: use the cheapest model that holds quality for each step. Classification and routing rarely need the frontier model doing the reasoning.
- **Async for anything slow.** Long generations (video, large builds) belong in a job with a status row and a polled or pushed result — never a blocked request.
- **Per-unit economics differ by orders of magnitude** across text, image, and video generation. Meter them at weights reflecting real cost, and pre-authorise expensive operations before running them.
- **Cache aggressively** at the prefix level, and semantically where repeated similar queries are common.
- **Attribute cost per tenant/feature from day one.** Retrofitting cost attribution onto a shared multi-tenant agent platform is materially harder than designing it in.