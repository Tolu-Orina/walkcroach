# Agentic patterns → WalkCroach upgrades, v2
## Deep-dive on bounded executor, deterministic critic, native multi-agent router, and durable workflow — extending the Aug 2026 synthesis

**Research basis:** one full production-system technical paper (OpenDev, arXiv:2603.05344 — the most detailed public technical account found of a production coding-agent harness, comparable in shape to agent-engine); the current AWS Strands Agents documentation and its production-deployment pattern with LangGraph on Bedrock AgentCore; four independent 2026 sources on deterministic-vs-judge output validation; and general agent-reliability engineering literature. Where a finding **confirms** the original synthesis, it's marked ✅. Where it **sharpens or corrects** it, marked ⚠️.

---

## 0. Headline finding first

Your synthesis is directionally right — soft-patterned ReAct today, bounded patterns next, SDK stays platform-not-framework — and one specific piece of it should change before you build: **§1's plan-mode recommendation ("map to `mode:plan` then act") is the exact design OpenDev tried first and replaced, for a documented, specific reason.** Their original plan mode was a four-tool state machine (`enter_plan_mode`/`exit_plan_mode`/`create_plan`/`edit_plan`) — structurally very close to a `mode:plan` toggle — and it was "brittle: the agent sometimes failed to exit plan mode, leaving the system stuck in a read-only state requiring manual intervention." They replaced it with **planning-as-subagent**: a `Planner` subagent spawned with a schema containing *only* read-only tools, so it cannot write because write tools don't exist in its schema — not because a runtime check blocks the attempt. This closes exactly the class of bug a mode-toggle is prone to, and it's cheap: no new state machine, reuses whatever subagent infrastructure P1 already plans to build. Recommend folding this into the P0 planning item directly, not deferring it to P1.

---

## 1. Bounded executor pattern — a concrete reference implementation exists, and it beats what's specced

Your doc's plan: *"Formal thrash detector: hash (tool,args) streaks → circuit break / ask_user / strategy switch; persist streak on durable runs."* Directionally correct — but a real system has already shipped a more complete version of exactly this, with parameters tuned against observed failures rather than guessed.

**OpenDev's doom-loop detector, verbatim mechanism:**
- Fingerprint every tool call as `MD5(tool_name, args)`.
- Track fingerprints in a sliding window of the **20 most recent calls**.
- If any fingerprint recurs **3 or more times**, do *not* execute the tool — instead inject a `[SYSTEM WARNING]` and skip execution for that turn.
- If the *same* fingerprint recurs after the warning, escalate to an **approval-based pause**: "Agent is repeating the same action. Allow / Break?"
- On Allow: resume with a **one-shot guard** that permits the action once before re-arming detection (prevents the guard from immediately re-triggering on the very action the user just approved).
- On Break: inject a guidance message and reset the loop.

**Why two-tier, not one:** their own stated reasoning — "LLMs can ignore injected text, but they cannot bypass a genuine execution halt." A warning-only approach (what a lot of teams ship first) is soft; this is soft-then-hard. ⚠️ **Sharpens your spec**: your doc says "circuit break / ask_user / strategy switch" as three options — the evidence favors doing warning-then-halt *in sequence* on the same fingerprint, not choosing one strategy upfront.

**A second, independent primitive worth adopting alongside it — the bounded-nudge budget for non-loop failures.** Separately from doom-loop detection, OpenDev caps *error-recovery* retries at **3 consecutive attempts per error sequence**, with the recovery message tailored to the classified error type (6 categories: permission, not-found, edit-mismatch, syntax, rate-limit, timeout) rather than a generic "try again." This is a distinct failure mode from thrash (a *changing* but consistently-failing action, not a repeated identical one) and your current spec doesn't appear to separately bound it. Recommend adding it as the same P0 item's second half.

