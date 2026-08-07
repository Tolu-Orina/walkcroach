# WalkCroach Desktop — Native Agent Module
## Root-Cause Resolution, Architecture Pivot, and Full UI/Functional Specification

**Written:** 2026-08-05 · **Status:** Supersedes §D2 (build/verify) and §4.4 of `walkcroach-desktop-implementation-plan.md`; extends §3 (target architecture)
**Grounded in:** VS Code 1.130 (released 2026-07-22) and 1.131, current as of 2026-08-05
**Resolves:** the D2 blocker — "registered in the host, never renders in the UI"

---

## 0. The finding, stated in one sentence

**The Agents window and its picker are not, in current practice, the agent-agnostic surface AHP's design implies — Microsoft has explicitly scoped it to Copilot CLI, Copilot Cloud, and Claude only; their FAQ routes "local or other third-party *CLI* agents" to the main VS Code window (not a guarantee that a custom `IAgent` provider appears in any stock picker); and every serious competitor already avoids this problem by never depending on Microsoft's chat/agent UI chrome.** The fix is not a deeper bug hunt. It is the pivot the team has already intuited: stop trying to get `WalkCroachAgent` listed in someone else's picker, and ship a first-party native module that talks to the same, already-working `IAgent` registration directly.

---

## 1. Root cause — definitive, with primary sources

### 1.1 The evidence that closes the investigation

The D2 (verify) section left five open questions. Question 1 — *"How is the Agents window actually opened, and does it require product.json fields our overlay drops?"* — turns out to be asking the wrong thing. The real answer is in Microsoft's own current documentation and a GitHub Community discussion marked as the accepted answer, dated **2026-07-16**, ten days before this investigation began:

> *"The Agents window currently supports Copilot CLI, Copilot Cloud, and Claude sessions; local or other third-party agents need to be managed from the main VS Code window. That is also why creating a custom Plan agent does not make it appear in this picker."*
> — VS Code team, `github.com/orgs/community/discussions/202044`, accepted answer, 2026-07-16

The official docs page (`code.visualstudio.com/docs/agents/agents-window`) states the same allowlist, and its FAQ narrows the “main window” escape hatch to **local or third-party CLI agents** — sessions that still won’t appear in the Agents window. That is **not** a documented promise that a custom `IAgent` provider (WalkCroach’s registration path) is enumerated in the editor-window harness dropdown.

Two things follow immediately:

1. **This was never a WalkCroach registration defect.** Every piece of evidence D2 gathered — provider registers cleanly, host publishes to the renderer, transport is healthy, `chat.agentHost.enabled` is on — was correct and complete. The Agents window was always going to omit WalkCroach: it is not on Microsoft’s allowlist, regardless of how correctly `IAgent` was implemented.
2. **"Managed from the main VS Code window" ≠ "custom IAgent appears in the picker."** D2’s own testing from the regular editor window (`window1`) found nothing for WalkCroach. Combined with open questions about `SignInRequired`, `chatSessions` contribution-point gating, and whether that dropdown lists agent-host providers versus extension chat participants — the reliable product path is to drive `IAgent`/`IAgentChats` from a UI WalkCroach controls end to end. AHP’s own architecture (“clients speak AHP; agent backends integrate directly”) is exactly that pattern.

### 1.2 This is not a workaround — it is what AHP was designed to allow

It's worth being precise about why this isn't a hack. AHP's own architecture document (already summarized correctly in §0 of the base plan) states plainly that *multiple clients can observe and control one session* and that the host *"owns agent sessions independently of the clients used to view and control them."* A client is not privileged by being shipped in the box. `WalkCroachAgent`, once registered via `AgentService.registerProvider`, is exactly as real a provider as Copilot or Claude from the host's point of view — the gap is entirely in which **clients** Microsoft's own shipped UI currently knows how to route to which providers, not in the protocol or the registration. Building WalkCroach's own client against the same `IAgent`/`IAgentChats` surface is using AHP exactly as documented, not around it.

---

## 2. Why the fix is "remove and replace," not "keep investigating" — grounded in how every competitor already does this

The user's instinct — *remove the default chat bar, replace it with our own native module* — is independently the correct engineering call, verified against how the entire competitive field actually ships in August 2026, not just a reasonable-sounding workaround for one blocked phase:

