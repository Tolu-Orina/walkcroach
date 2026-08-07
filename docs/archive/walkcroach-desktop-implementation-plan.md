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

The discipline in place is genuinely good and should be kept: **fork-only code lives solely under `vscode/src/vs/workbench/contrib/walkcroach/`**, with a hard allowlist of upstream touches (see §5 — three hooks as of D2, not two). That constraint is what makes a ≤14-day upstream sync survivable.

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

### D2 — provider registration *(unknown resolved 2026-08-05)*

The plan said to read `microsoft/agent-host-protocol` before designing. Better
source found: **upstream's own adapters ship in the tree we cloned**, so this is
settled from primary source rather than docs.

**The contract is `IAgent`, not raw AHP.** A third-party runtime implements
`IAgent` (`src/vs/platform/agentHost/common/agentService.ts:1481`) and is handed
to `AgentService.registerProvider`. AHP is the wire protocol *between* the host
and its clients; a provider sits behind it and never speaks it directly. That is
a materially smaller and better-defined job than implementing an AHP server.

| Interface | Required | Optional |
|---|---|---|
| `IAgent` | **20** | 26 |
| `IAgentChats` | **8** | 0 |

Required `IAgent`: `id`, `onDidSessionProgress`, `chats`, `createSession`,
`resolveSessionConfig`, `sessionConfigCompletions`, `getSessionMessages`,
`disposeSession`, `respondToPermissionRequest`, `respondToUserInputRequest`,
`getDescriptor`, `models`, `listSessions`, `getProtectedResources`,
`authenticate`, `getOrCreateActiveClient`, `removeActiveClient`,
`onClientToolCallComplete`, `shutdown`, `dispose`.

Required `IAgentChats`: `createChat`, `fork`, `disposeChat`, `sendMessage`,
`abort`, `changeModel`, `changeAgent`, `getMessages`.

`AgentProvider` is just `string`, with `'claude'` and `'codex'` as well-known
ids — so `'walkcroach'` needs no upstream type change.

**Registration site** — `node/agentHostMain.ts:240`:

```ts
agentService.registerProvider(instantiationService.createInstance(CopilotAgent));
// Claude and Codex are additionally gated on an enable env var + SDK reachability
```

#### The cost, measured

