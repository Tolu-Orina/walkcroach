# WalkCroach IDE — Product Requirements Document

**Module:** Module 3 — WalkCroach IDE (the agent), starting with a VS Code extension + companion CLI
**Companion docs:** `docs/plan1.md` (original architecture), `WalkCroach_Web_PRD.md` (Module 1), `WalkCroach_Chrome_PRD.md` (Module 2)
**Version:** 1.0
**Date:** July 2026

---

## How to read this document

The original hackathon plan (`plan1.md`, Phase 6) scoped WalkCroach IDE loosely as "a Claude-Code-style agent for the developer's local filesystem." That's directionally right but not a product scope — "be like Claude Code" doesn't say which of Claude Code's, Cursor's, Cline's, or Kiro's specific architectural bets to copy, which to avoid, and where CockroachDB's four agent-ready tools actually earn their place versus being bolted on for the judging checklist. This PRD does that work: a deep-dive teardown of how the leading agentic IDE tools are actually built in 2026, followed by a full product scope built from the patterns worth adopting.

**A note on the CockroachDB tools:** all four requested tools (Managed MCP Server, Distributed Vector Indexing, ccloud CLI, Agent Skills Repo) are scoped into this PRD with a specific job each — not as a checklist to tick, but because CockroachDB's own published guidance on when to use which tool (Section 2.8) maps unusually well onto WalkCroach IDE's actual architecture.

---

## 1. Executive summary

### 1.1 What the research found

Three findings reshape this module's scope from the original one-line description:

