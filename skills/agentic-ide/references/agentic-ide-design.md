# Agentic IDE Design

> Synthesised from competitor outcomes and WalkCroach's `agent-engine` / Desktop Path B. Implementation skill — not a PRD.

## Contents
1. UI surface
2. Modes and phases
3. Approval and autonomy
4. Diff and change review
5. Context and memory
6. Multi-agent and isolation
7. Failure modes to design against

---

## 1. UI surface

| Pattern | When |
|---|---|
| Aux / side Agent view | Everyday single-agent work; lowest friction |
| Dedicated Agents Window | Fleet / multi-session; WalkCroach Path B |
| Inline completions | Separate product surface; do not conflate with agent loop |
| Terminal-native agent | CLI segment; same engine, different HostAdapter |

WalkCroach Desktop: aux webview + Agents Window share `agent-ui.js`. Extension: webview sidebar. Keep **one protocol** (or generate both sides) — hand mirrors drift.

## 2. Modes and phases

Industry consensus settled on explicit modes rather than one omnipotent agent:

| Mode | Tools offered | User expectation |
|---|---|---|
| **Chat** | Read / search / ask — **no writes** | Safe exploration |
| **Plan** | Read + plan artefact; writes gated or deferred | Review before act |
| **Agent / Act** | Full tool registry with approvals | Autonomous execution under policy |

WalkCroach engine phases `gather → act → verify` are orthogonal to mode: even Agent mode should verify. UI should show phase; hiding it trains users to distrust the loop.

Map UI mode → engine policy in one codec (Desktop: `__WC_MODE__`). Never fork policy logic per surface without a shared matrix test.

## 3. Approval and autonomy

- **Fail closed** on destructive tools (write, terminal, ccloud, network side effects).
- Autonomy levels (`strict` / `low_friction`) change *prompting frequency*, not *whether* a gate exists for catastrophic actions.
- Approvals must be **session-scoped**. Multi-agent fleets that resolve the first matching prompt across all sessions are a security bug (known Desktop risk).
- Show enough context on the card (path, diff hunk, command) to decide without opening three other panels.

Cline's regulated-environment reputation is largely approval UX. Windsurf's criticism was often over-autonomy. Do not copy the latter for demos.

## 4. Diff and change review

Minimum bar for a serious coding agent:

1. Before/after available at approval time.
2. Apply / reject / edit path.
3. Optional commentary tied to hunks — only if wired end-to-end (Desktop has stubs; do not claim the feature until callers exist).

Prefer worktree isolation so "reject" does not require heroic undo on `main`.

## 5. Context and memory

| Layer | WalkCroach mechanism |
|---|---|
| Working | Model context + session transcript (engine session files / AHP) |
| Project semantic | CockroachDB via memory bridge / SDK |
| Procedural | Skills (local + shared) |
| Repo guidance | `WALKCROACH.md` / equivalent — keep short |

Cross-surface memory is the product. Local-only durable buffers are a cache, not a second source of truth — and must not diverge silently from CRDB.

Context engineering: few sharp tools beat many overlapping ones; truncate tool results with fetch-more; subagents return **summaries**, not full transcripts, into the parent.

## 6. Multi-agent and isolation

- Soft caps beat unbounded fleets (Desktop soft cap ~6).
- **Lazy worktree**: enter on first write intent; read-only chats stay cheap (industry default in Claude Code-class systems).
- Isolation levels: worktree (files+git) vs shared thread vs remote — pick explicitly per spawn.
- Parent agent owns user communication; children should not fight for the same approval channel.

## 7. Failure modes to design against

| Failure | Mitigation |
|---|---|
| Silent writes / tool bypass | Tools absent from registry in Chat; uniform permission pipeline |
| Context blow-up | Subagents, compaction, deferred tools |
| Fork maintenance death | Allowlist CI, ≤14d sync, publish cadence signal |
| Marketplace / supply chain | Open VSX only; audited recommendations |
| Dual-host drift (IDE vs Desktop) | Shared engine; contract tests on HostAdapter behaviour |
| Protocol mirror drift | Single source of truth or codegen for webview↔host types |
| Fake "done" status | STATUS.md honesty; verify before marketing claims |
| Unbounded cloud cost | BYOK on coding surfaces; entitlements on platform features |
