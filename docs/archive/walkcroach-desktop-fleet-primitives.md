# WalkCroach Desktop — Fleet Primitives and Token-Efficiency Architecture
## Extends `walkcroach-desktop-native-agent-module.md` §4.3 (Agent mode) and §6 (Phases)

**Written:** 2026-08-05
**Answers:** "Why can't we build ours like Cursor 3?" — with the specific primitives, why WalkCroach's starting position is genuinely better than Cursor's was, and what "fewer tokens than Claude Code's competitor" actually requires.

---

## 0. The short answer

We can, and the honest reason it's a smaller build than Cursor's was is a timing accident worth naming plainly: **Cursor 3 shipped April 2, 2026 — three and a half months before VS Code's Agent Host existed.** Anysphere had no session-persistence, multi-client, or process-isolation substrate to build on, so they built one from scratch (the Rust orchestrator they call "Anyrun"). WalkCroach doesn't have to. The hardest, most expensive part of what Cursor built — a session that survives the window closing, that multiple clients can observe, that runs in its own process — **already exists in Agent Host and is already wired into `WalkCroachAgent`, working, today.** What's left to build is materially smaller than what Cursor built, and this document itemizes exactly what it is.

The parallel-agent isolation mechanism itself, once you look past the branding, is not exotic: it's `git worktree add`. Claude Code already exposes the identical primitive through its own `EnterWorktree`/`ExitWorktree` tools. This is a real, achievable build, not a moonshot.

---

## 1. What Cursor actually built, mechanically — verified in detail

| Cursor primitive | What it actually is | Source confidence |
|---|---|---|
| Per-agent isolation | `git worktree add` under the hood, one new branch + directory per agent, spawns an agent process scoped to that path | High — confirmed across six independent technical write-ups, consistent mechanical description |
| Fleet UI ("Agents Window") | A standalone interface — Anysphere's own stated position is that it is "built entirely from scratch, not derived from VS Code at all" — showing Agent Tabs (grid/side-by-side sessions), live progress, intervene/kill controls | Corroborated across multiple independent sources using near-identical phrasing |
| Merge workflow | `/apply-worktree` merges a finished agent's branch back; `/delete-worktree` cleans up; cloud-run agents instead push results as a pull request | Consistent across sources |
| Cloud sandboxing | Rust orchestrator ("Anyrun") launches isolated VMs via AWS Firecracker for cloud-hosted agent runs | Single strong source, directionally consistent with Cursor's stated need for VM-level isolation on shared cloud infrastructure |
| Session persistence / multi-client | Built bespoke, because nothing like Agent Host existed when this was built | Inferred from timeline, not stated outright by Cursor — but the timeline is dispositive: Agent Host GA'd 2026-07-22, Cursor 3 shipped 2026-04-02 |

**Honest caveats to carry forward, not hide:** early Cursor 3 adopters reported real friction — losing track of the Agents Window after upgrading, missing branch selectors, inconsistent session persistence in the first weeks. A developer's line from Hacker News is worth keeping in view: *"The cognitive switching cost cancels out the efficiency gains"* — practical guidance converging on a **sweet spot of ≤6 independent parallel tasks**, not unlimited fleet size. And Windsurf shipped a comparable "Agent Command Center" within two weeks of Cursor 3, and a small third-party tool (Melty Labs' "Conductor," a free Mac app) already orchestrates parallel Claude Code and Codex agents in isolated worktrees — proof this pattern doesn't require Anysphere-scale engineering to execute well.

---

## 2. Why WalkCroach's starting position is structurally better than Cursor's was

This is the load-bearing argument, so it's stated as a direct comparison rather than a claim to take on faith:

| Capability Cursor had to build from scratch (pre-July 2026, no alternative existed) | WalkCroach's equivalent, already built or now upstream-provided |
|---|---|
| A session that survives the window closing | **Already true.** Agent Host's own architecture — `WalkCroachAgent`'s registration already proven in D2 |
| Multiple clients observing/controlling one session | **Already true.** AHP's core design — no new work |
| A dedicated process, isolated from a busy editor | **Already true.** This is what registering as an `IAgent` provider already gives, per the base plan's own §2 |
| Git-worktree isolation as a first-class concept | **Partially already true.** VS Code 1.130's worktree support for Agent Host sessions is exactly what the base plan's D5 already cites — "git-worktree isolation per session, matching 1.130's worktree support" |
| A fleet-management UI | **Not yet built** — this document's actual net-new scope |
| Cloud-hosted, VM-isolated agent execution | **Not yet built for Desktop**, but the underlying research already exists in this project (E2B, evaluated as WalkCroach Web's primary sandbox; Lambda MicroVMs, researched as a future candidate) |

Read that table again: four of six rows are already done, inherited for free from upstream shipping Agent Host after Cursor had already committed to building their own. The real net-new work is narrower than "build Cursor 3" — it's "build the fleet UI and the worktree tools, on top of infrastructure that already exists."

---

## 3. The primitives to build, in order

### 3.1 Worktree tools in `agent-engine` (the actual isolation mechanism)

Two new tools, mirroring Claude Code's own naming since it's already the field's converged vocabulary:

- **`enterWorktree(branchName, baseRef)`** — runs `git worktree add`, returns the new working directory path. The agent's subsequent `HostAdapter` calls (`readFile`/`writeFile`/`runTerminal`) are scoped to that path for the remainder of the session.
- **`exitWorktree(action: 'apply' | 'discard')`** — `apply` merges the worktree's branch back (or opens a PR, for the cloud-run case in §3.4) and runs `git worktree remove`; `discard` removes without merging.

This is genuinely small, self-contained engineering — it is standard git plumbing wrapped in two tool definitions, not new infrastructure. It slots directly into D3's `DesktopHostAdapter` work already scoped in the base plan.

### 3.2 Parallel session orchestration (the actual "fleet" part)

- A session-launcher that, given N task descriptions, calls `AgentService`/`IAgentChats.createChat` N times, each immediately following with `enterWorktree` for that session.
- Because AHP already gives one host process observable by multiple clients, **the native module's fleet view doesn't need its own orchestration layer** the way Anyrun did — it's a UI that lists and renders N already-independent AHP sessions, each already isolated by its own worktree. This is the single biggest complexity reduction relative to Cursor's build.
- Sweet-spot cap, taken directly from the field's own findings (§1): default the fleet UI to a soft cap around 6 concurrent sessions, with an explicit "run more anyway" override rather than an unbounded queue — this is a UX decision informed by real reported friction, not an arbitrary limit.

### 3.3 The fleet UI itself

Extends, rather than replaces, the native module from the companion document:

- **Agent Tabs, not a separate window.** Given §2's structural advantage, WalkCroach does not need Cursor's "wholly separate, from-scratch interface" — it needs the existing `WebviewView`'s content to support a grid/tab layout when more than one session is active, reusing the same message-bubble, plan-step, and approval-card components already specified. When a fleet is running, the view expands from the sidebar into a full editor-group tab (wide, multi-column) rather than staying pinned narrow — the same "shape follows content" reasoning already applied to the sidebar-vs-panel split in the companion document's §5.
- **Per-session status**: worktree branch name, live progress, a kill/intervene control, and — the thing no competitor can show — the memory provenance chip (§5.2 of the companion doc) surfaced per session, so a fleet view shows not just "what is each agent doing" but "what does each agent already know from Chrome/Web/prior sessions."
- **Merge review**: `exitWorktree('apply')` routes through the workbench diff editor for a real review, not an auto-merge — consistent with the project's own non-negotiable propose-before-execute principle (companion doc §0.3), applied to the one new place multi-agent work could otherwise slip past it.

### 3.4 Cloud-run agents (later, and already de-risked by existing research)

Cursor's cloud tier needs Firecracker-level isolation because many *different customers'* code runs on Cursor's own shared infrastructure — a genuine multi-tenant security boundary. A first version of WalkCroach's fleet feature does **not** need this: local parallel worktrees on a single user's own machine share the same trust boundary a single local session already has — no new isolation primitive required for that case. Cloud-run agents (matching Cursor's "reach your agents from your phone, web, Slack, GitHub" story) are a real, separable later phase, and when that phase comes, this project has already done the relevant research: E2B is WalkCroach Web's proven primary sandbox runtime, and Lambda MicroVMs were evaluated as a credible, AWS-native future candidate. Neither needs to be re-researched — this is a sequencing decision, not an open technical question.