1. **"VS Code extension" is not one architecture — it's at least three, and they are not equivalent.** Cursor and Windsurf are forks of VS Code (separate applications, migrate away from your setup). Cline, Continue, and GitHub Copilot are true extensions that install into stock VS Code. Within "true extension," there are two further sub-choices: build on VS Code's native **Chat Participant API** (ties your agent to GitHub Copilot Chat as the host UI, with real constraints — no system-prompt control, agent-mode isolation) or build a **custom webview sidebar with your own model backend**, which is what Cline, Continue, and Roo Code all actually do. Given WalkCroach IDE needs its own branding, its own model (Nova 2 Lite via Bedrock, not Copilot's model roster), and full control over its agent loop, the custom-webview path is the only one that fits — this is a concrete architecture decision this PRD locks in (Section 9), not left open.

2. **AWS already has a direct, very recent competitor in this exact space, and it changes the positioning question.** Amazon Q Developer's IDE plugins are being sunset (new signups blocked since May 15, 2026; end of support April 30, 2027) in favor of **Kiro** — AWS's own agentic IDE, built on Code OSS, powered by Claude and Nova via Bedrock, generally available since March 2026. Kiro's differentiator is **spec-driven development**: before any code is written, the agent produces `requirements.md`, `design.md`, and `tasks.md` (using EARS formal notation), which the user reviews and approves — inverting the "prompt straight to code" model every other tool uses. Because WalkCroach IDE is also AWS/Bedrock-native, judges and users will reasonably ask "why not just use Kiro" — this PRD's answer (Section 3) is CockroachDB-backed durable memory across sessions and across WalkCroach's other two surfaces, which Kiro (file-based specs only, no cross-tool memory) does not have.

3. **The category has converged on a small set of proven patterns worth copying directly**, and a smaller set of clear anti-patterns worth avoiding:
   - **Copy:** file-based, git-diffable project memory (`CLAUDE.md` / `.clinerules/`); an explicit plan-then-execute mode with per-step approval (Cline's Plan/Act, Kiro's spec approval); MCP as the standard integration layer (used by nearly every competitor reviewed); sub-agent fan-out for large multi-file tasks (Claude Code).
   - **Avoid:** committing production-adjacent actions without a guardrail — Kiro's own widely-reported February 2026 incident (a Kiro-generated change was blamed, likely wrongly, for an AWS service disruption) is the industry's cautionary tale for exactly the kind of database-provisioning actions WalkCroach IDE's ccloud CLI integration will perform, and directly justifies the approval gates in Section 7.4.

### 1.2 The repositioning

WalkCroach IDE is **a true VS Code extension (not a fork) with a custom agent UI, paired with a CLI that shares the same agent engine**, differentiated from every competitor reviewed by one thing none of them have: **durable, cross-surface memory in CockroachDB**, shared with WalkCroach Web and WalkCroach Chrome. A Cursor or Kiro session's understanding of a project dies with that tool. A WalkCroach IDE session's understanding is the same memory graph a founder built while researching in Chrome and building in Web — this is the product's actual differentiation, not "another agentic coding tool."

---

## 2. Deep-dive research: how agentic IDE tools actually work

### 2.1 The three architecture paradigms

| Paradigm | Examples | How it works | Relevant to WalkCroach IDE? |
|---|---|---|---|
| **Forked editor** | Cursor, Windsurf | Ship a modified standalone application; users migrate their whole setup | No — explicitly ruled out; "starting with VS Code" means installing into a developer's existing setup, not asking them to leave it |
| **True VS Code extension** | Cline, Continue, Roo Code, GitHub Copilot, Kiro-adjacent tooling | Installs from the Marketplace/Open VSX into stock VS Code | **Yes — this is WalkCroach IDE's paradigm** |
| **Terminal-native agent** | Claude Code, Aider, Codex CLI, OpenCode | No IDE surface at all; lives in the terminal, reads/writes files and runs commands directly | **Yes, for the CLI half of this module** — same agent engine, different surface |

### 2.2 Within "true extension": two competing sub-architectures

- **Chat Participant API** (VS Code's native extensibility path): your extension registers an `@participant` inside GitHub Copilot Chat. Pros: reuses VS Code's built-in chat UI, easy distribution, deep editor access. Cons, both disqualifying for WalkCroach IDE: it becomes classified as a "GitHub Copilot Extension" dependent on Copilot Chat being installed and active as the host; the extension author **cannot control or override the system prompt in agent mode**, and tools only auto-invoke inside Copilot's own agent mode, not a custom one.
- **Custom webview sidebar with an independent model backend**: the path Cline, Continue, and Roo Code all take. The extension owns its full UI (a webview panel), its own agent loop, and calls whatever model backend it chooses. This is the only path that lets WalkCroach IDE use Nova 2 Lite via Bedrock as its model, own its system prompt and approval UX, and work identically whether or not the user has GitHub Copilot installed at all.

**Decision (binding for Section 9):** WalkCroach IDE builds as a custom webview-sidebar extension, following the Cline/Continue architectural pattern, not the Chat Participant API.

### 2.3 Context and memory patterns compared

| Tool | Memory mechanism | Durability |
|---|---|---|
| Claude Code | `CLAUDE.md` — plain-text, git-diffable, loaded at session start | Local to the repo; not synced anywhere |
| Cline | `.clinerules/` — file-scoped, conditional coding-standard rules | Local to the repo |
| Cursor | Embedding-based codebase index; effective context ~120K tokens including chat history | Local index, rebuilt/maintained by the tool |
| Windsurf | "Cascade" + "Flows" — session-persistent context that tracks recently opened/changed files and infers the current goal | Session-scoped; degrades once the session ends |
| Kiro | Spec-driven: `requirements.md`, `design.md`, `tasks.md` as durable, versioned planning artifacts; "steering files" for persistent project conventions | Local to the repo, but genuinely durable and reviewable since specs are the source of truth, not a side effect |
| **WalkCroach IDE (proposed)** | `WALKCROACH.md` local file (same pattern as `CLAUDE.md`/`.clinerules/`) **plus** a distilled, embedded mirror written to the shared CockroachDB memory graph | Local AND cross-session AND cross-surface (Web, Chrome) — no competitor reviewed has the third property |

The clear conclusion: every competitor's memory is good within a single tool and a single machine. None of them solve for a memory that outlives the tool or is shared with a different product entirely. That gap is exactly what CockroachDB's Distributed Vector Indexing is for.

### 2.4 Human-in-the-loop and approval models

- **Cline:** Plan mode (non-destructive reasoning, no file writes) vs. Act mode (executes); shows diffs and terminal commands before applying/running them, with a configurable autonomy dial from strict per-step approval up to a "YOLO mode" for trusted, low-stakes tasks.
- **Kiro:** requires a structured spec (requirements → design → tasks) to be reviewed and approved before any code generation begins; for longer approved tasks it then runs autonomously across files without further step-by-step gates.
- **Claude Code:** three-phase loop (gather context → act → verify) with tool calls visible and interruptible; hooks can enforce policy on specific tool invocations.
- **The shared lesson, reinforced by Kiro's own February 2026 incident:** every credible tool in this category treats "diff/command visible before it runs" as non-negotiable, and the tools that skip a review gate on production-adjacent actions are the ones that generate cautionary headlines. This directly informs Section 7.4's approval gates on any ccloud CLI action that provisions, modifies, or deletes cloud infrastructure.

### 2.5 Sub-agent and parallelization patterns

Claude Code's sub-agent model — a large task fans out to isolated sub-agents (one renames an API surface, one updates tests, one updates docs) that each return only a summary to the parent context — is the most advanced pattern found and is explicitly cited by independent comparisons as the reason Claude Code is the safer choice for large, cross-cutting changes (schema migrations, monorepo-wide renames) versus Cursor or Windsurf's single-agent model. This is directly relevant to WalkCroach IDE given that schema-migration-style tasks are exactly what its CockroachDB integration will be asked to do.

### 2.6 MCP as the near-universal integration layer

Every credible tool reviewed — Cline (MCP Marketplace), Continue, Claude Code, Cursor, Amazon Q Developer/Kiro (MCP support added to both IDE and CLI surfaces) — treats MCP as the standard way to extend an agent with external tools. This is strong external validation that CockroachDB's Managed MCP Server is the right integration point for WalkCroach IDE rather than a bespoke API client.

### 2.7 The direct AWS-native competitor: Kiro

Kiro is not a hypothetical competitor — it is AWS's official replacement for Amazon Q Developer's IDE plugins, built on the same foundation WalkCroach uses (Bedrock, with routing between Claude and Nova models). It is built on Code OSS (VS Code's open-source base) with agent hooks, steering files, and MCP support, and is explicitly positioned around traceability and structured planning for production work. **WalkCroach IDE should expect direct comparison to Kiro** and should not compete on "more structured planning" (Kiro already owns that ground well) — it competes on cross-surface, cross-session CockroachDB-backed memory, which is architecturally absent from Kiro's file-based spec model.

### 2.8 CockroachDB's own guidance on which tool does which job

CockroachDB's own published positioning draws a clean line this PRD adopts directly: **MCP is for multiplayer, shared-service scenarios** (a schema explorer or BI tool where many users authenticate into one shared service) while **the ccloud CLI is for single-player, developer-first workflows** (scripting a deploy pipeline, triaging an alert from the terminal, a repeatable runbook) where a human is directly in the loop. CockroachDB itself notes "in practice, agents use both — the question is which tool fits which job." This maps precisely onto WalkCroach IDE's two surfaces: **the VS Code extension, used interactively by one developer inspecting and querying data, is an MCP use case; the CLI, used for scripted provisioning and CI-style automation, is a ccloud CLI use case.** Agent Skills sit above both, as CockroachDB describes it: "the CLI and MCP provide access, skills provide the context and judgment needed to use that access effectively" — i.e., skills are not a fifth tool, they are what makes correct use of the other three possible.

---

## 3. Product vision

**WalkCroach IDE is where a WalkCroach project stops being a prompt in a browser and becomes a codebase a developer owns — extended by an agent that already knows everything the founder told the builder and everything they researched in Chrome, running as a true VS Code extension with its own CLI, using CockroachDB's own agent-ready tooling (MCP, vector search, ccloud CLI, Agent Skills) both as the product's differentiator and as a live demonstration of that tooling in production use.**

It does not try to out-structure Kiro or out-autocomplete Cursor. It wins on one axis deliberately: memory that survives across tools, sessions, and surfaces, backed by the same CockroachDB cluster the rest of WalkCroach already runs on.

---

## 4. Target users and personas

### 4.1 Primary persona — "Technical Tinkerer" (carried over from the Web PRD)
A developer who used WalkCroach Web to scaffold a project's shape, then wants full local control: their own editor, their own terminal, the ability to extend past what a browser sandbox (WebContainer) can do — real backends, real infrastructure, real CockroachDB clusters, not the in-browser preview.

### 4.2 Secondary persona — "Existing WalkCroach Web/Chrome user going deeper"
A founder whose project has outgrown the WebContainer's Node-only, in-browser constraints and needs a real local development environment, real database provisioning, or team collaboration via a shared git repo — while keeping everything the agent already knows about their project.

### 4.3 Tertiary persona — "Developer evaluating CockroachDB"
A developer who has no prior WalkCroach Web/Chrome usage at all, discovers WalkCroach IDE specifically because it's a well-built demonstration of CockroachDB's agent-ready tooling (MCP, vector index, ccloud CLI, Agent Skills) inside a familiar VS Code workflow. This persona matters for the hackathon's judging criteria directly and should not be an afterthought in the onboarding design (Section 5).

---

## 5. User journeys

### UJ-D1 — Install (zero-migration)
Developer installs WalkCroach IDE from the VS Code Marketplace into their existing VS Code setup — no fork, no migration, no loss of existing extensions or keybindings. A sidebar icon appears; clicking it opens the WalkCroach panel (custom webview, per Section 2.2's decision).

### UJ-D2 — First task, no prior WalkCroach account
Developer opens a local project (new or existing) and types a request in the panel. The agent runs the three-phase loop (gather context → act → verify), showing each file diff and terminal command before applying/running it, consistent with the category-wide approval pattern in Section 2.4. No CockroachDB connection or WalkCroach account is required for this to work — local-only mode is a complete, valid first experience.

### UJ-D3 — Local project memory established
As the session progresses, the agent proposes additions to a local `WALKCROACH.md` file (conventions, architecture decisions) — reviewable and git-diffable like any other file, matching the `CLAUDE.md`/`.clinerules/` pattern from Section 2.3.

### UJ-D4 — Sign in and link to an existing WalkCroach project
Developer signs in with their WalkCroach account and links the local repo to an existing WalkCroach Web project (or creates a new linked project). From this point, distilled summaries of `WALKCROACH.md` and session decisions are mirrored to the shared CockroachDB memory graph, and `recall_project_memory` becomes available inside the IDE session.

### UJ-D5 — CockroachDB-aware task (MCP path)
Developer asks the agent to inspect or query their project's CockroachDB database ("what's the current schema for the orders table," "find rows where..."). The agent uses the Managed MCP Server, read-only by default, to answer — an interactive, single-developer, exploratory use, matching CockroachDB's own MCP-fit guidance (Section 2.8).

### UJ-D6 — Schema design task (Agent Skills path)
Developer asks the agent to design a new table or add an index. The agent consults the loaded CockroachDB Agent Skills for schema/index-design best practice before proposing DDL, rather than improvising generic SQL — the proposal is shown as a reviewable diff/statement before execution, per the approval pattern in Section 2.4.

### UJ-D7 — Provisioning task (ccloud CLI path, explicit approval gated)
Developer asks the agent to provision a new preview database or configure networking for their project. The agent uses the ccloud CLI (agent-ready, JSON output, service-account scoped) — because this is a single-developer, scripted, infrastructure-changing action, it goes through the CLI path, not MCP, per Section 2.8's division of labor, and requires explicit confirmation before executing given the production-adjacent risk noted in Section 2.4.

### UJ-D8 — Large, multi-file task (sub-agent fan-out)
Developer asks for a large, cross-cutting change (e.g., a schema migration with downstream code updates). The agent fans work out to isolated sub-agents (one handles the migration, one updates affected queries, one updates tests), each returning a summary to the parent loop for reconciliation, per the Claude Code pattern in Section 2.5.

### UJ-D9 — CLI parity (headless / CI use)
The same agent engine is available as a CLI (`walkcroach` command) for a developer who wants to run the same tasks headlessly — in a script, in CI, or simply from the terminal instead of the editor — without re-authenticating or losing access to the same project memory.

### UJ-D10 — Cross-surface recall
On a later session (in the IDE, or back in WalkCroach Web), a decision made during an IDE session — a schema choice, a naming convention — is recalled without the developer re-explaining it, closing the loop that is this module's core differentiator (Section 1.2).

---

## 6. Feature set

### 6.1 Core agent loop and editor integration
- Custom webview sidebar panel (Section 2.2's architecture decision), not dependent on GitHub Copilot Chat.
- Three-phase agent loop: gather context (read files, search, inspect git state) → act (propose and, on approval, apply file writes / run commands) → verify (run tests/build, read output, iterate).
- Per-step diff and command preview before any file write or terminal execution, with a configurable autonomy dial (strict per-step approval by default; a faster, lower-friction mode for low-stakes repeated actions, explicitly opt-in).
- Local-only mode: fully functional with no WalkCroach account or CockroachDB connection required.

### 6.2 Context and memory
- `WALKCROACH.md` local, git-diffable project memory file (Section 2.3 pattern).
- On sign-in and project link, distilled decisions mirror to the shared CockroachDB memory graph.
- `recall_project_memory` tool available mid-session once linked, surfacing prior decisions from any WalkCroach surface (Web, Chrome, IDE).

### 6.3 CockroachDB tool integration (one job each, per Section 2.8)
- **Managed MCP Server** — interactive, read-only-by-default schema inspection and data queries during a session (UJ-D5); write access only via explicit per-action consent, full audit logging.
- **Distributed Vector Indexing** — the retrieval mechanism behind every `recall_project_memory` call; the same C-SPANN index already serving Web and Chrome, so a decision written from any surface is immediately recallable from this one.
- **ccloud CLI** — scripted, single-developer provisioning and lifecycle actions (UJ-D7): creating a preview database, managing backups, configuring networking, always behind an explicit confirmation gate.
- **Agent Skills Repo** — loaded as tool context for any schema-design, query-optimization, or operations task (UJ-D6), so the agent's proposals reflect CockroachDB's own documented expertise rather than generic SQL heuristics.

### 6.4 Safety and approval controls
- No file write, terminal command, or ccloud CLI action executes without a visible preview and explicit approval, except within an explicitly user-enabled low-friction mode for narrowly-scoped, repeated actions.
- Any ccloud CLI action that provisions, modifies, or deletes cloud infrastructure is never included in the low-friction/auto-approve mode, regardless of user setting — a hard rule, not a default (directly informed by the Kiro incident in Section 2.4).
- Sub-agent fan-out (Section 6.5) is visible to the user as named, trackable sub-tasks, not a black box.

### 6.5 Multi-file and sub-agent support
- Large tasks (schema migrations, cross-cutting renames) fan out to isolated sub-agents that return summaries to the parent loop for reconciliation (UJ-D8), rather than a single agent attempting the entire change serially.

### 6.6 CLI companion
- A `walkcroach` CLI sharing the same agent engine, authentication, and project-memory access as the VS Code extension — for headless, scripted, or CI-triggered use (UJ-D9).
- JSON-structured output mode for scripting, consistent with the ccloud CLI's own `-o json` convention (Section 2.8) so WalkCroach's CLI output composes naturally with CockroachDB's.

### 6.7 Cross-surface handoff
- Sign-in linking a local repo to an existing (or new) WalkCroach Web project.
- Decisions and conventions from an IDE session recallable in Web and Chrome sessions, and vice versa (UJ-D10).

---

## 7. Functional requirements

### 7.1 Core agent loop and editor integration
| ID | Priority | Requirement |
|---|---|---|
| FR-D01 | MUST | The extension shall install into stock VS Code from the Marketplace, requiring no fork, migration, or loss of the user's existing extensions or settings. |
| FR-D02 | MUST | The extension shall present its interface as a custom webview sidebar panel, independent of GitHub Copilot Chat, functional whether or not Copilot is installed. |
| FR-D03 | MUST | The agent shall implement a three-phase loop (gather context, act, verify) for every task, with each phase's tool calls visible in the panel. |
| FR-D04 | MUST | Every file write and terminal command shall be shown as a reviewable diff or command preview before execution, requiring explicit user approval by default. |
| FR-D05 | SHOULD | The user shall be able to enable a lower-friction autonomy mode for narrowly-scoped, repeated, non-infrastructure-changing actions, explicitly opt-in and separately configurable from the default. |
| FR-D06 | MUST | The extension shall be fully functional (agent loop, file/terminal tools, local memory) with no WalkCroach account or CockroachDB connection configured. |

### 7.2 Context and memory
| ID | Priority | Requirement |
|---|---|---|
| FR-D07 | MUST | The agent shall maintain a local `WALKCROACH.md` file at the project root, proposing additions as conventions/decisions emerge, reviewable like any other file change. |
| FR-D08 | MUST | On sign-in and project linking, the agent shall mirror distilled summaries of local decisions to the shared CockroachDB memory graph, reusing the `memory_entries` schema already defined for WalkCroach Web. |
| FR-D09 | MUST | Once linked, the agent shall expose a `recall_project_memory` tool that performs a vector-search query over the shared memory graph and surfaces results from any WalkCroach surface. |
| FR-D10 | SHOULD | The user shall be able to view and edit what has been mirrored to shared memory from a given local session, not only what's in `WALKCROACH.md`. |

### 7.3 CockroachDB MCP integration
| ID | Priority | Requirement |
|---|---|---|
| FR-D11 | MUST | The extension shall connect to the CockroachDB Cloud Managed MCP Server using the project's configuration snippet, defaulting to read-only mode. |
| FR-D12 | MUST | Any MCP-mediated write action (schema change, row insert/update) shall require explicit per-action user consent beyond the default read-only connection. |
| FR-D13 | MUST | All MCP tool invocations shall be captured in the audit log the Managed MCP Server already provides, with no separate custom proxy introduced. |
| FR-D14 | SHOULD | The agent shall use MCP for interactive, exploratory, single-session data queries and schema inspection (UJ-D5), consistent with CockroachDB's own MCP-fit guidance (Section 2.8) — not for scripted or repeatable infrastructure actions, which route to the CLI (FR-D18 onward). |

### 7.4 CockroachDB Distributed Vector Indexing
| ID | Priority | Requirement |
|---|---|---|
| FR-D15 | MUST | `recall_project_memory` (FR-D09) shall query the same C-SPANN distributed vector index already used by WalkCroach Web and Chrome — no separate vector store for the IDE surface. |
| FR-D16 | SHOULD | Vector search results shall be re-rankable/filterable by source surface (Web, Chrome, IDE) so a developer can distinguish "the founder said this in Web" from "I decided this in a prior IDE session." |

### 7.5 ccloud CLI integration
| ID | Priority | Requirement |
|---|---|---|
| FR-D17 | MUST | Cloud-infrastructure-changing actions (creating/modifying a database, configuring networking, managing backups) shall be performed via the ccloud CLI under a least-privilege, project-scoped service account — never via a raw, unscoped credential. |
| FR-D18 | MUST | Every ccloud CLI action shall require explicit user confirmation before execution, with no exception in any autonomy mode (Section 6.4), and shall use `-o json` output for the agent to parse results deterministically. |
| FR-D19 | SHOULD | The agent shall be able to reason about available ccloud commands from `--help` output at runtime rather than requiring a hardcoded command list, consistent with the CLI's own agent-ready design goal. |

### 7.6 CockroachDB Agent Skills integration
| ID | Priority | Requirement |
|---|---|---|
| FR-D20 | MUST | The extension shall load the CockroachDB Agent Skills Repo as tool context for any schema-design, query-optimization, security, or observability task, following the open Agent Skills specification for portability. |
| FR-D21 | SHOULD | Skill descriptions shall load cheaply (summary only) with the full skill body loaded into context only when matched to the current task, consistent with the context-cost-aware pattern used across the category (Section 2.3/2.5). |

### 7.7 Sub-agent support
| ID | Priority | Requirement |
|---|---|---|
| FR-D22 | SHOULD | For tasks estimated to span more than a configurable file-count threshold, the agent shall offer to fan the task out to named sub-agents, each visible in the panel with its own status and a summary returned to the parent loop on completion. |

### 7.8 CLI companion
| ID | Priority | Requirement |
|---|---|---|
| FR-D23 | MUST | A `walkcroach` CLI shall provide the same agent engine, authentication, and project-memory access as the VS Code extension, usable headlessly (no editor required). |
| FR-D24 | MUST | The CLI shall support a JSON-structured output mode for every command, for scripting and CI use. |
| FR-D25 | SHOULD | The CLI shall support the same approval-gate model as the extension (FR-D04, FR-D18) by default, with an explicit, separately-documented non-interactive flag required for CI use where no human is available to approve each step. |

### 7.9 Cross-surface handoff
| ID | Priority | Requirement |
|---|---|---|
| FR-D26 | MUST | A signed-in user shall be able to link a local repository to an existing or new WalkCroach Web project from within the extension or CLI. |
| FR-D27 | MUST | Once linked, decisions written from the IDE shall be recallable from WalkCroach Web's `recall_project_memory` tool and vice versa, using the shared schema (FR-D08). |

### 7.10 Cross-cutting
| ID | Priority | Requirement |
|---|---|---|
| FR-D28 | MUST | All new persistent state introduced by this module (mirrored memory, linked-project records, audit trails) shall be written to CockroachDB, consistent with the single-system-of-record principle established for WalkCroach Web and Chrome. |

---

## 8. Non-functional requirements

### 8.1 Performance
- **NFR-D01 (MUST):** The extension's webview panel shall load within 1 second of the sidebar icon being clicked.
- **NFR-D02 (MUST):** Time to first streamed agent response after a task submission shall not exceed 2.5 seconds at p50, consistent with the latency target already set for WalkCroach Web.
- **NFR-D03 (SHOULD):** `recall_project_memory` queries (FR-D09) shall return within 1.5 seconds at p95, matching the target already set for Chrome's equivalent recall feature.

### 8.2 Security and access control
- **NFR-D04 (MUST):** No CockroachDB credential, ccloud service-account key, or WalkCroach auth token shall be stored in plaintext in VS Code's extension storage or workspace settings; secrets shall use VS Code's `SecretStorage` API or an equivalent OS-level credential store.
- **NFR-D05 (MUST):** Every ccloud CLI service account used by the extension/CLI shall be scoped to the minimum privilege needed for the linked project, never a cluster-wide or organization-wide credential.
- **NFR-D06 (MUST):** MCP write access (FR-D12) shall remain opt-in per action; the connection shall never silently escalate from read-only to write.
- **NFR-D07 (SHOULD):** The extension shall support VS Code's workspace trust model, disabling agentic file/terminal actions in untrusted workspaces by default.

### 8.3 Reliability
- **NFR-D08 (MUST):** A crashed or force-closed VS Code session shall not lose any already-committed memory (local `WALKCROACH.md` changes already written to disk, or already-mirrored CockroachDB entries); only the in-flight, unconfirmed step may be lost, consistent with the disclosed-limitation pattern already used for WalkCroach Web (Web PRD NFR-10).
- **NFR-D09 (SHOULD):** A failed ccloud CLI or MCP call shall surface a plain-language error and a retry option, never a silent failure, given the elevated risk profile of infrastructure-changing actions (Section 6.4).

### 8.4 Compatibility
- **NFR-D10 (MUST):** The extension shall support the current and previous two major VS Code releases.
- **NFR-D11 (MUST):** The extension shall function correctly with or without GitHub Copilot installed, per the architecture decision in Section 2.2.
- **NFR-D12 (SHOULD):** The CLI shall run on macOS, Linux, and Windows (WSL or native), matching the platform coverage expected of a professional developer tool in this category.

### 8.5 Extensibility and portability
- **NFR-D13 (MUST):** Agent Skills loaded by the extension/CLI shall conform to the open Agent Skills specification, so skills authored for WalkCroach IDE remain portable to other compliant hosts (Claude Code, Cursor, etc.) and vice versa — reinforcing rather than fragmenting the open ecosystem CockroachDB's own skills repo participates in.
- **NFR-D14 (COULD):** The extension's Language Model Tool contributions (if any are added later for deeper VS Code agent-mode interop) shall follow VS Code's Language Model Tools API rather than a bespoke mechanism, keeping the door open to interop with Copilot's agent mode without making it a dependency (per Section 2.2's decision that it must not be a dependency).

### 8.6 Observability
- **NFR-D15 (MUST):** Every ccloud CLI action, MCP write, and sub-agent invocation shall be logged with enough detail to reconstruct the session's decisions, consistent with the observability pattern already established for WalkCroach Web and Chrome.

### 8.7 Cost efficiency
- **NFR-D16 (SHOULD):** The extension/CLI backend (auth, memory-mirroring service) shall follow the existing "scale to $0 idle" principle already locked for WalkCroach Web, avoiding always-on compute dedicated solely to this module.

---

## 9. Architecture decision record

**Decision:** WalkCroach IDE ships as (a) a true VS Code extension using a custom webview sidebar with its own agent loop and Nova 2 Lite backend — not VS Code's Chat Participant API, and not a forked editor — and (b) a companion CLI sharing the same agent engine.

**Why:** Section 2.2's research shows the Chat Participant API ties an extension to GitHub Copilot Chat as host, with no system-prompt control in agent mode — incompatible with WalkCroach needing its own model, branding, and approval UX. A fork (Cursor/Windsurf's path) contradicts "starting with VS Code" as a zero-migration entry point for existing developers. The custom-webview path is proven at scale (Cline: 5M+ installs; Continue: 2.5M+ installs), open (both are Apache-2.0/open-source, directly relevant to this module's own eventual open-source hackathon requirement), and gives full control over model backend, memory architecture, and approval gates.

**Consequence:** WalkCroach IDE will not appear inside GitHub Copilot Chat's `@`-mention list and will not be discoverable through Copilot's agent-mode tool list unless a separate, optional Language Model Tool is added later (NFR-D14) — an accepted trade-off for full control.

---

## 10. Success metrics

- **Activation:** % of extension installs that complete at least one approved agent action within the first session.
- **Trust/approval behavior:** ratio of approved-vs-rejected diffs and commands, tracked over time — a rising rejection rate is an early signal the agent's proposals aren't matching user intent, independent of raw task-completion rate.
- **Memory recall usage (the core differentiator):** % of linked-project sessions that issue at least one `recall_project_memory` query, and — where measurable — instances where a recalled fact visibly changed the agent's first proposal, mirroring the equivalent metric already defined for Web and Chrome.
- **CockroachDB tool usage depth:** counts of MCP calls, ccloud CLI actions, and Agent Skills invocations per session — both a product-health metric and a direct input to the hackathon's "Technical Implementation" judging criterion.
- **Cross-surface adoption:** % of WalkCroach Web/Chrome users who install the IDE extension and link at least one project (FR-D26).

---

## 11. Phasing

| Phase | Scope | Depends on |
|---|---|---|
| **IDE Phase A — Core local agent** | FR-D01–FR-D07, FR-D22 (agent loop, editor integration, local `WALKCROACH.md` memory, sub-agent fan-out), fully usable with no WalkCroach account | Nothing outside this module |
| **IDE Phase B — CockroachDB tool integration** | FR-D11–FR-D21 (MCP, vector indexing, ccloud CLI, Agent Skills) | Phase A's agent loop; the existing CockroachDB cluster and schema from `plan1.md` |
| **IDE Phase C — Cross-surface memory** | FR-D08–FR-D10, FR-D26–FR-D28 (sign-in, project linking, shared recall) | WalkCroach Web's account/sign-in model |
| **IDE Phase D — CLI companion** | FR-D23–FR-D25 | Phase A's agent engine, refactored to be embeddable outside the VS Code extension host |

As with the Chrome PRD, this document does not assume a specific calendar placement against the WalkCroach Web build schedule — that remains a team-capacity decision. Phase A alone is a credible, demoable product on its own and should be the priority if capacity is constrained, since it is also the foundation every later phase depends on.

---

## 12. Risks

- **Direct AWS-native competition from Kiro** (Section 2.7) — the positioning answer (cross-surface CockroachDB memory) needs to be evident in the first 30 seconds of any demo, not buried, or the comparison will default to "why not just use Kiro."
- **Chat Participant API temptation** — the native API is genuinely easier to ship initially; revisiting the Section 9 decision under time pressure would silently reintroduce the Copilot-dependency and system-prompt-control problems it was chosen to avoid. Treat Section 9 as binding, not a default to abandon if Phase A runs long.
- **Infrastructure-action safety** — the ccloud CLI's approval gate (FR-D18) is the single most safety-critical requirement in this document, directly informed by Kiro's own production-incident history; do not weaken it for demo convenience.
- **Sub-agent complexity** — Claude Code's sub-agent pattern (FR-D22) is the most technically ambitious item in this PRD; if Phase A's timeline is tight, this is the first candidate to defer to Phase B/C without weakening the module's core value proposition.
- **CLI as a genuine parity surface, not an afterthought** — several competitors ship a CLI that lags meaningfully behind their IDE surface in capability; FR-D23–FR-D25 explicitly require the same agent engine and approval model, not a thinner reimplementation, to avoid this trap.

---

## 13. Out of scope

- JetBrains, Neovim, or other editor support — VS Code first, per the original scope; revisit only after VS Code adoption is validated.
- Autonomous, unattended infrastructure changes of any kind — the ccloud CLI approval gate (FR-D18) has no autonomy-mode exception, and none is planned.
- A hosted/cloud version of the agent (running independent of the developer's own machine) — out of scope for this module; WalkCroach Web already covers the hosted-execution use case via WebContainer.
- Competing on spec-driven-development depth with Kiro — WalkCroach IDE's plan/approval model (Section 6.1, 6.4) is deliberately lighter-weight than Kiro's formal EARS-notation spec system; this is an accepted differentiation choice, not a gap to close.