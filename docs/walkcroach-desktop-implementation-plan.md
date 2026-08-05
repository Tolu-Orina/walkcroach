# WalkCroach Desktop IDE — Implementation Plan (native agent)

**Written:** 2026-08-05 · **Status:** Active — supersedes the archived Phase A–F plan
**Repo:** sibling `walkcroach-desktop/` · **Companion:** [`walkcroach-sdk-implementation-plan.md`](./walkcroach-sdk-implementation-plan.md)

---

## 0. The finding that changes this plan

**VS Code shipped an Agent Host in 1.130 (2026-07-22), and the fork is pinned to 1.129.0.**

The pin predates it by one release. That single fact reorders everything below, because the thing Phase B set out to build — a bespoke native agent runtime living in the fork — is now a first-class extension point in upstream Code OSS.

What the Agent Host is:

- **A dedicated process** for agent harnesses, separate from the extension host. Upstream ships adapters for Copilot, Claude and Codex.
- **Spoken to over the Agent Host Protocol (AHP)** — an open, agent-agnostic JSON-RPC protocol Microsoft develops in the open at `microsoft/agent-host-protocol`. Message ports for local IPC; JSON-RPC over WebSocket for remote.
- **Authoritative session state**, synchronised to every connected client through URI-addressed channels (sessions, chats, terminals, changesets), immutable state, pure reducers `(state, action) → newState` that run identically on server and client, and write-ahead reconciliation for optimistic local application.

What it gives us that an extension cannot, in upstream's own words:

| Capability | Why it matters for WalkCroach |
|---|---|
| Agents run in their own process, **not blocked by busy extensions** | This is the real performance argument — see §2 |
| **Multiple clients observe and control one session** | Two windows, or Desktop plus a remote client, on the same run |
| **A session continues with no client connected** | Close the laptop lid; the run survives |
| **Remote execution** — sessions run near the workspace | The same adapter serves local Desktop and a remote workspace |

**So the native route is now: ship a WalkCroach AHP adapter, not a bespoke fork runtime.** That is the same bet the SDK already made — *don't own the loop, own the thing that makes your loop worth using* — applied one layer down.

---

## 1. Where Desktop actually is

The README marks Phases 0–F "✅ **Structural**". That word is load-bearing: it means `phase*-verify.mjs` passes on scaffolding, not that the fork compiles and ships. The ecosystem master doc is blunter — *"Core native agent / full fork compile were not a shipped product."*

What genuinely exists:

- A real nested Code OSS clone at `vscode/` (tag `1.129.0`, commit `125df46…`, Electron `42.6.0`, Node 24.18.0) with its own `.git`.
- `packages/desktop-agent/` — a Node `desktopHostAdapter.ts`, `ideClient.ts`, `crdbPanel.ts`, `session.ts`, `memorySecrets.ts`. A **fourth** `HostAdapter` implementation, alongside VS Code, CLI, and the SDK's `SandboxHostAdapter`.
- Product overlay (`product.walkcroach.json`: `applicationName: walkcroach`, `urlProtocol: walkcroach`), Open VSX only, curated recommendations, surface-area allowlist.
- Upstream sync cadence tooling, phase verifiers, interim Windows portable distribution, crash Lambda.

The discipline in place is genuinely good and should be kept: **fork-only code lives solely under `vscode/src/vs/workbench/contrib/walkcroach/`**, with the only permitted upstream touches being `product.json` and a single import in `workbench.common.main.ts`. That constraint is what makes a ≤14-day upstream sync survivable, and §5 leans on it hard.

---

## 2. Performance: what is actually faster, and what is not

The premise for going native is performance. It is worth being precise, because one common assumption is wrong.

**Not faster: raw IPC.** VS Code's IPC is fast, it batches and throttles high-frequency events like text changes, and the transport is almost never the bottleneck — the work being done is. A round trip to the extension host is not what makes an agent feel slow.

**A VSIX inside our own fork is not faster than the same VSIX in stock VS Code.** Same extension host, same API, same process boundaries. Forking buys nothing on its own.

**What genuinely is faster or only-possible natively:**

1. **Head-of-line blocking disappears.** An extension host shared with a dozen third-party extensions is exactly where an agent stalls — a synchronous linter or a busy language server delays *our* event loop. The Agent Host's own process removes that class of stall. This is the single biggest real win.
2. **Direct access to workbench services**, with no serialisation: `ITextModelService` for in-memory buffers including unsaved edits, `ISearchService` for the same ripgrep index the editor uses, `ITerminalService` for real terminals, `IEditorService` for the actual editor state. The extension API exposes narrowed, copied views of these.
3. **Session survives the window.** An extension dies with its host; an Agent Host session does not.
4. **Multi-window and remote** come free from AHP rather than being rebuilt.
5. **Startup.** Code OSS has been ESM since 1.94, which cut workbench bundle size >10% and materially improved startup. A native contribution participates in that; it must also not squander it — see §4.3.