| Product | How its chat/agent UI is actually built (verified 2026-08-05) | Depends on stock VS Code chat/Agent Host picker UI? |
|---|---|---|
| **Cursor** | Full fork; entirely proprietary chat panel, model-agnostic (Claude/GPT/Gemini switchable) | No — never has |
| **Windsurf** | Full fork; the "Cascade" panel is Windsurf's own dedicated UI, explicitly noted in current reviews for its deliberate icon/color/navigation polish versus stock VS Code | No |
| **Google Antigravity** | Agent-first, purpose-built UI; not a thin layer over Copilot's chat surface | No |
| **Claude Code (VS Code extension)** | **Ships its own dedicated Claude Code panel** — "wrapped in a workflow that feels closer to git than to VS Code's traditional chat sidebar," with inline diffs, plan mode, and conversation history as part of that dedicated panel — even though Claude is one of only three providers Microsoft's own Agents window currently supports natively | **No — not even Anthropic relies on it for the extension's primary UI**, despite being upstream-blessed |

The last row is the strongest evidence available. Anthropic is one of exactly three agents Microsoft ships an adapter for and one of exactly three the Agents window currently supports — and Anthropic *still* ships Claude Code's own dedicated panel as the product's real interface. If the vendor with the most privileged access to AHP doesn't route its primary UX through Microsoft's picker, a third-party provider has no reason to try to win that fight either. This reframes D2's exit criterion for the whole rest of this plan.

---

## 3. Architecture: the native module, precisely

### 3.1 What gets removed

Three stock UI entry points are hidden from WalkCroach Desktop's shipped build. This is a UI-visibility change made through the product overlay and workbench contribution suppression already used for the surface-area allowlist (§5 of the base plan) — **not** a change to `chat.agentHost.enabled`, which stays on, because the Agent Host process itself is exactly what's being kept.

| Remove from UI | Mechanism | Why |
|---|---|---|
| The built-in **Chat view** container/icon (the default sidebar chat entry point shipped in Code OSS core since chat became built-in, independent of any Copilot extension) | Contribution-point suppression in `workbench.common.main.ts`'s single permitted import, following the existing pattern used to drop other upstream views from the allowlist | It is a second, competing entry point into a chat experience that is not WalkCroach's, and its presence invites exactly the confusion §0 describes |
| The **Agents window** menu item / command that opens it | Command suppression via the product overlay | It structurally cannot show `WalkCroachAgent` (§1.1) and exists to route Copilot/Claude/Codex sessions, none of which WalkCroach ships |
| Any Copilot-specific settings/entry points inherited from `product.json` defaults | Already largely moot — Copilot Chat is a Microsoft-proprietary extension not distributed on Open VSX, so it is not bundled under the existing "no Marketplace proxy" policy; this line item is about the **core-shipped** chat UI, which exists independent of the Copilot extension being installed | Closes the gap between "we don't ship the Copilot extension" and "the built-in chat surface still exists and is empty/confusing without it" |

`WalkCroachAgent`'s registration via `AgentService.registerProvider` is **kept exactly as built** — this is the real, working half of D2, and it is what preserves every genuine Agent Host benefit from §2 of the base plan (separate process, session survives window close, direct workbench service access via `DesktopHostAdapter`).

### 3.2 What gets built: a first-party client, not a picker entry

```
┌─────────────────────────────────────────────────────────────────┐
│ WalkCroach Desktop (Code OSS fork)                               │
│                                                                    │
│  Activity Bar — "WalkCroach" (single entry, §4.4.2 of base plan) │
│    └─ Sidebar ViewContainer                                       │
│         └─ Agent View  ← ViewPane now; WebviewView+React next     │
│                        │                                          │
│                        │ typed bridge API (modes + sendTurn)      │
│                        ▼                                          │
│  Native glue (workbench/contrib/walkcroach/browser/agentBridge.ts)│
│    · injects IAgentHostService (renderer ↔ Agent Host IPC)        │
│    · createSession({ provider: 'walkcroach' }) → createChat →     │
│      dispatch chat/turnStarted; waits for chat/turnComplete       │
│    · NEVER holds a direct WalkCroachAgent reference — that        │
│      instance lives in the agent-host process across the IPC      │
│      boundary; AHP is the correct client surface                  │
│    · also injects ITextModelService, ISearchService,              │
│      ITerminalService, IEditorService for D3's HostAdapter work   │
│                        │                                          │
│                        ▼                                          │
│  Agent Host process ── WalkCroachAgent implements IAgent           │
│    (unchanged registration — session lifecycle, AHP transport)    │
└─────────────────────────────────────────────────────────────────┘
```