---

## 4. Token efficiency: what's actually true, and what to build

### 4.1 The honest shape of the claim

The widely-cited "5.5x fewer tokens" figure (33K vs. 188K tokens, Claude Code/Opus vs. Cursor/GPT-5, on one identical multi-file feature-implementation task) is real and well-sourced, but it is not universal, and presenting it as such would be the same overclaiming this project has consistently avoided elsewhere. A separate, credible source reports the opposite ordering for **small, surgical edits** — Cursor's interactive, per-turn completion loop can be leaner on trivial tasks precisely because it isn't paying the fixed up-front cost of reading broad context before acting. The honest synthesis: **the efficiency gap is real and large specifically for complex, multi-file, autonomous work — the exact shape of Agent mode's job — and much smaller or reversed for quick, single-file interactive edits — the shape of Chat mode and the Web PRD's inline-edit feature.** Build for efficiency where the gap is real; don't over-engineer where it isn't.

### 4.2 The four mechanisms behind Claude Code's advantage, and WalkCroach's current position against each

| Mechanism | What it does | WalkCroach's status |
|---|---|---|
| **Read-once, plan, execute** vs. resending context every turn | Claude Code sends full context once per session; Cursor's interactive model resends context with every completion, inline chat message, and agent step | **Already the right shape.** The three-phase loop (gather context → act → verify) and the Plan/Chat/Agent mode split (companion doc §4) are session-scoped, not per-completion — this is architecturally the Claude Code side of this divide already, not the Cursor side |
| **Agentic on-demand reads** vs. streaming a large indexed context every request | Search/glob first, read only what's needed, rather than front-loading broad embedding-retrieved context on every turn | **Already built.** `agent-engine`'s own tool description is explicit: `semantic_search` is "complementary to search/glob: prefer search for exact strings or regex, glob for filenames" — the on-demand-narrow pattern, not the flood-the-context pattern |
| **Subagent isolation** | Exploratory work runs in an isolated context window and returns only a summary to the parent, so investigation noise doesn't bloat the main session | **Already built.** The IDE extension's sub-agent architecture already does exactly this — Desktop inherits it via the shared `agent-engine`, no new work |
| **Plan mode separating exploration from execution** | Anthropic's own published Claude Code best practices state this explicitly: scope investigation narrowly or delegate to subagents specifically so exploration doesn't consume the main context | **Already the design**, as of the companion document's §4.2 — this section is independent confirmation that Plan mode is a genuine efficiency mechanism, not only a UX nicety |

Read plainly: on the architecture axis, WalkCroach's `agent-engine` was already built closer to Claude Code's side of this comparison than Cursor's, before this research pass even started. That is worth knowing and saying with confidence — it is not the part that needs new work.

### 4.3 What genuinely needs building — and one place Nova is currently behind Claude on Bedrock

Two context-management mechanisms remain, and here the picture is mixed and worth stating exactly as found, not rounded up:

- **Prompt caching — available now, needs wiring in.** Bedrock prompt caching has been GA since April 2025. **Verified against live Bedrock model cards (2026-08-05):** Nova Pro and Nova 2 Lite both list prompt caching as **supported** — 1,024-token minimum per checkpoint, maximum 4 checkpoints, 5-minute TTL, checkpoints accepted on `system` and `messages`, with a 20K-token cache ceiling for Nova models. Explicit `cachePoint` opt-in is recommended over relying on Nova's automatic prefix caching alone (cost savings and hit consistency). The concrete build: structure tool definitions → system prompt → `WALKCROACH.md` as a stable, cacheable prefix (Bedrock evaluates checkpoints in `tools` → `system` → `messages` order), with only the per-turn variable content (latest message, tool results) appended after — an ordering discipline in how `agent-engine` assembles Converse API calls, not new infrastructure.
- **Auto-compaction — currently a real gap, not yet available on Nova.** Bedrock's server-side Compaction feature (`compact-2026-01-12` beta) automatically summarizes older context when a long session approaches its window limit — exactly the mechanism that lets Claude Code hold multi-hour sessions without degrading. **As of this research, it is Claude-only (Claude Sonnet 4.6 specifically) and not supported on the Converse API, only InvokeModel.** This is an honest, current limitation on WalkCroach's primary model choice, not something to paper over. Two real options, not mutually exclusive: (a) build a lightweight application-level equivalent in `agent-engine` — track cumulative context size, and when a configurable threshold is crossed, generate a summary turn and drop earlier message blocks, the same shape as Bedrock's own mechanism, just implemented at the application layer instead of server-side; (b) for sessions specifically expected to run long (a fleet agent left running for hours), route that session through a Claude model available on Bedrock rather than Nova, accepting the cost/consistency trade-off of a second model in the routing table in exchange for native compaction. Recommendation: build (a) first, since it's a genuine capability gap regardless of model choice and keeps the Nova-first architecture intact; treat (b) as a targeted option for the fleet/long-running case specifically, not a default.