Honest counterweight: **the model call dominates.** A Bedrock turn is hundreds of milliseconds to seconds. No amount of native access changes that. The wins above are about *latency under load*, *capability*, and *not stalling* — not about making inference faster. Any performance claim we publish should say so.

---

## 3. Target architecture

Three layers, each with a job it is uniquely suited to.

```
┌──────────────────────────────────────────────────────────────┐
│ WalkCroach Desktop (Code OSS fork, Electron)                 │
│                                                              │
│  workbench/contrib/walkcroach/       ← UI only               │
│    · chat/agents surface, CockroachDB panels, memory views   │
│    · status bar, commands, settings                          │
│                          │ AHP (message port)                │
│                          ▼                                    │
│  Agent Host process                  ← the runtime            │
│    · @walkcroach/ahp-adapter                                  │
│         wraps @walkcroach/agent-engine                        │
│         DesktopHostAdapter implements HostAdapter             │
└──────────────────────────────────────────────────────────────┘
                           │ HTTPS
                           ▼
              /v1 + /ide/v1  →  CockroachDB memory
```

### 3.1 What goes where

| Layer | Contents | Rule |
|---|---|---|
| **AHP adapter** (Agent Host process) | `agent-engine` loop, tools, skills, hooks, checkpoints, memory bridge | All agent logic. No `vscode` imports — the engine already forbids them |
| **Workbench contribution** (fork) | Chat/agents UI, CockroachDB panels, memory inspector, commands | Presentation and workbench service access only. No agent logic |
| **Extension (VSIX)** | Nothing new | Stays as-is for *stock* VS Code and Cursor. Desktop does not load it |

The last row matters: **Desktop must not run both.** Two agents means two auth sessions and two memory writers racing on `source_surface`. Desktop ships with the native path and the WalkCroach VSIX explicitly not bundled.

### 3.2 `DesktopHostAdapter` is the fourth host, and the cheapest one

`packages/desktop-agent/desktopHostAdapter.ts` already exists. Its job under this plan is narrower than originally scoped: implement `HostAdapter` against workbench services reached over AHP, rather than reimplementing an agent.

We now have four implementations of one interface — VS Code extension, CLI, SDK sandbox, Desktop. That is a strong signal the abstraction is right, and a standing obligation: **any change to `HostAdapter` costs four edits.** Prefer optional members.

---

## 4. Phases

Numbered afresh; the old Phase A–F lettering is retired to avoid implying the structural verifiers cover this work.

### D1 — Bump the pin and prove the fork builds *(the real Phase 0)*

Everything else is blocked on this, and it is unstarted despite "Phase A ✅".

- Move the upstream pin **1.129.0 → 1.131** (or newest stable at execution). 1.130 brings the Agent Host; 1.131 adds subagent visibility, the hybrid Markdown editor in the Agents window, and git-worktree isolation per session.
- Full compile of the fork on Windows and macOS. Record wall-clock build time and artefact size — both feed §7.
- Re-run `apply:product` and the surface-area allowlist audit against the new pin.
- **Exit criterion:** a launchable WalkCroach-branded build from a clean checkout, on two platforms, documented as a repeatable command.

### D2 — AHP adapter skeleton

- New package `packages/ahp-adapter/`, depending on `@walkcroach/agent-engine` and `@walkcroach/sdk` (for memory).
- Implement the AHP server interface: channel registration for `sessions`, `chats`, `terminals`, `changesets`; reducers; write-ahead reconciliation.
- Register with the Agent Host so `code agent host` and the in-app Agents window both find it.
- **Exit criterion:** a WalkCroach session appears in the Agents window beside Copilot/Claude/Codex, accepts a prompt, and streams a reply.

*Unknown to resolve first:* the public AHP docs cover the protocol but not the adapter interface. Before committing to the shape, read `microsoft/agent-host-protocol` directly and the upstream Claude/Codex adapters — the concrete question is what a third-party runtime must implement, and how tools, permissions and approvals are represented.

### D3 — `DesktopHostAdapter` over workbench services

Implement `HostAdapter` against the Agent Host's channels, then widen to the services an extension cannot reach:

- `readFile`/`writeFile` via `ITextModelService` — **including unsaved buffers**, which the extension API cannot see reliably
- `search` via `ISearchService` — the editor's own ripgrep index, not a re-scan
- `runTerminal` via `ITerminalService` — real integrated terminals, with the existing PTY fallback removed here
- `showDiffPreview` via the workbench diff editor and the 1.130 compact-diff/changeset surface
- `secrets` via Electron `safeStorage`, OS keychain-backed