**Third finding, unprompted but load-bearing: stale-read protection is part of the same "bounded executor" family, and it's cheap.** Before any edit, OpenDev asserts the file's mtime hasn't moved since the agent's last read (with a 50ms tolerance for filesystem timestamp granularity). A failed assertion rejects the edit and tells the agent to re-read. This is a one-property check that prevents an entire class of silent-overwrite bugs — worth checking whether agent-engine's `writeScope` already does this, and adding it if not; it's a natural companion to the thrash detector since both are "don't let the agent act on stale state" primitives.

**Concrete numbers worth citing when you pitch this internally:** OpenDev measures typical session length extending from **15–20 turns to 30–40 turns before context overflow** once tool-result summarization + offloading is added (a related but distinct context-engineering win, §4 below) — a useful proof point that these aren't just safety features, they're throughput features.

**Fitness function, sharpened from your doc's #1** ("Identical failing tool call ≥3× → circuit break"): make it **identical *any* tool call ≥3× in the last 20**, not only failing ones — OpenDev's version fires on repetition regardless of success/failure, because a *successful* identical call repeated three times is just as strong a loop signal as a failing one (e.g., re-reading a file that hasn't changed, in a genuine reasoning loop rather than an error-retry loop).

---

## 2. Deterministic critic interface — the industry has converged on a 3-layer cascade, and there's a $40K cautionary tale for skipping the floor

Your doc: *"First-class CriticGate after produce: schema + heuristic + optional critic model; fail → revise branch (bounded), not poison next turns."* ✅ Your ordering (schema/heuristic first, model optional/additional) is already the pattern the industry converged on independently — worth knowing that's not a compromise, it's the state of the art.

**The converged architecture, consistent across four independent 2026 sources:**

| Layer | What | Cost | Coverage |
|---|---|---|---|
| 1. Deterministic pre-emission checks | Schema validation, tool-call format, output length bounds, required/prohibited fields, JSON parse, regex/citation-validity | Near-zero | 100% of outputs |
| 2. Lightweight fine-tuned judge | A small distilled model (Galileo Luna-2 3B/8B is the 2026 reference example: 0.88–0.95 accuracy, sub-200ms, ~97% cheaper than a frontier-model judge) | Low | Gated — only cases the floor didn't resolve |
| 3. LLM-as-judge (frontier model) | Full reasoning-capable judge, used for genuinely subjective/hard cases | High | Narrow — the cascade's top, not its default |

**The critical, sourced discipline: gate expensive layers on the floor, don't run all three on everything.** One source frames this precisely: *"the interesting engineering is the cascade: gating the judge on the floor so the expensive layer only runs on the cases that need it."*

**The cautionary tale, worth repeating verbatim internally because it's exactly the failure mode a soft-only critic risks:** a team built LLM-as-judge-first continuous evaluation, and the first month's judge bill hit **$40,000** — while the judge *missed* a real production bug: a refund agent quoting amounts off by an order of magnitude because a tool-call JSON schema had silently drifted three releases earlier. The judge "read the prose around the broken field and gave it a 0.89 helpfulness score." A deterministic schema check would have caught it for the cost of `pytest`. **This is the single strongest argument for your existing P0-for-content ordering being correct as specced** — it's worth citing this exact anecdote when defending "schema + heuristic first" against any pressure to lead with a model-based critic for speed of implementation.

**⚠️ One real correction to add: evaluation vs. enforcement are not the same thing, and most off-the-shelf tooling only gives you the first.** A recurring, explicit distinction across sources: *"Evaluation measures whether an output meets quality criteria. Enforcement decides what to do based on that measurement, within the agent's execution flow. Evaluation without enforcement is monitoring."* Commercial observability platforms (LangSmith, Arize, Helicone, Braintrust) are explicitly named as **evaluation-only** — they score and log, they don't sit in the execution path and redirect it. If any part of the CriticGate build is tempted to reach for one of these as "the critic," it needs an explicit enforcement layer wrapped around it (block/revise/interrupt), or it's a dashboard, not a gate. Recommend stating this explicitly in the P0-for-content spec so it isn't assumed to come for free from whatever tracing tool is already in place.

**One more number worth having on hand:** a 2026 benchmark across 37 models found hallucination rates of **15–52%** depending on task domain. That's the base rate the CriticGate is defending against — useful context for sizing how much the gate actually needs to catch versus assuming clean model output as the default case.

---

## 3. Native multi-agent router — Strands' own taxonomy is sharper than "graph/swarm/workflow," and there's a specific hybrid pattern AWS is shipping in production that fits your stack directly

Your doc already correctly identifies Strands' three-way split. Worth being more precise about the actual decision axis, and about one production pattern that maps almost exactly onto what you're already planning for `content.publish`.

**The real decision axis, per Strands' own docs, stated as directly as this:** *"the most difference you should consider among those patterns is how the path of execution is determined"* — specifically, **who decides the next step**: your code (deterministic), a central agent (LLM-routed), or the peers themselves (autonomous handoff). Five primitives, not three, once you include the two Strands treats as foundational:

| Pattern | Who decides next step | Shape | Fits |
|---|---|---|---|
| Agents-as-tools | Your code (one agent calls another as a tool) | Hierarchy | Specialist delegation — closest to what `spawn_subagent` already is |
| Graph | Deterministic, by edge structure (can include conditional edges) | DAG or cyclic | Repeatable pipelines with known structure — **this is `content.publish`'s plan→draft→critique→revise shape** |
| Swarm | The agents themselves, via handoff | Dynamic mesh | Open-ended collaborative problem-solving — genuinely higher-risk, higher-variance |
| Workflow | Pre-defined DAG (a *tool*, not a native SDK orchestrator, in Strands specifically — implemented via `strands-agents-tools`, task-dependency-based) | Fixed stages | Task pipelines with parallel execution and explicit dependencies |
| Nesting | — | A Swarm can be a single node inside a Graph | Composing a team into a stage of a larger pipeline |

⚠️ **This sharpens your document's own framing.** Document 28 says *"Strands splits orchestration as Graph (explicit edges), Swarm (dynamic handoffs), Workflow (fixed stages)"* — accurate, but the more useful cut for your actual decision is that **your `content.publish` pipeline (Fence → Plan → Draft → Critique → Revise → Remember) is textbook Graph shape**, not Workflow: it has a cyclic edge (Critique fail → Revise → Critique again, bounded), which Graph explicitly supports and Workflow (a fixed DAG) does not. Recommend naming it a Graph-shaped pipeline internally even if you don't adopt Strands itself — it clarifies that the Critique→Revise loop is a *cycle in the graph*, not a special case bolted onto a linear pipeline, which changes how you'd design the state machine (a revisit edge back to an earlier node, not a separate retry wrapper around the whole thing).

**The production hybrid pattern most directly relevant to your stack:** AWS's own reference architecture for exactly this class of problem combines **LangGraph for macro-level workflow orchestration** (state machine, conditional routing, durable checkpointing) with **Strands (or an equivalent reasoning loop) for node-level agent reasoning**, deployed on **Bedrock AgentCore**. The explicit division: *"LangGraph excels at managing state and directed graphs for multi-agent coordination... checkpoint-based recovery from failures... Strands Agent serves as the reasoning engine within individual workflow nodes."* Given you're already on Bedrock/Nova, this is not a foreign pattern to adopt wholesale — it's closely analogous to what your own doc already proposes (*"Implement as harness/sdk-host Workflow over engine roles"*), just with a named, validated precedent and one added capability worth taking directly: **checkpoint-based recovery, not restart-from-scratch on resume.**

---

## 4. Durable execution — this is the gap your own grade table flags most clearly, and it has a specific, well-known fix

Your grade table: *"Durable graph state | LangGraph checkpointer | agent_runs interrupt for ask_user; resume restarts publish | Partial HITL."* You already correctly diagnosed this as the weakest cell. The fix pattern is well-established and doesn't require adopting LangGraph itself:

**The property that matters is *mid-workflow checkpointing*, not full-restart-with-replay.** A "long, multi-step process where losing progress is expensive — a data pipeline, a multi-stage research task, an approval workflow" is explicitly named as the case where checkpointing "earns its complexity," contrasted with a simple multi-turn conversation where it doesn't. `content.publish` is unambiguously the former case (per your own doc: Fence → Plan → Draft → Critique → Revise → Remember, with a human-interrupt point for plan approval).

**What "checkpoint-based recovery" concretely requires, distilled from the production pattern:**
1. Each stage transition writes a durable checkpoint (stage name, accumulated state, timestamp) — not just an interrupt flag.
2. Resume reads the last checkpoint and continues **from that stage**, not from the top of `runAgentLoop`.
3. The state object carried between stages is typed (matches your own "typed run kinds" direction for the SDK) rather than an opaque blob — this is what makes stage-level resume tractable instead of requiring full-transcript replay.

This is directly buildable on `agent_runs` without adopting LangGraph as a dependency: it's a schema and a resume-dispatch discipline, not a new framework. Recommend making this an explicit, named P0 sub-item under the `content.publish` Workflow build rather than leaving it implicit in "durable mid-workflow checkpoint (not full restart on resume)" — it's currently listed second in your roadmap sequencing; given it's the clearest gap in the grade table, consider pulling it into the same P0 slice as the Workflow itself rather than sequencing it after.

---

## 5. Two things not in the original synthesis at all, worth flagging even though they weren't asked for

**Cross-session learned memory of *strategies*, not just facts.** OpenDev's ACE ("Agentic Context Engineering") pipeline maintains a **playbook** — natural-language bullets tagged helpful/harmful/neutral, scored by effectiveness + recency + semantic similarity to the current query, injected into the system prompt. A `Reflector` analyzes outcomes every 5 messages; a `Curator` turns that analysis into playbook mutations. This is distinct from what your `memory` product already does (CockroachDB cross-surface *fact* memory, correctly graded "Strong" and called your moat) — this is memory of *what approach worked*, not *what happened*. Given `content.publish`'s "Remember: house-style conventions to memory" step already gestures at this, it may be worth scoping whether that step should be this specific pattern (a scored, mutable playbook) rather than a flat append — but this is a genuine scope question, not a recommendation to build it now; flagging it as a considered-and-deferred item is enough for this pass.

**Prompt caching structure, mechanically.** For providers supporting cache_control (Anthropic-shaped APIs; verify current Nova support per your own architecture docs' existing caveat on this), the referenced system splits the assembled system prompt into a **stable, cacheable part** (base instructions, tool descriptions, safety policy — typically 80–90% of total) and a **dynamic part** (environment metadata, session-specific context), with only the stable part cache-annotated. Reported result: ~88% input-token cost reduction on the cached portion over a multi-turn session. This is a pure engineering-ordering change (how the Converse-style call is assembled), not new infrastructure — likely folds cleanly into the existing P1 "context management" line rather than needing its own slot.

---

## 6. Revised priority table (delta from your original)

| Item | Your original priority | This research | Change |
|---|---|---|---|
| Thrash/doom-loop detector | P0 | P0, **with a fully specified reference implementation** (fingerprint+window+two-tier escalation+one-shot guard) available to copy the shape of, plus the added "any repeat, not just failures" correction | Sharpened, not moved |
| Planning vs execution | P0 for content | P0, **with a specific architecture correction**: planner-as-subagent (schema-restricted), not a `mode:plan` state toggle | **Corrected** |
| Error-recovery nudge budget | Not separately listed | New: bound consecutive-failure retries (3) separately from thrash detection, with classified recovery messages | **New P0 sub-item** |
| Stale-read protection | Not separately listed | New: mtime-assertion before edit, cheap, closes a silent-overwrite class of bug | **New, cheap, P0-adjacent** |
| CriticGate | P0 for content.publish | P0, **confirmed as correctly ordered**, plus an explicit enforcement-vs-evaluation distinction to state in the spec | Confirmed + one addition |
| content.publish as Workflow | Roadmap step 1 | Confirmed as the right shape, but **it's a Graph (has a cycle: Critique→Revise), not a fixed-DAG Workflow** — naming/modeling distinction | Reframed |
| Durable mid-workflow checkpoint | Roadmap step 2 | Recommend **pulling into step 1** — it's the clearest gap in your own grade table | **Resequenced** |
| Cross-session strategy memory (playbook) | Not present | Noted as a real, distinct pattern worth a future scoping pass | **New, deferred** |
| Prompt-cache-aware prompt assembly | Not present | Likely folds into existing P1 context-management line | **New, low-effort addition to existing item** |

---

## Decision / Ask

**Quality is the sole ranking attribute** for the implementation plan that follows from this research. Approve Graph-first for `content.publish` + patterned loop in engine + **public Run Graph DSL (A11, platform nodes)** — **plus**: schema-restricted Planner (not mode toggle); durable mid-workflow checkpointing co-built with Graph; thrash + nudge + stale-read (capability-gated); **A9** internal Graph; **A10** always Planner on publish. BYO-tools public Graph remains rejected.

If approved, the next build slice is: (1) internal Graph + CRDB checkpoints, (2) publish on that Graph with always-Planner, (3) SDK progress/result, (4) public Run Graph DSL over the closed node catalog. See §7 A9–A11.

---

## 7. Architecture-review amendments (grounded) — superseding notes for implementers

Binding detail lives in `agentic-pattern-upgrade-implementation-plan.md` (**quality-first re-amend**). **Quality is the sole ranking attribute** — calendar and token cost do not win trade-offs against outcome quality.

### 7.1 In force

| # | Amendment | Research / primary grounding | Platform fact that forces it |
|---|---|---|---|
| A1 | SDK/`content.publish` **auto-approves** Plan by default; `present_plan` HITL stays interactive | OpenDev `present_plan` is interactive (arXiv:2603.05344). Agentic-systems §6 tiered HITL | Field Press/SDK is submit→poll/`wait()` |
| A3 | Stale-read **capability-gated** to real-FS hosts | OpenDev FileTimeTracker + `getmtime` + 50ms | `MemoryFileSystem` has **no mtime** |
| A4 | Thrash **in-process** interactive; CRDB only for durable runs | OpenDev `deque(maxlen=20)` in-loop | IDE/CLI ≠ `agent_runs` |
| A5 | Lease expiry → **recoverable pause** + idempotent Draft | LangGraph production checkpointers; AWS LangGraph+Strands recovery; agentic-systems §3 | **Verified:** reaper fail-wipes; `resumeRun` nulls `result` |
| A6 | Critic via **`agent_run_events` first** | Eval ≠ enforcement (v2 §2) | Events already back `onProgress` |
| A7 | CriticGate-lite (Phase 4a) as **parallel** safety net only | Deterministic floor must enforce (v2 §2) | Soft prompts still allow `@/` |
| A8 | Phase 0 only on live engine surfaces | Don't invent Desktop samples | Desktop loop may not be live |
| **A9** | **Own an internal Graph runtime** (nodes/edges/cycles/CRDB checkpointer); publish is first consumer | [Strands Graph](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/) (cycles, `max_node_executions`, custom nodes); Strands patterns (Workflow cannot cycle); [AWS LangGraph + Strands on AgentCore](https://aws.amazon.com/blogs/machine-learning/market-surveillance-agent-with-langgraph-and-strands-on-agentcore/) (macro graph + node reasoning); LangGraph 2026 Postgres checkpoint practice | Durable jobs on `agent_runs`; one-off SM fails reuse/quality |
| **A10** | **Always Planner-as-subagent** for publish Plan (same as IDE) | OpenDev: schema-absent writes; explore→analyze→plan; mode-toggle failed. Agentic-systems §3/§4 | Quality sole ranking — light Plan rejected |
| **A11** | **Public Run Graph DSL** on SDK — **platform node catalog only** | AgentCore sells memory **with** durable agent platform / paved tools ([AgentCore overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)); memory-only SDKs commoditize; productized graphs multiply patterned quality beyond one `content.publish` preset | Differentiated VP = memory-native durable graphs — not BYO LangGraph |

### 7.2 Superseded

| Prior | Superseded by | Reason |
|---|---|---|
| **A2** lightweight Plan node default for publish | **A10** | Explore/analyze isolation + schema write-impossibility outrank Lambda cost under quality ranking |
| Non-goal “no Graph runtime — fixed publish SM only” | **A9** | Reusable Graph + checkpoint/cycle primitives beat per-product control flow under quality ranking |
| “SDK stays without public Graph DSL” / §7.3 reject of all public graphs | **A11** | Constrained Run Graph DSL improves platform VP; unconstrained BYO tools still rejected |

### 7.3 Still rejected

- **Public BYO-tools / HostAdapter GraphBuilder** (LangGraph/Strands competitor) — dilutes moat; support sink; `sdk-platform.md`.
- **LangGraph/Strands as WalkCroach’s orchestration kernel** — steal contracts; implement on CockroachDB (ADR-H).

**Naming:** `content.publish` is Graph-shaped, runs on **internal Graph (A9)**, and is also a **preset** of the public Run Graph catalog (**A11**).

---

## Sources

- **Bui, N.D.Q.** *"Building Effective AI Coding Agents for the Terminal: Scaffolding, Harness, Context Engineering, and Lessons Learned."* arXiv:2603.05344v3 (Mar 2026) — OpenDev, the primary source for §1, §3's planning correction, and §5. The most detailed public technical account found of a production coding-agent harness.
- Strands Agents official docs — [Multi-agent Patterns](https://strandsagents.com/docs/user-guide/concepts/multi-agent/multi-agent-patterns/), [Graph pattern](https://strandsagents.com/docs/user-guide/concepts/multi-agent/graph/)
- AWS ML Blog — ["Market surveillance agent with LangGraph and Strands on AgentCore"](https://aws.amazon.com/blogs/machine-learning/market-surveillance-agent-with-langgraph-and-strands-on-agentcore/) — the LangGraph+Strands+AgentCore hybrid pattern, §3–4
- hidekazu-konishi.com — Strands multi-agent pattern selection guide, verified against official docs/GitHub/PyPI as of June 2026
- fp8.co — Strands vs. LangGraph 2026 comparison (checkpointing trade-off framing)
- dev.to/aws-heroes — "5 Multi-Agent Patterns in Strands Agents" (Graph-vs-Workflow distinction)
- Zylos Research — "LLM-as-Judge in Production" (2026) — Luna-2 cost/accuracy figures, §2
- dev.to/waxell + waxell.ai — "AI Agent Output Validation in Production" — evaluation-vs-enforcement distinction, hallucination benchmark, §2
- futureagi.com — "How I Built Deterministic LLM Eval Metrics" — the $40K judge-bill anecdote, §2
- CogniSwitch — "LLM-as-a-Judge vs. Deterministic Verification" — layering guidance, §2
- QubitTool — "2026 AI Agent Framework Showdown" — framework-selection-by-infrastructure guidance, §3
- LangGraph production checkpointing 2026 — Postgres/Redis checkpointers, recursion limits, idempotent nodes, TTL (e.g. Rapid Claw, Gheware field lessons, AliceLabs enterprise guide) — grounds §7 A9
- Quality-first re-amend of implementation plan — §7 A9/A10 supersede A2 and “no Graph runtime”