### 4.4 One thing to verify, not assume

Cursor's own advertised 200K context window reportedly truncates to 70K–120K "usable" in practice before quality degrades, per multiple independent developer reports — a real gap between marketing and behavior. Nova Pro's real context window and Nova 2 Lite's 1M-token window are both large on paper; **this project should measure actual usable context on its own real workloads before either claiming an efficiency win or assuming one** — the same discipline already applied elsewhere in this project (e.g., the base Desktop plan's own instruction to measure `semantic_search` latency on a real repo before deciding on `sqlite-vec`). Token efficiency claims made in a future demo or pitch should be sourced from WalkCroach's own measurements, not inferred from vendor comparisons.

---

## 5. What this adds to the phased plan

A new phase, sequenced after the companion document's D3 (worktree tools depend on `DesktopHostAdapter`'s terminal/filesystem access) and independent of D4–D6:

### D-Fleet — Parallel agents and the fleet view
- `enterWorktree`/`exitWorktree` tools in `agent-engine` (§3.1) — small, self-contained, reuses standard git plumbing.
- Parallel session launcher (§3.2) — thin, since AHP already provides the substrate.
- Fleet UI: Agent Tabs grid/side-by-side layout, expanding the existing native module's `WebviewView` rather than building a second interface (§3.3).
- Prompt-caching-aware context assembly in `agent-engine` (§4.3) — an ordering change to how Converse API calls are built, not new infrastructure.
- Application-level compaction (§4.3) — a genuinely new, small subsystem: threshold detection + summarization turn + old-block eviction.
- **Exit criterion:** three independent tasks run as three parallel worktree-isolated sessions from one fleet view, each showing live status and memory provenance, with at least one merged back through a real diff review and at least one discarded.

Cloud-run agents (§3.4) are explicitly **not** in this phase — sequenced later, and already de-risked by existing E2B/Lambda MicroVM research rather than requiring new investigation when its time comes.

---

## 6. Risk additions

| Risk | Why it bites | Mitigation |
|---|---|---|
| **Fleet UI complexity creep toward Cursor's own reported friction** | Users losing track of sessions, inconsistent state, is a documented real failure mode even for a well-resourced competitor | Ship the ≤6-session soft cap (§3.2) from day one, not as a later fix; treat it as a design constraint, not a placeholder |
| **Prompt-cache hit rate under real WalkCroach prefixes** | Nova caching is confirmed on paper; unstable tool/system ordering still burns the cache on every turn | Instrument `cacheReadInputTokens` / `cacheWriteInputTokens` on Converse responses; treat a sustained miss rate as a bug in assembly order, not a model gap |
| **Compaction gap could quietly reintroduce the "resend everything" cost pattern this whole document argues against** | If application-level compaction (§4.3) is deprioritized under schedule pressure, long fleet sessions degrade toward Cursor's own per-turn-resend cost profile | Treat application-level compaction as part of D-Fleet's exit criterion, not a follow-up — a fleet session that runs for hours without it defeats the point of building the fleet feature at all |
| **Token-efficiency claims outrunning WalkCroach's own measurements** | Cursor's advertised-vs-usable context gap is a cautionary, dated example of exactly this | §4.4's instruction — measure on real workloads before publishing any comparative claim — is binding, not aspirational |