| Implementation | Lines |
|---|---|
| `mockAgent.ts` (upstream's test double — the floor) | **1,011** |
| `claudeAgent.ts` | 2,166 |
| `codexAgent.ts` | 4,194 |
| `copilotAgent.ts` | 4,210 |

**A provider is not a skeleton.** Even a mock that does nothing real is a
thousand lines, because 28 members must exist and be type-correct. Real adapters
are 2–4× that, plus supporting services (proxy, SDK service, provider
configuration). Any estimate that treated D2 as "a day's scaffolding" was wrong.

#### This needs a third upstream touch

The documented fork rule permits exactly two: `product.json` and one import in
`workbench.common.main.ts`. Registering a provider requires a line in
`node/agentHostMain.ts`.

It stays within the *spirit* of the rule — one import plus one call, in a file
whose surrounding lines are stable registration boilerplate — but it is a change
to a written constraint and is recorded here rather than made silently. Revised
allowance: **three** hooks, the third being provider registration in
`agentHostMain.ts`. §5's argument still holds: everything else lives in
`packages/ahp-adapter/`, which upstream never touches.

#### Not the same thing: the local AHP endpoint

`LOCAL_ENDPOINT.md` documents a WebSocket endpoint (named pipe on Windows) that
lets *external processes drive VS Code's agents* as AHP clients. That is the
opposite direction from registering a runtime and does not avoid the upstream
touch. Worth knowing about for a future "drive Desktop from the SDK" feature.

### D2 (build) — provider skeleton

- New package `packages/ahp-adapter/`, depending on `@walkcroach/agent-engine` and `@walkcroach/sdk` (for memory).
- Implement the AHP server interface: channel registration for `sessions`, `chats`, `terminals`, `changesets`; reducers; write-ahead reconciliation.
- Register with the Agent Host so `code agent host` and the in-app Agents window both find it.
- **Exit criterion (revised 2026-08-05):** retired — Agents window is Microsoft-allowlisted and will not list WalkCroach. See [`walkcroach-desktop-native-agent-module.md`](./walkcroach-desktop-native-agent-module.md) §3.4: a full session runs inside the WalkCroach sidebar Agent view with stock Chat/Agents chrome suppressed.

### D2 (verify) — **BLOCKED.** Registered in the host, never renders in the UI

*Status as of 2026-08-05. This section is written to be read standalone, away
from the codebase, as the brief for focused research.*

#### The one-line problem

`WalkCroachAgent` registers successfully in the Agent Host process, is published
to the renderer, and the renderer acts on it — yet **no agent-host harness
appears in any picker in the UI**, ours or upstream's. Copilot and Claude are
equally absent. That last fact is the most important clue in this section: this
is very likely *not* a WalkCroach-specific defect.

#### What is proven, with evidence

| # | Claim | Evidence |
|---|---|---|
| 1 | The fork builds and runs | Dev launch clean; `[CSS_DEV] DONE, 421 css modules`; only unrelated error is `vscode.mermaid-markdown-features` needing `chatParticipantPrivate` |
| 2 | Our provider registers in the host | `agenthost.log`: `Registering agent provider: walkcroach` — first of three, before `copilotcli` and `claude`, no error |
| 3 | The host publishes agents to the renderer | `renderer.log` repeats `[AgentHost] No token resolved for resource: https://api.github.com`, emitted only from `_authenticateWithServer(allowed)`, which runs **only** inside `_handleRootStateChange` → `rootState.agents` arrived non-empty |
| 4 | Renderer↔host transport is healthy | `AgentHostProcessManager: agent host started`; `[AgentHost:renderer] Protocol connection established; clientId=…`; `[ProtocolServer] Initialize: protocolVersions=[0.7.0]` |
| 5 | `chat.agentHost.enabled` is on | `AppData\Roaming\code-oss-dev\User\settings.json` sets it `true` |
| 6 | No renderer-side registration code is needed | `agentHostChatContribution.ts:216` derives `agent-host-${agent.provider}` generically; `_shouldAdvertiseAgent` returns `true`; `iconForAgentProvider` falls back to the provider icon |

#### Dead ends — ruled out with evidence, do not re-investigate

- **Missing `out/nls.messages.json`.** Red herring. `bootstrap-esm.ts:281`
  short-circuits on `VSCODE_DEV` (*"no NLS support in dev mode"*) and the catch
  at :290 only logs. Dev builds never have this file.
- **`chat.agentHost.enabled` defaulting false.** Real (`agentHostEnablementService.ts:45`
  is `!isWeb && product.quality !== 'stable'`, and our overlay sets
  `quality: "stable"`), but *already overridden* in user settings, so it is not
  the current blocker. Still needs a fork-shipped default — see Open items.
- **"Renderer has no chat session type for `agent-host-walkcroach`".** My earlier
  hypothesis, wrong. Registration is fully automatic (row 6 above).
- **The `unknown chat session type` warning.** Not a signal. It fires identically
  for `agent-host-copilotcli` and `local`, and only at shutdown, after
  `Extension host … exited with code: 0`. Shutdown-ordering noise.
- **`shouldSurfaceLocalAgentHostProvider` suppressing us.** Its `default:` branch
  returns `true`; only `claude` and `codex` are gated.

#### Fix applied (necessary; sufficiency unconfirmed)

`WalkCroachAgent.models` was `observableValue([])`, justified in a comment as
"the truthful answer". **That reasoning was wrong.** Per
`sessionTypeAvailability.ts:73-86`, a harness resolves to `Available` only if
`hasModelsTargetingSessionType(...)` or `supportsAutoModelForSessionType(...)`;
the former requires a registered language model whose `targetChatSessionType ===
'agent-host-walkcroach'`, and those models are registered by
`AgentHostLanguageModelProvider` from *exactly that observable*. An empty catalog
does not render an honest "no models yet" state — it renders the harness
unusable. Copilot escapes this only via its "Auto" fallback.

Now advertises one model (`amazon.nova-pro-v1:0` / "Nova Pro"), optional
context/token limits omitted rather than invented, `supportsVision: false` until
images are plumbed. Typecheck clean, compiled, verified present in
`out/…/walkcroachAgent.js`. **It did not change the observed behaviour.**

Note the tension to resolve: that same function's doc comment says unavailable
harnesses are *"greyed out in the picker"* — **listed, not hidden**. Ours was
never listed at all. So either the picker filters before availability is
computed, or the surface being looked at is not the one that lists harnesses.

#### The strongest remaining hypothesis

**We may have been looking at the wrong surface the entire time.** Every
observation came from a *regular editor window* (`window1`,
`environmentService.isSessionsWindow === false`). Its activity bar has no
Sessions/Agents entry at all. Per the VS Code 1.130 docs, once the agent host is
enabled *"you pick a harness from the dropdown in either the editor window or the
Agents window"* — and the **Agents window is a separate window**, which we never
successfully opened. The command to open it was not found in
`src/vs/sessions/contrib/sessions/browser/`.

Corroborating: `chat.agents.claude.preferAgentHost` (Agents-window scope) was
set, but the regular window reads `chat.editor.claude.preferAgentHost`, which
was not — exactly why Claude was missing from *this* window. Adding it did not
surface Claude either, which is itself informative.

#### Questions for the focused research pass

1. **How is the Agents window actually opened** in 1.131 — command id, menu path,
   or CLI flag? Does it require `product.json` fields our overlay drops?
2. Does the **editor-window chat harness dropdown** (`</> Agent`) enumerate
   agent-host providers at all, or only extension-contributed chat participants?
3. Does an agent-host harness require a **`chatSessions` contribution point** or
   entitlement that only Copilot-signed-in users get? Note `SignInRequired` in
   `sessionTypeAvailability.ts` and that this build is **signed out** ("Sign In"
   visible top-right, `[AccountPolicyGate] state=inactive`).
4. Is `IChatSessionsService.getChatSessionContribution(type)` returning
   `undefined` for `agent-host-*`? If so `getSessionTypeAvailability` returns
   `Available` early (:62) and availability is a dead end entirely.
5. Does `product.quality: "stable"` gate anything **beyond** the enablement
   default — e.g. hiding preview/experimental UI wholesale?

#### Reproduce

```powershell
# Node 24.18.0 MUST be on PATH first (see Build gotchas below)
$env:PATH = "C:\Users\toluo\AppData\Roaming\fnm\node-versions\v24.18.0\installation;$env:PATH"
cd C:\Users\toluo\dev\walkcroach\walkcroach-desktop\vscode
npm run compile-client                      # ~3.7 min
```
```bash
# Launch: ELECTRON_RUN_AS_NODE must be cleared, and it must be backgrounded
env -u ELECTRON_RUN_AS_NODE ./scripts/code.bat &
```
Logs: `C:\Users\toluo\AppData\Roaming\code-oss-dev\logs\<timestamp>\` —
`agenthost.log` (registration) and `window1\renderer.log` (bridge).

#### Build gotchas that cost real time — read before rebuilding

- **Node 24.18.0 is mandatory and is not the default.** `.nvmrc` pins it; fnm has
  it; but a plain shell resolves `node` to system **v22.16.0**, which cannot run
  the repo's `.mts` build scripts (`ERR_UNKNOWN_FILE_EXTENSION`). Two builds were
  lost to this. `fnm exec --using 24.18.0 -- npm …` does **not** work either —
  fnm cannot spawn npm's `.cmd` shim. Prepend the installation dir to `PATH`.
- **`compile-client` begins with `clean-out`.** A running instance whose `out/`
  is being wiped renders a **completely blank window**. Never reload mid-build.
  Both "blank UI" incidents were this, not a code fault.
- **Launch via `scripts/code.bat`, never the `.exe` directly.** `code.bat:27`
  sets `VSCODE_DEV=1`; without it the app runs in production mode against a dev
  `out/` and shows a blank window plus a genuine NLS error.
- **`ELECTRON_RUN_AS_NODE=1` leaks in from Electron-based terminals** and makes
  the app start as plain Node (`SyntaxError: … 'electron' does not provide an
  export named 'Menu'`). Verify with `WalkCroach.exe --version`: `v24.18.0` means
  poisoned, `v42.7.0` means correct.
- **Background the launch.** A foreground launch is killed with its process group
  when the shell call returns.

#### Open items carried forward

- Ship `chat.agentHost.enabled: true` from the fork rather than a hand-edited
  `settings.json`, without adding a 4th upstream hook (candidate: a default
  override from our own configuration contribution — registration order must be
  *confirmed*, not assumed).
- Decide the model catalog for real once the engine lands in D3; the current
  single Nova Pro entry is a placeholder that makes the harness selectable.

### D3 — `DesktopHostAdapter` over workbench services

Implement `HostAdapter` against the Agent Host's channels, then widen to the services an extension cannot reach:

- `readFile`/`writeFile` via `ITextModelService` — **including unsaved buffers**, which the extension API cannot see reliably
- `search` via `ISearchService` — the editor's own ripgrep index, not a re-scan
- `runTerminal` via `ITerminalService` — real integrated terminals, with the existing PTY fallback removed here
- `showDiffPreview` via the workbench diff editor and the 1.130 compact-diff/changeset surface
- `secrets` via Electron `safeStorage`, OS keychain-backed

**Exit criterion:** the `agent-engine` conformance suite passes against `DesktopHostAdapter` exactly as it does for the VS Code and CLI hosts.

### D3.5 — Local index in the Agent Host, and durable-tier sync

Detail in §4.5. Scope:

- Move `local-index.ts` ownership into the AHP adapter; index lifetime follows the
  session, not the window.
- Implement the three-tier split — code chunks local-only, episodic distilled,
  durable synced both ways.
- Client-generated ids on buffered writes so offline replay is idempotent.
- Hybrid retrieval: `ISearchService` for exact, the local index for semantic.
- **Measure `semantic_search` latency on a real repo before considering
  `sqlite-vec`.** The brute-force scan may be fine; a native extension per
  platform is not free on a fork that already rebuilds 12 native modules.

**Exit criterion:** a decision recorded offline in Desktop appears in CockroachDB
after reconnect, exactly once, with `source_surface='desktop'`; and a decision
written in Chrome is recalled in Desktop.

### D4 — Memory, natively

Detail in `walkcroach-desktop/docs/phase-D4/PLAN.md`.

- Reuse the **SDK capability surface** (`asOf` / `diff` / `remember` / `recall`) via
  `/ide/v1/memory` backed by the same agent-harness as `@walkcroach/sdk` — Desktop
  dogfoods the memory contract without bundling the npm package into `contrib/`.
- `source_surface = 'desktop'` on every write (already the documented convention).
- Memory inspector (sidebar): timeline, supersede chains (diff retired/added), and
  the `AS OF SYSTEM TIME` scrubber.
- IA: Memory (+ Skills) on WalkCroach sidebar; CockroachDB panel = Schema / Query /
  Audit / ccloud / Telemetry.
- **Exit criterion:** a decision written in Chrome is recalled in Desktop, and vice
  versa, with `source_surface` visible in the panel.

### D5 — Sessions that outlive the window

The Agent Host's differentiator, and the Path B Agents Window milestone.
**Detail plan:** [`walkcroach-desktop/docs/phase-D5/PLAN.md`](../../walkcroach-desktop/docs/phase-D5/PLAN.md).
**Status:** complete (D5.0–D5.4).

- Start a run, close the window, reopen — the session is still going and reattaches.
- Two windows on one session, staying in sync.
- Git-worktree isolation per session + fleet UI (tabs/grid) per fleet-primitives §3.
- Soft cap ≤6 concurrent fleet members with explicit “run more anyway”.
- Path B Agents Window = `WalkCroachAgentsEditorPane` (not Microsoft `vs/sessions`).
- **Exit criterion:** a run survives a window close and a full app restart.

Slices: **D5.0** URI reattach → **D5.1** disk session-store → **D5.2** worktree tools → **D5.3** parallel launcher + soft cap → **D5.4** Agent Tabs/grid + Agents editor.

### D6 — Distribution

- **D6.0 (now, $0):** unsigned Windows portable preview — engine-bundle, inject media, zip + `SHA512SUMS`, GitHub Releases as `insider`. See `walkcroach-desktop/docs/phase-D6/PLAN.md`.
- **D6.1+ (budget):** replace interim with signed builds; macOS notarisation; auto-update against `infra/` update CDN; crash reporting through crash Lambda.
- **Exit criterion (full D6):** a signed installer on Windows and macOS, updating itself from one build to the next.
- **Interim exit (D6.0):** publishable unsigned Windows zip + checksums + install notes that do not claim signing.

---

## 4.4 Information architecture and UI

Not previously in this plan — a genuine gap, because a fork's surface *is* the
product and the current structure reads as two unrelated features rather than one.

### 4.4.1 What it looks like today

| Container | Location | Order | Icon | Views |
|---|---|---|---|---|
| WalkCroach | Sidebar | 10 | `Codicon.database` | Agent, Import, Incompatibles |
| CockroachDB | Panel | 11 | `Codicon.serverProcess` | Schema, Query, Audit, Memory, ccloud, Skills, Telemetry |

Three problems:

1. **They read as peers, not parent and child.** Nothing in the UI says
   CockroachDB is part of WalkCroach; they are two entries competing for the
   same attention.
2. **The icons are inverted.** The *agent* container wears `Codicon.database`
   while the *database* container wears `serverProcess`. That is the cylinder in
   the activity bar meaning the opposite of what a user would assume.
3. **Ten flat views**, split 3/7, with the heavier half in the panel and no
   grouping in either.

### 4.4.2 Target: one product, one place

**One activity-bar entry — WalkCroach.** Everything is reachable from it, and
CockroachDB is visibly a part of it rather than a sibling.

The split between sidebar and panel is kept, but by *shape of the work* rather
than by feature:

| Surface | Views | Why here |
|---|---|---|
| **Sidebar — WalkCroach** | Agent · Memory · Skills · Setup (Import, Incompatibles) | Narrow, persistent, browse-and-select |
| **Panel — WalkCroach: CockroachDB** | Schema · Query · Audit · ccloud · Telemetry | Wide, tabular, log-shaped — the same shape as Problems/Output/Terminal, which is what the panel is for |

Memory and Skills move to the sidebar: they are things you *consult while
working*, not results you scan. Query and Audit stay in the panel for the same
reason a SQL console does.

The panel container is retitled **"WalkCroach: CockroachDB"** so parentage is
legible even when the panel is the only thing on screen.

### 4.4.3 Settings

**Product UI (shipped):** Cursor-style **WalkCroach Settings** is a custom
`EditorPane` + React webview under `contrib/walkcroach/browser/settings/`, opened
via `walkcroach.openSettings` (Command Palette, **title-bar gear**, Global Activity,
Preferences menu). Durable values write through `IConfigurationService` /
`settings.json` (not a parallel `state.vscdb` store). A nav item bridges to stock
VS Code Settings filtered to `walkcroach`.

**Title bar (Cursor triad):** `walkcroachTitleBar.contribution.ts` — Settings gear
opens the Settings editor; chat icon toggles the WalkCroach agent Auxiliary Bar;
**Agents Window** pill maximizes that agent surface (agent-first layout). Full Cursor
Agents Window chrome remains Path B / D5 — see §4.4.6.

**Registry nesting:** One top-level **WalkCroach** section with everything nested
under it. VS Code renders dotted configuration ids as a tree, so this is purely a
naming decision:

```
walkcroach.agent.*         Agent — autonomy, model, iteration cap
walkcroach.memory.*        Memory — recall limits, supersede threshold
walkcroach.cockroachdb.*   CockroachDB — connection, MCP, write consent
walkcroach.telemetry.*     Telemetry
```

Today there is a single flat `walkcroach` section (`id: 'walkcroach'`, title
"WalkCroach Desktop") plus `walkcroach.agent.autonomy`. Nesting costs nothing and
makes CockroachDB settings discoverable from the product's own section rather
than as an unrelated group.

### 4.4.4 Iconography and the logo

**No brand asset exists yet.** There is no `.svg`, `.png`, `.ico` or `.icns`
anywhere in `walkcroach-desktop/` outside the vendored `vscode/` tree — while
`product.walkcroach.json` already declares `linuxIconName: "walkcroach"`,
pointing at a file that is not there. This is a hard dependency on a design
asset, not something to be improvised in code.

What is needed, and where each form is consumed:

| Form | Consumer | Notes |
|---|---|---|
| **SVG, monochrome, 16×16 grid** | Activity-bar container icon | Must read at 16px and inherit `foreground`; register via `registerIcon` |
| **SVG, full colour** | Welcome page, About dialog | Themed light/dark |
| **`.ico`** (16/32/48/256) | Windows app + taskbar | `packaging/` |
| **`.icns`** | macOS bundle | `packaging/`, needed for D6 signing |
| **`.png` set** (512, 256, 128, 64, 32) | Linux | Satisfies the existing `linuxIconName` |

Container icons today, both wrong:

- WalkCroach container uses `Codicon.database` — the *agent* wearing a database
  mark. Replace with the WalkCroach mark.
- CockroachDB panel uses `Codicon.serverProcess`. Replace with
  `Codicon.database`, which is what it actually is.

Per-view icons stay codicons. Only the container carries brand — an activity bar
of custom marks is noise.

### 4.4.5 Colour — inherit Graphite Lumen, do not invent

The palette is already decided and researched in
[`color-system-research.md`](./color-system-research.md): **graphite canvas,
amber `signal` for CTA/focus, steel-blue `teal` for memory and data, `ember` for
errors.** Desktop ships it as the default colour theme rather than starting a
second palette.

The work is a mapping from tokens to VS Code's workbench colour keys:

| Graphite Lumen | Dark | VS Code keys |
|---|---|---|
| `ink` | `#0B0C0F` | `editor.background`, `activityBar.background`, `titleBar.activeBackground` |
| `panel` | `#14161B` | `sideBar.background`, `panel.background`, `editorWidget.background` |
| `raised` | `#1C1F26` | `list.hoverBackground`, `input.background`, `statusBar.background` |
| `line` | `#2E333C` | `panel.border`, `sideBar.border`, `editorGroup.border` |
| `paper` | `#F2F3F5` | `foreground`, `editor.foreground` |
| `mist` | `#9198A4` | `descriptionForeground`, `disabledForeground` |
| `signal` | `#F0B429` | `focusBorder`, `button.background`, `activityBarBadge.background`, `progressBar.background` |
| `teal` | `#6B9EFF` | `textLink.foreground`, `list.activeSelectionForeground` |
| `ember` | `#F07167` | `errorForeground`, `inputValidation.errorBorder` |

Light theme uses the light column of the same table.

Two rules from the research that constrain this and are easy to violate in an
editor theme:

1. **`signal` is never a large fill** — buttons, focus rings, badges only, ≤10%
   of the surface. Notably it does *not* go on `statusBar.background`, which is
   a full-width bar and the single most tempting place to put brand colour.
2. **Body text never sits on thin glass.** Editor and panel backgrounds stay
   opaque; any glass is chrome only.

Ship both themes, set the dark one as `defaultColorTheme` in the product
overlay, and keep the theme JSON under `product/` so it regenerates with the
rest of the branding.

### 4.4.6 Agents Window — Path B (locked)

Research confirmed Cursor's Agents Window is **not** a customization of Code OSS
`vs/sessions` — Anysphere built it from scratch beside their VS Code fork
([Cursor forum](https://forum.cursor.com/t/cursor-3-agents-window/156509), Apr 2026).
Microsoft's Agents Window (`vs/sessions/`) is a parallel product (Copilot/Claude/
Codex on Agent Host). WalkCroach already vendors that tree and keeps it dark.

**Locked choice: Path B** — build WalkCroach's agent-first fleet UI on Agent Host,
documented in [`walkcroach-desktop-fleet-primitives.md`](./walkcroach-desktop-fleet-primitives.md).
Do **not** re-enable `chat.agent.enabled` / Microsoft's sessions window (Path A)
unless a later decision record explicitly revisits entitlement surgery.

| Layer | Status |
|---|---|
| Title-bar triad (Settings / Toggle Agent / Agents Window → Path B editor) | ✅ |
| Multi-session fleet chrome + worktree tools | ✅ D5.0–D5.4 |
| Cloud / VM-isolated fleet | Later (fleet-primitives §3.4) |

Value prop after parity: **one memory layer** across Chrome/Web/Desktop surfaces,
visible as `source_surface` in the Memory inspector (D4).

### 4.4.6 UX polish

Concrete, in the order a user meets them:

- **First run.** The welcome page currently reads "WalkCroach Desktop Dev —
  Editing evolved", inherited from upstream. It should say what this product is
  for — cross-surface memory — and its primary action should be *sign in and
  link a project*, because every interesting surface is inert until then.
- **Empty states carry the next action.** The Audit pane already does this well
  ("No actions yet. Use Schema / Query / ccloud / Memory."). Memory, Skills and
  ccloud should match rather than render blank.
- **Status bar tells the truth about readiness.** Today: `phase=idle · auth=out ·
  project=unlinked · cache r/w=0/0 · autonomy=strict`. That is engineer-facing
  telemetry in a user-facing bar. Reduce to state plus one action —
  `WalkCroach: not signed in` as a clickable item — and keep the detail in a
  hover.
- **Approvals are the highest-stakes UI.** The QuickPick shows a truncated
  `detail.slice(0, 200)` as placeholder text. A diff approval needs the diff,
  not a 200-character prefix; route file edits to the workbench diff editor and
  reserve QuickPick for commands.
- **Memory provenance is the differentiator and should look like it.** A recall
  result should show `source_surface` and age — "from Chrome, 3 days ago" — since
  that is the thing no competitor can display.
- **Respect reduced motion**, per the existing
  `walkcroach-framer-motion-micro-interactions` skill: entrance only, <300 ms.

### 4.4.7 Sequencing

**D2 goes first** — the agent is what makes any of this worth looking at.

But two pieces of IA are cheap now and expensive later, because `storageId`
persists container layout per user: once anyone has pinned or rearranged views,
restructuring fights their saved state. Fold these into D2 rather than deferring:

- the container merge (one activity-bar entry) and the icon swap
- nested settings ids (`walkcroach.agent.*`, `walkcroach.cockroachdb.*`)

The rest — logo asset, colour theme, empty states, approval UX — is **D2.5**,
after the agent works and before anyone else sees it. The logo is a blocking
dependency on a design asset that does not exist yet (§4.4.4).

---

## 4.5 Local vector index, and how it syncs with CockroachDB

### 4.5.1 It already exists

`packages/agent-engine/src/local-index.ts` ships today and backs the
`semantic_search` tool in the IDE and CLI:

- Flat files under `.walkcroach/index/` — `manifest.json` (content hash + mtime
  per file) and `vectors.jsonl`
- 150-line chunks with 20 lines of overlap, ≤2000 files, ≤300 KB per file
- **Brute-force cosine, no ANN library**
- `EmbedFn` is injected rather than imported, so the storage layer has no opinion
  about who embeds

And the fact that makes everything below possible:

> Embed text with Titan Text Embeddings V2 (1024-dim), **mirroring
> `agent-harness`'s `embedText` exactly**

**Local and cloud vectors are already in the same embedding space.** No
re-embedding is needed to move a vector between them — which is precisely the
compatibility problem the portability format's `embeddingModel` field exists to
detect. Desktop inherits that for free, and must not break it.

### 4.5.2 Where it lives: the Agent Host, not the renderer

Correct, and it follows from §3.1 rather than being a new rule: all agent logic
lives in the AHP adapter, and the index is agent logic. Putting it in the
workbench would tie the index's lifetime to a window, which defeats the point of
a session that outlives the window.

```
[ Code OSS fork UI ]
        │  AHP (JSON-RPC, message port)
        ▼
[ Agent Host process ] ──► [ local index: .walkcroach/index/ ]
        │                     code chunks · episodic log · durable cache
        ├─► [ tools: ripgrep (ISearchService) · tree-sitter ]
        └─► [ /v1 SDK ] ──► CockroachDB  (system of record)
```

### 4.5.3 Three tiers, three different sync policies

The instinct to "sync local and CockroachDB both ways" is right for exactly one
of these three, and actively wrong for another. Treating them alike is the
mistake to avoid.

| Tier | Example | Lives | Syncs up? |
|---|---|---|---|
| **Code chunks** | embeddings of `src/**` | Local only | **No.** Derived from the repo and regenerable in minutes. Uploading them means shipping a customer's source code, encoded, to our cluster — cost with no benefit, and a data-residency problem we would have to explain |
| **Episodic** | "tried `utils.ts:40`, compile failed with X" | Local, TTL'd | **Distilled only.** The raw log is high-volume and low-value after the session; what promotes is the conclusion — "this refactor needs the codegen step re-run first" |
| **Durable** | decisions, conventions, preferences | Local cache **and** CockroachDB | **Yes, both directions.** This is `memory_entries`, and it is the thing the whole product is about |

Only the third tier is genuinely bidirectional. CockroachDB stays the system of
record (a locked architecture fact); local is a read cache plus a write-ahead
buffer for offline.

### 4.5.4 Sync mechanics for the durable tier

**Pull** — `recall` with an `updated-since` watermark, into the local cache.
Point-in-time reads use the SDK's `asOf`, so a Desktop session can ask what the
project believed at a past instant without holding that history locally.

**Push** — writes go to the local buffer first and replay to `/v1` on reconnect.
Two things make replay safe, and both already exist:

- **Supersede semantics.** `writeMemoryEntryDetailed` retires the nearest
  same-kind entry within `MEMORY_SUPERSEDE_THRESHOLD`, transactionally. A replayed
  offline write gets the same treatment as a live one — no special path.
- **Client-generated ids for idempotency.** A buffered write that is replayed
  twice must not become two entries. Same lesson as the run store's
  `idempotency_key`: without it, a flaky reconnect turns one decision into three.

**Conflict** is not a new problem. Two surfaces already write concurrently, and
`superseded_by` plus SERIALIZABLE is the existing answer. Desktop is a third
writer, tagged `source_surface = 'desktop'`.

### 4.5.5 Corrections to the research this section is based on

**`sqlite-vss` is deprecated.** Its author archived it in favour of
**`sqlite-vec`**, which drops the Faiss/C++ dependency for portability. Any
storage upgrade should target `sqlite-vec`, not `sqlite-vss`.

**Whether to upgrade storage at all is a real decision, not a given.** The
current JSONL brute force loads every vector to answer one query — at 2000 files
that is roughly 20k chunks × 1024 dims × 4 bytes ≈ **80 MB read and scanned per
search**. `sqlite-vec` fixes that, at the cost of shipping a native extension per
platform (win32-arm64 included, on this machine). That is a genuine
distribution burden on a fork that already rebuilds 12 native modules. Measure
`semantic_search` latency on a real repo first; if it is acceptable, this is a
D-phase for later, not now.

**"The industry moved away from vector RAG for codebase context" is overstated.**
Windsurf's Fast Context is exactly a RAG index over the codebase. What is true is
that vector search is no longer the *only* retrieval path — and our own tool
description already says so: `semantic_search` is documented as *"complementary
to search/glob: prefer search for exact strings or regex, glob for filenames."*
That is the hybrid stack, already shipped.

**A local index does not currently give you offline semantic search.** This is
worth stating plainly because it is the intuitive assumption and it is false:
`semanticSearch` needs an `EmbedFn` to embed the *query*, and that is Titan over
Bedrock. With no network there is no query vector, so no search — the stored
vectors are unreachable. Genuine offline would need a local embedding model,
which would put local vectors in a *different* space and break §4.5.1's
compatibility. That trade is a product decision, not a detail: pick one space, or
carry both and record which produced each vector.

### 4.5.6 What Desktop adds that the IDE extension cannot

Two things, both from the Agent Host owning the process:

1. **The index survives the window.** An extension's index dies with its host; a
   host-owned index persists across window close and reattach, which is what
   makes a multi-hour autonomous run resumable.
2. **`ISearchService` for the text half.** The workbench's own ripgrep index,
   rather than a re-scan — the hybrid stack gets faster on the exact-match side
   without touching the vector side.

---

## 5. Upstream sync — the thing that kills forks

A fork's long-run cost is rebase pain, and it is paid every two weeks forever. The existing rules already encode the right instinct; this plan tightens them.

1. **Fork-only code stays under `vscode/src/vs/workbench/contrib/walkcroach/`** (plus the thin agent-host provider under `platform/agentHost/node/walkcroach/` that must live next to upstream adapters). Anything else outside the allowlist below is a conflict waiting to happen.
2. **Three permitted upstream touches** (revised from two after D2 measured the real registration site — recorded, not silent):
   - `product.json` (generated via `apply-product.mjs` — never hand-patched)
   - one import line in `workbench.common.main.ts`
   - provider registration in `node/agentHostMain.ts` (`registerProvider(WalkCroachAgent)`)
   A fourth touch (e.g. contribution suppression for stock Chat/Agents chrome) requires an explicit spike and a changelog note before landing — same discipline as the third.
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