**Exit criterion:** the `agent-engine` conformance suite passes against `DesktopHostAdapter` exactly as it does for the VS Code and CLI hosts.

### D4 — Memory, natively

- Reuse `@walkcroach/sdk` rather than re-implementing recall/remember. Desktop becomes an SDK consumer — the same dogfooding argument that applies to the Web builder.
- `source_surface = 'desktop'` on every write (already the documented convention).
- CockroachDB panels (`crdbPanel.ts`) become a real workbench view: memory timeline, supersede chains, and the `AS OF SYSTEM TIME` scrubber that `wc.memory.asOf` already backs.
- **Exit criterion:** a decision written in Chrome is recalled in Desktop, and vice versa, with `source_surface` visible in the panel.

### D5 — Sessions that outlive the window

The Agent Host's differentiator, and the demo moment:

- Start a run, close the window, reopen — the session is still going and reattaches.
- Two windows on one session, staying in sync.
- Git-worktree isolation per session, matching 1.130's worktree support.
- **Exit criterion:** a run survives a window close and a full app restart.

### D6 — Distribution

- Replace the unsigned interim Windows portable with signed builds; macOS notarisation; auto-update against the existing `infra/` update CDN.
- Crash reporting through the existing crash Lambda.
- **Exit criterion:** a signed installer on Windows and macOS, updating itself from one build to the next.

---

## 5. Upstream sync — the thing that kills forks

A fork's long-run cost is rebase pain, and it is paid every two weeks forever. The existing rules already encode the right instinct; this plan tightens them.

1. **Fork-only code stays under `vscode/src/vs/workbench/contrib/walkcroach/`.** Anything outside it is a conflict waiting to happen.
2. **Exactly two permitted upstream touches**: `product.json`, and one import line in `workbench.common.main.ts`. If a third is ever needed, it is a design smell — solve it with a service registration instead.
3. **Keep agent logic out of the fork entirely.** This is the strongest lever available. Code in `packages/ahp-adapter/` never conflicts with upstream, because it is not upstream's file. The less that lives under `vscode/`, the cheaper every sync is — which is a second, independent argument for the Agent Host route beyond performance.
4. **Sync ≤14 days**, tracked in `cadence/`, with `sync:upstream:dry` first.
5. **Pin bumps get a changelog entry** naming the upstream tag, so a regression can be bisected against a version rather than a date.

---

## 6. What we deliberately do not build

- **A second agent loop.** `agent-engine` is the loop, as it is for the IDE extension, CLI, and SDK.
- **A Microsoft Marketplace proxy.** Open VSX only — a licensing line, not a technical one.
- **Our own inline-completion model.** Out of scope; Desktop is an agent surface.
- **A bespoke session protocol.** AHP exists, is open, and upstream maintains it.
- **Loading the WalkCroach VSIX inside Desktop.** See §3.1.

---

## 7. Risks

| Risk | Why it bites | Mitigation |
|---|---|---|
| **AHP adapter interface is under-documented publicly** | D2 is blocked on a shape we cannot yet see | Read the repo and upstream's own Claude/Codex adapters before designing. Treat D2 as a spike first |
| **AHP is young** (public since early 2026, shipped 1.130) | Breaking changes are likely | Isolate the protocol behind our own interface; the engine must not learn AHP types |
| **Fork has never fully compiled here** | "Structural ✅" hides it; D1 could be days, not hours | D1 is first and gated on two platforms |
| Upstream pin is behind | Agent Host is unavailable at 1.129 | D1 bumps to ≥1.130 |
| **Four `HostAdapter` implementations** | Every interface change costs four edits | Prefer optional members; run the conformance suite against all four |
| Code signing cost and lead time | Blocks D6, not D1–D5 | Sequenced last; interim unsigned build already exists |
| Electron/Node version drift | Native modules (`node-pty`) break across Electron majors | Pin and test on bump; prefer `ITerminalService` over `node-pty` (D3 removes that dependency) |
| **Auth redirect scheme** | `urlProtocol: walkcroach` means `walkcroach://…`, which Cognito has never seen | Register the Desktop redirect URI on the app client. Cheap, but a hard blocker on first sign-in |

---

## 8. Success criteria

Desktop is a shipped surface — not "structural" — when all of these hold:

1. A signed build installs on Windows and macOS from a documented command.
2. A WalkCroach session runs in the Agent Host, visible in the Agents window.
3. `DesktopHostAdapter` passes the same `agent-engine` conformance suite as the other three hosts.
4. A memory written from Chrome or Web is recalled in Desktop, tagged `source_surface=desktop` on write-back.
5. A run survives closing the window and reopening it.
6. An upstream sync has been performed against a newer tag **after** the fork code landed, with the conflict count recorded.

Criterion 6 is the one that separates a fork that ships from a fork that rots.