**Correction (2026-08-05):** An earlier draft of this diagram said the bridge “holds a direct reference to WalkCroachAgent.” That is impossible across the process boundary. The shipped bridge speaks AHP via `IAgentHostService` only.

### 3.3 Why a WebviewView, not a hand-rolled native `ViewPane`

Two real options exist for the Agent view's implementation, and the choice matters enough to record as a decision:

| | Native `ViewPane` (vanilla TS/DOM, workbench UI toolkit) | `WebviewView` (React/Tailwind, message bridge) |
|---|---|---|
| Reuses the IDE extension's existing UI code | No — different rendering model entirely | **Yes** — the IDE extension already ships a webview-sidebar chat UI; this becomes the same codebase, extended |
| Can use the project's own design skills as authored (Framer Motion, shadcn-style components, Tailwind tokens) | No — those skills assume a React/Tailwind stack | **Yes**, directly |
| Feels more "native" to VS Code's own chrome | Marginally | Negligible difference in practice — VS Code's own Chat view is itself largely webview-rendered |
| Cost | Rebuild the entire chat UI in the workbench's own component model | Near-zero — extend, don't rewrite |

**Decision: `WebviewView` for the polished Agent UI** (reuse IDE extension React/Tailwind). **D2 ships an interim native `ViewPane`** (`WalkCroachChatViewPane`) wired to the same `agentBridge` + Chat/Plan/Agent modes so the revised exit criterion is met without blocking on webview migration. The bridge contract does not change when the React webview lands.

### 3.4 What this changes about D2's exit criterion

The base plan's D2 exit criterion — *"a WalkCroach session appears in the Agents window beside Copilot/Claude/Codex"* — is retired. Per §1.1, that criterion was unreachable by design, for any third party, as of 1.130/1.131. The replacement:

> **D2 exit criterion (revised):** A WalkCroach session starts, streams, and completes entirely within the WalkCroach sidebar Agent view, with zero dependency on the Chat view, Agents window, or editor-window agent dropdown — none of which are present in the shipped build (§3.1).

---

## 4. The three modes: Chat, Plan, Agent

A single segmented control at the top of the Agent view switches modes. Per the visual-hierarchy principle of one primary state per screen, exactly one mode is active at a time — this is a mode switch, not a set of toggles.

### 4.1 Chat mode

**Purpose:** conversational, advisory, non-mutating. The default for "explain this," "what does this function do," "why is this failing."

- Tools available: read-only only — `readFile` (including unsaved buffers via `ITextModelService`), `search` (`ISearchService`), `semantic_search` (local index), `recall_project_memory`.
- No `writeFile`, no `runTerminal`, no connector actions, no ccloud CLI — Chat mode cannot mutate anything, by construction, not by convention. The tool registry passed to the engine in Chat mode is a strict subset; there is no permission prompt to bypass because the tool simply isn't offered.
- Memory-aware by default: every Chat response that draws on `recall_project_memory` shows its provenance chip inline (§5.2) — this is the mode where "from Chrome, 3 days ago" does the most product work, since it's the mode a user reaches for when they've forgotten context themselves.

### 4.2 Plan mode

**Purpose:** produce a structured, reviewable plan before anything executes — matching the shape VS Code 1.130 itself is already moving toward (its own Plan-agent concept, confirmed to exist in the current schema even though the Agents window picker doesn't yet expose it — see the GitHub issue in §1.1) and the pattern Claude Code's own `/plan` and Kiro's spec-driven flow both use.

- Output is a **structured plan artifact**, not prose: an ordered list of steps, each naming the files it touches and the reasoning for the change, rendered as the plan-step card component (§5.2) — never a wall of text pretending to be a plan.
- Plan mode has the same read-only tool access as Chat mode, plus one write-adjacent capability: it may stage a plan document (`.walkcroach/plans/<id>.md`) for review, git-diffable like any other file, consistent with the project's existing convention of durable, file-based, reviewable artifacts (`WALKCROACH.md`).
- **A plan is not auto-approved.** The user reviews the plan-step list and either approves it in full, edits individual steps inline, or discards it. Approval is the transition into Agent mode.

### 4.3 Agent mode

**Purpose:** execution, with full tool access, against either a Plan-mode-approved plan or a direct instruction.

- Full tool registry: `writeFile`, `runTerminal` (via `ITerminalService`, replacing the PTY fallback per D3), connector actions, MCP calls, ccloud CLI actions.
- **Approval model — WalkCroach's own equivalent of VS Code 1.130's Assisted Permissions, not a copy of it.** 1.130 introduced exactly this idea upstream: the model evaluates risk per tool call, auto-proceeding on low-risk operations and escalating genuinely uncertain ones to the user, replacing a wall of identical approve-prompts with a tiered system. WalkCroach adopts the same tier shape, layered on the project's own, stricter, non-negotiable floor:
  - **Tier 1 — always silent.** Read-only tool calls (already the entirety of Chat/Plan mode's registry).
  - **Tier 2 — risk-evaluated, auto-proceed on low risk.** File writes within the active workspace, non-destructive terminal commands (`npm install`, `npm test`).
  - **Tier 3 — always an explicit approval card, no exception, no autonomy setting overrides this.** Any ccloud CLI action that provisions, modifies, or deletes cloud infrastructure; any connector action that sends, posts, or pays on the user's behalf; any terminal command matching a destructive-pattern list (`rm -rf`, `git push --force`, `DROP TABLE`, etc.). This tier is the direct carry-forward of the non-negotiable rule already established for the IDE extension and CLI — Agent mode in Desktop does not relax it, and no per-user setting is offered that could.
- Approvals render as a real diff in the workbench diff editor (per the base plan's own UX-polish note — never a truncated 200-character QuickPick string) or, for terminal/connector/ccloud actions, a structured approval card naming exactly what will run and why.
- Sub-agent fan-out (base plan §D-series, carried from the IDE extension's own architecture) surfaces as named, trackable sub-tasks within the same Agent-mode session view, not a separate window or hidden log.

### 4.4 Mode transitions and shared state

- Chat → Plan → Agent is the common path, but any mode is directly selectable at any time; switching mode mid-conversation carries the conversation history forward (the underlying AHP session is one continuous session — only the *tool registry and approval tier* change with mode, not the session itself).
- The mode switcher shows which mode produced which message in the transcript (a small mode-tag on each turn), so scrolling back through a long session makes it obvious when the agent moved from advisory to executing.

---

## 5. UI, reimagined — full detail, using the project's own design system as the constraint

The base plan's §4.4 already made the two decisions that matter most (single "WalkCroach" activity-bar entry; Graphite Lumen as the shipped theme) and got the sidebar/panel split right (browse-and-select in the sidebar, tabular/log-shaped in the panel). What follows is execution detail against those decisions, using WalkCroach's own established skills — not a second design system layered on top.

### 5.1 Tokens — locked, not reinvented

Per design-token-discipline, every value below is used everywhere it applies with no per-screen exceptions. The base plan's Graphite Lumen table already fixes color; this section fixes the axes it didn't cover.

| Axis | Value | Source |
|---|---|---|
| Corner radius | `6px` small controls (buttons, chips, inputs), `10px` cards (message bubbles, plan-step cards, approval cards), `14px` the webview's own outer container edge where it meets a modal-like state | New — matches the flatter, larger-radius direction current enterprise practice favors (card-design-system) |
| Elevation model | **Flat, bordered** — `line` (`#2E333C`) 1px borders, no drop shadows on resting cards; shadow reserved for exactly one case: the approval card, which genuinely needs to read as "this one thing is different" | card-design-system's minimal/flat-for-enterprise guidance, applied consistently |
| Spacing scale | 4/8/12/16/24/32/48/64px only, no exceptions | spacing-layout-system |
| Type scale | 12px (provenance chips, meta), 14px (body, the chat transcript's default size), 16px (mode-switcher labels), 20px (view title "Agent"), never more than two weights (regular/semibold) | visual-hierarchy-typography |
| Icon set | One library throughout the Agent view and CockroachDB panel alike — VS Code's own Codicon set, since it's already the vocabulary the rest of the workbench uses and mixing a second icon library into a fork is exactly the inconsistency icon-system-placement warns against. Sizes: 16px inline-with-text, 24px toolbar/mode-switcher | icon-system-placement, adapted to the VS Code context rather than a web-app icon library |
| Motion | CSS transitions first (VS Code's own DOM/CSS stack, no React runtime outside the webview); inside the webview, Framer Motion only where state-driven (streaming text reveal, plan-step approval, staggered message entrance) | framer-motion-micro-interactions |

### 5.2 Component inventory

Each of these is built once, as a variant-driven component, and reused everywhere it applies — per component-alignment-consistency, never a one-off per screen.

- **Message bubble.** Left-aligned for the agent, right-aligned for the user (one alignment axis, held consistently); mode-tag (Chat/Plan/Agent) as a 12px label above the first bubble of a turn where mode changed.
- **Provenance chip.** `teal` background tint, 12px text, an icon indicating source surface (Web/Chrome/extension/Desktop) plus relative age — "from Chrome, 3 days ago." This is, per the base plan's own words, *the differentiator*, and it is built as a first-class component precisely so it can appear identically in Chat responses, Plan steps, and the Memory sidebar view, never re-implemented per surface.
- **Plan-step card.** Numbered, collapsed-by-default with file path and one-line reasoning visible; expands to full diff preview. Checkbox-style approval per step, plus one "Approve all" primary action — exactly one primary CTA per the visual-hierarchy rule.
- **Approval card (Tier 3).** The one component permitted real elevation (§5.1). Amber (`signal`) left-border accent — the one place `signal` is used as more than a button fill, and still ≤10% of the card's surface, per the base plan's own constraint on that color. States: pending, approved, declined, executed, failed.
- **Mode switcher.** A three-segment control, Chat/Plan/Agent, `raised` background, `signal` underline on the active segment — the single CTA-colored element always visible in the view.
- **Model picker.** Lives in the same header row as the mode switcher, right-aligned; shows the active Bedrock model (e.g., "Nova Pro") with a dropdown for alternatives once the real catalog lands (base plan's own open item from D2).
- **Empty/loading/error states**, per view, matching the Audit pane's already-good example (base plan §4.4.6):
  - Agent view, no session: "Start a conversation, a plan, or a task — pick a mode above."
  - Memory view, unlinked project: "Sign in and link a project to see what WalkCroach remembers." (primary CTA)
  - Plan mode, no plan yet: "Describe what you want built. WalkCroach will propose a plan before touching anything."

### 5.3 Motion spec

- **Message entrance:** stagger 60ms between the eyebrow/mode-tag and the bubble body — an orchestrated pair, not two independent fades (framer-motion-micro-interactions' orchestration-over-scattered-effects principle).
- **Streaming text:** token-by-token reveal via a lightweight CSS-only technique (no per-token Framer Motion instance — that's the "reach for CSS first" case the skill calls out directly).
- **Approval card reveal:** spring physics (`type: "spring"`, moderate stiffness) — this is exactly the "feels tactile, worth the weight" case the skill reserves spring for, appropriate given it's the highest-stakes UI moment in the product.
- **Plan-step expand/collapse:** 200ms `easeOut`, no spring — a simple disclosure, not an interactive gesture.
- **Reduced motion:** entrance animation only, capped under 300ms, respecting `prefers-reduced-motion` — already an explicit commitment in the base plan (§4.4.6) and unchanged here.

### 5.4 Accessibility

- Every text/background pairing in both Graphite Lumen themes checked against WCAG 2.2 AA at minimum (4.5:1 body text, 3:1 large text and UI borders) before shipping, not eyeballed — this matters more than usual on a dark theme, where the legacy contrast ratio is known to mis-score thin/light weights; APCA is used as the real target where tooling supports it, per accessibility-contrast-standards.
- Tier 3 approval cards never rely on the `ember`/`signal` color distinction alone — each carries an explicit icon and text label ("Requires approval," "Approved," "Declined") so the color-alone failure mode never applies to the single highest-stakes UI surface in the product.
- The mode switcher and approval actions are fully keyboard-operable (Tab/Enter/Arrow), with a visible focus ring meeting the 3:1 UI-component floor — a real gap risk in a webview if focus styles aren't deliberately carried over from the workbench's own outline conventions.

---

## 6. Phases, fleshed out

This replaces the base plan's D2/D2.5 with the detail above folded in, and sharpens D1/D3–D6 with concrete subtasks the original left implicit.

### D1 — Bump the pin and prove the fork builds (unchanged in intent, sharpened in scope)
- Bump to 1.131 (adds subagent visibility and git-worktree isolation per session — both directly relevant to §4.3's sub-agent surfacing).
- Full compile, Windows and macOS, wall-clock and artefact size recorded.
- **New subtask:** confirm the built-in Chat view and Agents window command *can* be suppressed cleanly at this pin — a five-minute spike now avoids discovering a suppression API change mid-D2.

### D2 — Native module (fully re-scoped per §§3–5 above)
- Suppress the three stock UI entry points (§3.1).
- Build `agentBridge.ts` (§3.2) — the direct-reference glue, no `AgentService` generic lookup.
- Port/evolve the IDE extension's webview UI into the new `WebviewView` (§3.3), building the component inventory (§5.2) as reusable, variant-driven pieces from day one rather than per-screen.
- Implement the three-mode switch (§4) with the tiered approval model (§4.3) wired to real tool-registry gating, not UI-only hiding.
- **Exit criterion (revised, §3.4):** a full session — Chat → Plan → approved plan → Agent execution with at least one Tier 3 approval — runs entirely inside the WalkCroach sidebar, with the Chat view and Agents window absent from the build.

### D2.5 — Visual polish (folded forward from the base plan, now with a concrete spec to execute against)
- Logo asset production (§4.4.4 of the base plan — still a blocking design-asset dependency, unchanged).
- Ship both Graphite Lumen themes with the dark variant as `defaultColorTheme`.
- Empty/error/loading states per §5.2, contrast-audited per §5.4.

### D3 — `DesktopHostAdapter` over workbench services (unchanged from the base plan, now consumed by the native module rather than a hypothetical stock UI)
- `readFile`/`writeFile` via `ITextModelService`, `search` via `ISearchService`, `runTerminal` via `ITerminalService`, `showDiffPreview` via the workbench diff editor, `secrets` via `safeStorage`.
- **New subtask:** `agentBridge.ts` (D2) is the single place these services are injected — D3's work is implementing the adapter methods, not re-solving the injection question a second time.

### D3.5 — Local index and durable-tier sync (unchanged from base plan §4.5) plus one addition
- **New subtask:** the Memory sidebar view (§5.2) is the first consumer of `wc.memory.asOf` in a rendered UI, not just a backing capability — build the `AS OF SYSTEM TIME` scrubber as a real, usable control here rather than deferring it to D4.

### D4 — Memory, natively (unchanged in substance; UI now specified)
- `crdbPanel.ts` becomes the CockroachDB panel per the base plan's IA (§4.4.2) — Schema/Query/Audit/ccloud/Telemetry, tabular and log-shaped, in the panel; Memory and Skills in the sidebar, browse-and-select, per the same IA decision.
- Provenance chip (§5.2) is the same component in the Memory sidebar view, Chat-mode responses, and Plan-mode steps — one implementation, three call sites.

### D5 — Sessions that outlive the window (unchanged — this remains the differentiator demo moment, now demoed through the native module rather than an upstream picker)

### D6 — Distribution (unchanged)

---

## 7. Risks — additions to the base plan's table

| Risk | Why it bites | Mitigation |
|---|---|---|
| **Suppressing stock UI entry points touches more than the two/three permitted upstream hooks** | Contribution-point suppression may require touching a file beyond `product.json` and the two existing import sites | Spike this in D1 (see D1's new subtask) before D2 commits to a specific mechanism; if a fourth touch is genuinely required, record it explicitly the same way the D2 provider-registration touch was recorded in the base plan, rather than making it silently |
| **Webview-native message bridge adds a second protocol to maintain** (AHP between workbench and Agent Host, plus postMessage between webview and workbench) | Two integration seams instead of one | Keep the postMessage envelope intentionally thin and versioned; all real logic stays in `agentBridge.ts` and the AHP adapter, never duplicated in the webview |
| **Divergence from the IDE extension's webview codebase over time** | Two products evolving "the same" UI independently | Treat the IDE extension's webview package as the shared source; Desktop's `WebviewView` content should import from it rather than fork it, where the workbench-vs-extension-API difference allows |
| **Assisted-Permissions-equivalent risk evaluation itself becomes a new trust surface** | The model deciding what counts as "low risk" is itself a decision users need to trust | Tier 3's list (§4.3) is explicit and static, not model-judged — only the Tier 1/2 boundary is risk-evaluated; the non-negotiable floor is never assessed by the model itself |

---

## 8. Success criteria — additions to the base plan's list

7. **Zero stock chat/agent UI surfaces are reachable in the shipped build** — no Chat view icon, no Agents window command, verified by a scripted check (grep the built product for the suppressed contribution/command ids) as part of CI, not a manual QA pass.
8. **A full Chat → Plan → Agent session, including one Tier 3 approval, completes entirely within the WalkCroach sidebar** — this is D2's revised exit criterion (§3.4), restated here because it is also the demo that answers "why does this look like a competitive end product" in one continuous flow.
