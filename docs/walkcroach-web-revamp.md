================================================================================
WALKCROACH WEB — ECOSYSTEM ENTRY-POINT REVAMP
Deep Competitive Research + Phased Implementation Plan
================================================================================

Document owner : WalkCroach team  
Surface        : WalkCroach Web — reimagined as the multi-faceted hub into the
                 WalkCroach ecosystem (Chat · Projects · Code · App Builder ·
                 Apps · Profile), not solely as a prompt-to-app builder  
Live build     : https://walkcroach.conquerorfoundation.com  
Status         : **ACTIVE REPLACEMENT** for `walkcroach-web-prd.md` and
                 `walkcroach-web-implementation-plan.md`. Those docs are
                 historical (builder-era ~80% build). This document is the
                 sole product + delivery source of truth for Web going forward.  
Build intent   : **Build to completion this weekend** (Fri Jul 24 → Sun Jul 26,
                 2026). All six surfaces ship. Phases below are a same-weekend
                 execution sequence (hours/blocks), not a multi-week roadmap.
                 Descope only if a block slips — see §8.3.  
Version        : 1.1  
Date           : July 24, 2026 (v1.1 — replacement + weekend completion)  
Related docs   :
  - `docs/plan1.md` — locked infra (Lambda stream, WC, CRDB, Bedrock) — keep
  - `docs/walkcroach-web-prd.md` — **superseded** (archive / do not extend)
  - `docs/walkcroach-web-implementation-plan.md` — **superseded**
  - IDE / Chrome / Desktop PRDs — sibling surfaces this hub unifies

--------------------------------------------------------------------------------
HOW TO READ THIS DOCUMENT
--------------------------------------------------------------------------------
This is the replacement Web PRD + implementation plan. Build it end-to-end
over the weekend; do not treat older Web docs as competing scope.

Sections 1–2 set the thesis and map today’s Web against the six surfaces.
Section 3 is the competitive deep dive. Section 4 is product principles + IA.
Section 5 re-evaluates WebContainer. Section 6 is the **weekend phased build
plan** (Day 0 → Day 2, phases A–F). Section 7 is data/API. Section 8 is risks,
open questions (resolve Friday morning), and weekend descope order.
Appendix A–C: provider matrix, bibliography, ticket seed.

Requirement / work-item IDs in this doc:
  REV-xx  = Revamp work package
  IA-xx   = Information-architecture decision
  RT-xx   = Runtime / sandbox decision
  CH-xx   = Chat capability
  PJ-xx   = Project capability
  CD-xx   = Code / artefacts capability
  AB-xx   = App Builder capability
  AP-xx   = Apps hub capability
  PF-xx   = Profile / settings capability


================================================================================
1. EXECUTIVE THESIS
================================================================================

1.1  What is changing
--------------------------------------------------------------------------------
WalkCroach Web today is a **single-purpose App Builder**: landing → dashboard
of builder projects → split-pane chat + WebContainer preview + Ship/Data/
Versions. That was the correct hackathon bet. It is no longer the correct
*product shape* for an ecosystem entry point.

The industry has converged on a different pattern: **one authenticated home
surface with a left-rail of modes**, where Chat is the default, Projects hold
durable context across chats, generated artefacts (code, docs, apps) live in
first-class collections, and specialized builders (app builders, canvases,
artifacts) open as *modes of a project* rather than as the entire product.

Claude.ai is the clearest reference for this IA (Chat + Projects + Artifacts +
sidebar Apps/extensions + profile/settings). ChatGPT, Gemini, and Perplexity
rhymed the same structure with different names. Separately, the “vibe coding”
category (Lovable, Bolt, v0, Replit Agent) solved the *builder interior* —
preview-first vs IDE-first, progressive disclosure of terminal/files, deploy.

WalkCroach’s unique wedge is not “another Bolt.” It is **memory-first
continuity across Web, Chrome, IDE, and Desktop**, with CockroachDB as the
substrate. The Web revamp must therefore:

  1. Become the **human-facing control plane** for that memory (Projects,
     instructions, documents, timeline).
  2. Offer **general Chat** (attachments + web search + tool use) that is
     useful even when the user is *not* building an app.
  3. Keep **App Builder** as a polished, specialized mode — preview-first for
     normal people, with terminal/files available but closed by default.
  4. Surface **Code** generated across chats as a durable library, not only as
     ephemeral WebContainer FS.
  5. Reserve an **Apps** rail for WalkCroach products, extensions, and future
     plugins.
  6. Give **Profile / Settings** a real destination (today: a name dropdown).

1.2  What stays
--------------------------------------------------------------------------------
Do **not** throw away the working core:

  - Cognito auth, project CRUD, session hydrate, NDJSON agent streaming
  - CockroachDB memory + Titan embeddings
  - Checkpoints, file sync, ZIP/GitHub export, one-click deploy
  - Visual edit, secrets/DB proxy, usage metering
  - IDE OAuth bridge (`/connect/ide`) and Chrome/IDE as sibling surfaces

The revamp is primarily **IA + product surface area + builder UX polish +
runtime strategy**, layered on the existing harness.

1.3  One-sentence product definition (target — ships this weekend)
--------------------------------------------------------------------------------
WalkCroach Web is the place you talk to WalkCroach, keep project memory, collect
code and apps you generate, open the App Builder when you want something
running, and manage your account — with the same memory following you into
Chrome, IDE, and Desktop.

1.4  Document authority
--------------------------------------------------------------------------------
**This file replaces** `docs/walkcroach-web-prd.md` and
`docs/walkcroach-web-implementation-plan.md` as the Web product and delivery
source of truth. Those files remain as historical record of the builder-era
build; do not extend them. Infra locked in `docs/plan1.md` still applies unless
this doc explicitly overrides a product decision.


================================================================================
2. CURRENT STATE → TARGET SURFACE MAP
================================================================================

| Target surface | Exists today? | What exists | Gap |
|----------------|---------------|-------------|-----|
| **1. Chat** | Partial | Builder-only agent chat (Plan/Build), streaming, tool cards, activity | No standalone chat; no attachments; no web search; no general tool registry; chat is subordinated to builder |
| **2. Projects** | Partial | Dashboard list, templates, archive/delete, memory summary cards, resume session | No project *knowledge base* (docs + standing instructions + description) shared across the project’s full chat timeline; projects ≈ builder apps, not Claude-style workspaces |
| **3. Code files** | Thin | Durable file sync, ZIP export, GitHub push, agent writes into WC | No Code library UI; no file tree / editor; artefacts not browsable across chats |
| **4. App Builder** | Strong core, weak UX | Chat + preview + read-only terminal strip + Ship/Data/Versions | Terminal always visible; no file tree; no progressive disclosure; feels like a half-IDE to non-technical users; WC choice not re-validated for 2026 |
| **5. Apps** | Missing as hub | Deployed `{slug}.walkcroach…` URLs live under Ship | No Apps gallery; no ecosystem products / extensions / plugins shelf |
| **6. Profile** | Missing | Header name + Projects / New session / Sign out; usage meter in builder | No `/settings` or `/profile`; billing portal incomplete; theme only global preference |

Routes today (`web/src/app/AppRoutes.tsx`): `/`, auth pages, `/welcome`,
`/dashboard`, `/project/:id`, `/try`, `/connect/ide`. Target IA needs a
persistent shell with Chat as home and nested project/builder routes.


================================================================================
3. COMPETITIVE RESEARCH (DEEP DIVE)
================================================================================

Research window: mid-2025 → July 2026. Sources: vendor docs, help centers,
hands-on comparison write-ups, sandbox engineering guides, open-source search
tooling. Full bibliography in Appendix B.

--------------------------------------------------------------------------------
3.1  General AI hubs — information architecture
--------------------------------------------------------------------------------

### 3.1.1  Claude.ai (primary reference for WalkCroach IA)

Anthropic’s consumer surface is the clearest “multi-faceted hub” that still
feels simple.

| Concept | Behavior | Lesson for WalkCroach |
|---------|----------|----------------------|
| **Chat (default)** | Full-width conversation; tools/skills available by default | Chat must work without opening a builder |
| **Projects** | Persistent workspace: standing instructions + uploaded docs + many chats under one roof; retrieval over project corpus (not full dump into every prompt); project content often cached outside per-message limits | Projects = memory containers, not “apps” |
| **Artifacts** | Side panel for standalone deliverables (docs, code, HTML/React, SVG, Mermaid); iterative update without drowning the thread; publish/share; Artifacts gallery in sidebar; persistent storage up to ~20MB/artifact on paid tiers; Live Artifacts + MCP (2026) | Separate *output* from *conversation*; WalkCroach “Code” + lightweight previews map here |
| **Skills / Computer Use / MCP** | Extensible tool layer; design skills; connectors | Tool use is a product feature, not an implementation detail |
| **Sidebar apps / connectors** | Dedicated places for created artefacts and integrations | “Apps” rail is expected |
| **Profile / settings** | First-class account destination | Non-negotiable |

**Projects vs Artifacts (critical distinction):** A Project organizes work
(context across chats). An Artifact is a deliverable produced *inside* a chat.
WalkCroach currently collapses both into “project = builder app.” The revamp
must split them: **Project** (context) vs **Code / App** (outputs).

**Why Claude is the right reference, not a clone:** Claude’s strength is
workspace + artefacts + chat. WalkCroach’s strength is durable memory across
products + a real App Builder that deploys. Steal the IA; keep the wedge.

### 3.1.2  ChatGPT (OpenAI)

| Concept | Behavior | Lesson |
|---------|----------|--------|
| **Projects** | Workspace for a body of work: chats + files + instructions + project-scoped memory | Aligns with Claude; validate that “project memory” is table stakes |
| **Custom GPTs** | Persona + tools + knowledge — *assistant-shaped*, not workspace-shaped | Do **not** confuse WalkCroach Projects with Custom GPTs; Gems/GPTs are personas |
| **Canvas → inline blocks (2026)** | Canvas (side-panel doc/code editor) was quietly removed from GPT-5.5 Instant/Thinking (May 28, 2026) in favor of inline writing/code blocks | Side panels are not sacred; **persistent output surfaces** matter more than the exact chrome. Claude Artifacts stayed side-panel and are winning the “build interactive things” use case |
| **Memory** | Cross-chat personal memory distinct from project files | WalkCroach already has CRDB memory — productize it like OpenAI productized Memory |

**Takeaway:** ChatGPT validates Projects as a workspace. Its Canvas retreat
warns against over-investing in a heavy secondary editor that users don’t open;
prefer artefacts that *render* (preview) over artefacts that only *edit*.

### 3.1.3  Gemini (Google)

| Concept | Behavior | Lesson |
|---------|----------|--------|
| **Gems** | Custom assistants (instructions + optional knowledge files) — persona-first | Useful for future “WalkCroach skills / agents,” not as the primary Project model |
| **Workspace integration** | Gems/files live near Google Docs/Drive | Ecosystem rail (“Apps”) should eventually deep-link IDE, Chrome, Desktop |
| **Huge context** | Users hack “memory docs” into Gems | Prefer first-class project knowledge over user hacks |

**Takeaway:** Borrow Gems later as “reusable agent presets.” Do not replace
Projects with Gems.

### 3.1.4  Perplexity Spaces / Copilot / others

| Product | Pattern | Lesson |
|---------|---------|--------|
| **Perplexity Spaces** | Research hub: instructions + files + thread history; search-native | Chat with **web search on by default** is a distinct product mode users now expect |
| **Microsoft Copilot** | Work-scoped chats + plugins + Graph grounding | Enterprise “Apps/plugins” shelf |
| **Poe / Character.ai** | Multi-bot switcher | Less relevant; WalkCroach is one agent with modes |

### 3.1.5  IA consensus (2026)

Across Claude / ChatGPT / Gemini / Perplexity, the converged shell is:

```
┌──────────────────────────────────────────────────────────────┐
│  Brand / New Chat / Search chats                    Profile  │
├────────────┬─────────────────────────────────────────────────┤
│ Chat       │                                                 │
│ Projects   │           Active mode content                   │
│ (Code /    │           (conversation, project home,          │
│  Artifacts)│            builder, apps gallery, settings)     │
│ Apps       │                                                 │
│ Settings*  │                                                 │
└────────────┴─────────────────────────────────────────────────┘
  * Settings often under Profile avatar rather than left rail
```

**IA-01 (adopt):** Left-rail ecosystem shell; Chat default; Projects as context
containers; Code/Apps as collections; Profile for settings.  
**IA-02 (adopt):** Flexible — allow opening App Builder full-bleed without the
rail when deep in a build session (Claude-like focus mode).  
**IA-03 (reject):** Making App Builder the only authenticated home.


--------------------------------------------------------------------------------
3.2  Project / knowledge / memory patterns
--------------------------------------------------------------------------------

| Provider | Project contents | Retrieval model | Multi-chat |
|----------|------------------|-----------------|------------|
| Claude Projects | Instructions + files; chats belong to project | Retrieval over corpus; cached | Yes |
| ChatGPT Projects | Instructions + files + project memory | Mixed | Yes |
| Gemini Gems | Instructions + files (persona) | Stuff into context | Chats invoke Gem |
| Perplexity Spaces | Instructions + files + threads | Search-native | Yes |
| **WalkCroach today** | Name + template + builder session + CRDB memory summaries | Embedding recall in agent harness | Sessions exist, but UI is “one project = one builder” |

**PJ-01:** Project = { description, standing instructions, document library,
preferences, chat timeline, linked code artefacts, optional App Builder
workspace, linked deployments }.  
**PJ-02:** Documents and instructions apply to *all* chats in that project
across its lifecycle (Claude/ChatGPT pattern).  
**PJ-03:** Memory recall (already built) must be visible on the Project home
(“Remembered”, decisions, open questions) — the old PRD already argued this;
the revamp makes Project home the place it lives.


--------------------------------------------------------------------------------
3.3  AI app builders — interior UX (Lovable, Bolt, v0, Replit, others)
--------------------------------------------------------------------------------

### 3.3.1  Positioning map (July 2026)

| Product | Primary audience | Runtime | Interior metaphor | Strength |
|---------|------------------|---------|-------------------|----------|
| **Lovable** | Non-technical founders | Hosted gen + Supabase | Chat + polished preview; code/terminal abstracted; GitHub for escape hatch | Design polish, auth/DB wiring, “no terminal” |
| **Bolt.new** | Technical / semi-technical | **WebContainers** (StackBlitz) | Chat + full browser IDE (file tree, editor, terminal, preview) | Speed, framework flexibility, exportable code |
| **v0 (Vercel)** | Frontend / design systems | Vercel preview / component sandbox | Chat + component variants; increasingly more full-app (auth/DB added 2026) | UI quality, React/shadcn |
| **Replit Agent** | Learners + hybrid | Cloud container IDE | Agent + real IDE + DB UI + deploy | Full Linux fidelity, education |
| **Cursor / Claude Code** | Professional developers | Local / cloud agent | Editor-native | Not a web builder; complementary |
| **WalkCroach Web (today)** | Mixed (hackathon) | WebContainers | Chat + preview + **always-on terminal log**; no file tree | Memory + deploy + CRDB — UX unfinished |

### 3.3.2  The two successful metaphors

Industry has split into two coherent metaphors. Mixing them badly is what
makes products feel “pro but broken” or “simple but trapped.”

**Metaphor A — Preview-first (Lovable-shaped)**  
Primary object: the running app. Chat is the control. Code, terminal, and
logs are progressive-disclosure drawers. Errors are translated to plain
English. Escape hatches: GitHub sync, download ZIP, “Open code.”

**Metaphor B — IDE-first (Bolt / Replit-shaped)**  
Primary object: the workspace (files + terminal + preview tabs). Chat is a
copilot beside a real editor. Users are expected to open files and run
commands.

**WalkCroach target users (normal people who don’t want terminals) → Metaphor A
by default, with Metaphor B available as “Dev mode” / expandable drawers.**

This is the single most important App Builder UX decision in the revamp.

### 3.3.3  Progressive disclosure patterns that work

From Lovable, Replit, and modern design systems for AI builders:

| Layer | Visible by default | Open on demand |
|-------|--------------------|----------------|
| Preview | Always (dominant right/center) | — |
| Chat | Always (left or bottom-left) | Collapsible for focus |
| Status / progress | Subtle activity chips (“Installing…”, “Editing Home.tsx”) | Expand to full tool timeline |
| Terminal | **Closed bottom drawer** with badge when output arrives | Expand to interactive or scrollable log |
| File tree | Hidden or icon-only for non-dev | “Code” tab / drawer with tree + Monaco |
| Diffs | Optional “Review changes” before apply (plan mode) | Full diff viewer |
| Deploy / Data / Versions | Secondary tabs or header actions | Keep (WalkCroach already has Ship/Data/Versions) |

**AB-01:** Terminal closed by default; openable from a bottom bar; badge on
new output.  
**AB-02:** Add a Code drawer (tree + read/edit) — not always-on.  
**AB-03:** Keep Plan mode + checkpoints as trust layer (already strong).  
**AB-04:** Activity should feel like “what’s happening,” not a dump of shell
stdout.

### 3.3.4  What WalkCroach already does better / worse

| Area | vs category | Note |
|------|-------------|------|
| Cross-session memory | **Ahead** | Needs Project-home surfacing |
| Checkpoints / revert | Competitive | Keep |
| Deploy to own subdomain | Competitive | Move into Apps hub too |
| Secrets / DB proxy | Competitive | Keep |
| Visual edit | Competitive | Keep |
| Builder chrome for normals | **Behind Lovable** | Terminal strip; missing Code drawer design |
| File visibility | **Behind Bolt/Replit** | No tree/editor |
| UI polish of generated apps | Behind Lovable/v0 | Separate from shell UX; improve templates/skills later |


--------------------------------------------------------------------------------
3.4  Chat attachments, web search, and tool / skill use
--------------------------------------------------------------------------------

### 3.4.1  Attachments (category standard)

Expected by 2026 in any serious chat product:

  - Images (vision) + PDFs + text/markdown + spreadsheets (CSV/XLSX) + code files
  - Per-message caps (Claude-class: ~20 files, ~30MB each is a common reference
    band — set WalkCroach limits by cost)
  - Project-level document library distinct from per-message attachments
  - Clear “used as context” citations in the reply

**CH-01:** Message attachments in Chat and Builder chat.  
**CH-02:** Project document library (persists; retrieval-backed).  
**CH-03:** Store blobs in existing artefacts/S3 pattern; never only in browser.

### 3.4.2  Web search — open source and commercial options

Users asked specifically for an **open-source** skill/tool for web search, on
by default. Research summary:

| Option | License / model | Fit | Notes |
|--------|-----------------|-----|-------|
| **SearXNG** | Open source (AGPL) metasearch | Best self-hosted *engine* | JSON API (`/search?q=&format=json`); many public instances disable JSON; self-host recommended |
| **agent-search** (brcrusoe72) | MIT wrapper around SearXNG | Best OSS *agent-facing* package | Dedup, extract, MCP server, Docker one-shot; positions as Tavily/Exa/Serper alternative |
| **DuckDuckGo / searx libs** | Various | Lightweight | Less reliable SERP quality alone |
| **Brave Search API** | Commercial; independent index | Strong privacy + LLM Context API (2026) | Not OSS; good paid fallback |
| **Tavily** | Commercial, AI-native | LangChain default; search+extract+crawl+map | Best DX; not OSS |
| **Exa** | Commercial, semantic | Neural/semantic discovery | Great for “find similar pages” |
| **Firecrawl / crawl4ai** | Mixed | Extract/crawl after search | Pair with SearXNG |

**Recommended WalkCroach stack (CH-04):**

  1. **Default tool:** `web_search` backed by **self-hosted SearXNG** (or
     managed SearXNG via agent-search) for OSS alignment and cost control.
  2. **Enrichment tool:** `web_extract` (read URL → clean markdown) via
     agent-search extract layer or Firecrawl/crawl4ai.
  3. **Optional paid upgrade path:** Tavily or Brave as a quality tier behind
     the same tool interface (feature flag / Pro).
  4. **UX:** Web search **on by default** in general Chat (toggle in composer,
     like Perplexity/Claude). In App Builder, default **off** or “auto when
     researching deps/docs” to avoid polluting codegen context — still
     available as a chip.

**CH-05:** Citations UI (favicon + title + URL) under assistant messages when
search was used.  
**CH-06:** Tool-use cards already exist in builder — generalize to Chat.

### 3.4.3  Skills / tool registry

Claude Skills + MCP, ChatGPT tools, and Cursor MCP all point to a **registry**
model rather than hardcoding every capability into the prompt.

**CH-07:** Introduce a WalkCroach tool registry shared by Web Chat and Builder:

  - Always-on: `web_search`, `web_extract`, memory recall/write, project docs
  - Builder-only: `write_file`, `edit_file`, `run_terminal`, checkpoints, deploy
  - Future: MCP connectors, Chrome-context tools, IDE bridge tools

Default Chat = general tools. Opening App Builder = mounts builder tool set.


--------------------------------------------------------------------------------
3.5  Code / artefacts as first-class objects
--------------------------------------------------------------------------------

Claude Artifacts, ChatGPT code/writing blocks, v0 component history, and
Bolt’s file tree all treat generated code as something you can **find again**.

WalkCroach today syncs files per builder project but has no cross-chat Code
surface.

**CD-01:** “Code” collection: files and folders produced across chats (and
builder sessions), filterable by project / chat / language / date.  
**CD-02:** Opening a code artefact can: preview (if HTML/React), open in
Builder, download, push to GitHub, copy.  
**CD-03:** Lightweight Monaco viewer before full builder IDE.


--------------------------------------------------------------------------------
3.6  Apps hub & ecosystem shelf
--------------------------------------------------------------------------------

Claude’s Artifacts gallery + connectors, ChatGPT’s GPT store (historical) /
apps, Gemini’s Gems list, and Replit’s “your apps” all teach the same lesson:
**users need a shelf for things that outlived a chat.**

For WalkCroach specifically:

| Slot | Content |
|------|---------|
| **My Apps** | Deployed WalkCroach apps (`*.walkcroach…`), status, open, promote domain |
| **WalkCroach products** | Web (here), Chrome extension, IDE extension, Desktop (when ready), CLI |
| **Plugins / extensions (future)** | MCP servers, community skills, partner tools |

**AP-01:** Apps page = My deployments + ecosystem products.  
**AP-02:** Deep links: install Chrome, connect IDE (`/connect/ide`), download
Desktop.  
**AP-03:** Do not build a third-party store in Phase 1–3 of this revamp —
reserve IA space only.


--------------------------------------------------------------------------------
3.7  Profile / settings
--------------------------------------------------------------------------------

Every competitor has a real settings destination. WalkCroach Web does not.

Minimum viable Profile (PF-01):

  - Account (name, email, password / social when available)
  - Plan & usage (credits, Stripe Customer Portal when live)
  - Appearance (theme)
  - Connected surfaces (IDE, GitHub, Chrome)
  - Data & privacy (export, delete account)
  - API / developer (optional later)

**PF-02:** Avatar click → Profile overview; Settings as sub-routes.


================================================================================
4. TARGET PRODUCT PRINCIPLES & INFORMATION ARCHITECTURE
================================================================================

--------------------------------------------------------------------------------
4.1  Design principles
--------------------------------------------------------------------------------

1. **Chat is the front door; Builder is a room.**  
2. **Projects hold memory; chats and apps are temporary relative to projects.**  
3. **Preview over terminal.** Normal people see the app; power users open drawers.  
4. **Outputs are collectible.** Code and Apps outlive the thread.  
5. **One memory, many surfaces.** Web is the hub; Chrome/IDE/Desktop are peers.  
6. **Progressive disclosure > feature flags for UX complexity.**  
7. **Flexible shell.** Claude-like rail, but allow focus mode / full-bleed Builder.  
8. **Don’t reopen locked infra lightly.** Prefer adapters (runtime interface)
   over rewrites this weekend. `plan1.md` infra stays; product shape does not.

--------------------------------------------------------------------------------
4.2  Target sitemap
--------------------------------------------------------------------------------

```
/                         Marketing landing (prompt → new chat or new project)
/app                      Authenticated shell (left rail)
  /app/chat               New / active general chat
  /app/chat/:chatId
  /app/projects           Project list (evolves today’s /dashboard)
  /app/projects/:id       Project home (description, docs, instructions,
                          remembered facts, chats, code, apps)
  /app/projects/:id/chat/:chatId
  /app/projects/:id/builder   App Builder mode (today’s BuilderPage, polished)
  /app/code               Cross-project code library
  /app/apps               Deployments + WalkCroach products
  /app/settings           Profile & settings
  /app/settings/billing
  /app/settings/connections
/try                      Guest scratch (keep)
/connect/ide              Keep
```

Legacy `/dashboard` and `/project/:id` redirect into `/app/...` for bookmarks.

--------------------------------------------------------------------------------
4.3  Shell wireframe (conceptual)
--------------------------------------------------------------------------------

```
┌─ WalkCroach ──────────────────────────────── Profile ▾ ─┐
│ [New chat]                                              │
│ Search…                                                 │
│                                                         │
│ Chat                                                    │
│ Projects                                                │
│ Code                                                    │
│ Apps                                                    │
│ ───                                                     │
│ Recent chats…                                           │
│ Recent projects…                                        │
└─────────────────────────────────────────────────────────┘
```

Builder focus mode hides the rail; a “← Project” chip returns to Project home.

--------------------------------------------------------------------------------
4.4  Mode matrix — which tools mount where
--------------------------------------------------------------------------------

| Mode | web_search | attachments | memory | file write | terminal | deploy |
|------|------------|-------------|--------|------------|----------|--------|
| General Chat | On by default | Yes | Yes | No (or “save as code artefact” only) | No | No |
| Project Chat | On by default | Yes + project docs | Project-scoped | Optional → Code | No | No |
| App Builder | Opt-in / auto-docs | Yes | Project-scoped | Yes (WC) | Yes (drawer) | Yes |


================================================================================
5. RUNTIME RE-EVALUATION — WAS WEBCONTAINER THE RIGHT CHOICE?
================================================================================

--------------------------------------------------------------------------------
5.1  Why WebContainer was chosen (and still valid for a slice)
--------------------------------------------------------------------------------
From `plan1.md` and the current build: zero per-session server compute, code
stays in the user’s browser, instant Vite preview for React/Tailwind templates,
and Bolt.new proved the category. COOP/COEP already wired in `infra-web`.

--------------------------------------------------------------------------------
5.2  2026 landscape
--------------------------------------------------------------------------------

| Runtime | Where | Cold start | Languages | Persist | Cost model | Best for |
|---------|-------|------------|-----------|---------|------------|----------|
| **WebContainers** | Browser WASM | ~1–2s | Node/npm only | Tab (+ sync) | License fee; $0 compute | JS demos, preview-first builders |
| **E2B** | Firecracker microVM | ~150–300ms | Python, Node, apt | Snapshots hours–days | Per sandbox-second | Agent tool execution |
| **Daytona** | Cloud Linux VM/container | ~3–10s | Full Linux, GPU | Days–weeks | Per workspace | Long coding-agent workstations |
| **Codespaces / Gitpod** | Cloud VM | 30–90s | Full | Strong | Per hour | Serious multi-lang IDE |
| **Replit / CodeSandbox VM** | Cloud | 5–15s | Broad | Strong | Tiered | Education / collab |
| **Sandpack / Nodebox** | Browser | Fast | Limited JS | Weak | — | Docs embeds, not full apps |
| **Vercel Sandbox / Modal** | Cloud | Fast-ish | Varies | Varies | CPU-time / GPU | Platform-tied / heavy compute |

--------------------------------------------------------------------------------
5.3  Honest reassessment for WalkCroach
--------------------------------------------------------------------------------

**WebContainer remains a good default for Metaphor A (preview-first JS/React
apps)** — which matches WalkCroach’s generated stack (Vite + React + Tailwind)
and the “normal people” audience. It is **not** the best choice if WalkCroach
wants:

  - Native binaries, Postgres-in-sandbox, Python agents, Docker-in-Docker
  - Agent work that continues when the browser tab closes
  - Multiplayer live coding
  - Heavy full-stack backends inside the sandbox (vs today’s server-side proxy)

Those gaps are exactly why Lovable leans hosted+Supabase and Replit leans
cloud VMs — and why Bolt can stay on WC (JS-centric).

**RT-01 (near-term):** Keep WebContainer as the App Builder preview runtime.  
**RT-02 (architecture):** Introduce a `SandboxRuntime` interface in the web
client + agent harness so tools (`write_file`, `run_terminal`, `preview_url`)
are runtime-agnostic.  
**RT-03 (mid-term spike):** Evaluate **E2B** (or Daytona) as:
  - (a) fallback when WC unsupported (Firefox/Safari degrade),
  - (b) “Power / Backend” builder mode,
  - (c) server-side codegen verification in CI.  
**RT-04 (do not):** Migrate wholesale to cloud VMs in the revamp’s early
phases — cost and tenancy complexity are high; memory wedge doesn’t require it.  
**RT-05 (license):** Confirm StackBlitz commercial embedding license status
for production WalkCroach before scale marketing.

**Verdict:** WebContainer was a *good* choice and remains the *right default*
for a polished preview-first Builder this weekend. It was never the *only*
choice long-term — keep a light runtime adapter, but **do not** migrate to
E2B/Daytona during the weekend build. Hybrid path is explicit post-weekend
follow-on, not incomplete replacement scope.


================================================================================
6. WEEKEND BUILD-TO-COMPLETION PLAN (REPLACEMENT SCOPE)
================================================================================

**Horizon: this weekend only — Fri Jul 24 → Sun Jul 26, 2026.**  
This section replaces the old multi-week Web implementation plan. Every P0
below is in scope for Sunday night. P1 ships if time remains; P2 is explicit
cut-list (not “later roadmap” inside this weekend — either ship a stub or cut).

Legend: **P0** must ship Sunday · **P1** ship if ahead · **P2** stub or cut

Weekend operating rules:
  1. This doc wins over `walkcroach-web-prd.md` / implementation-plan on conflict.
  2. Reuse existing harness, WC, deploy, Cognito, file sync — no infra rewrite.
  3. Prefer thin vertical slices (route + API + UI) over perfect polish mid-blocks.
  4. `SandboxRuntime` = light adapter only; **no** E2B/Daytona this weekend.
  5. SearXNG: self-host or managed instance by Friday night; same tool interface.
  6. Redirects from `/dashboard` and `/project/:id` land in `/app/...` before
     Saturday morning so nothing dead-ends mid-build.

--------------------------------------------------------------------------------
WEEKEND CLOCK (who does what when)
--------------------------------------------------------------------------------

```
FRI  Jul 24  — Day 0: foundations + shell skeleton + search spike
SAT  Jul 25  — Day 1: Chat + Projects (AM) · Builder polish (PM)
SUN  Jul 26  — Day 2: Code + Apps + Profile (AM) · harden + ship (PM)
```

| Block | When | Phase | Outcome by end of block |
|-------|------|-------|-------------------------|
| F1 | Fri AM | A — Foundations | Schema + routes + tool profiles locked |
| F2 | Fri PM | A + B start | AppShell mounts; SearXNG answering in staging |
| S1 | Sat AM | B + C | Chat with attachments + search; Project home usable |
| S2 | Sat PM | D | Builder: terminal drawer closed; Code drawer openable |
| U1 | Sun AM | E + F | Code library + Apps hub + Profile/settings |
| U2 | Sun PM | Ship | Redirects, smoke, deploy prod, demo path green |

--------------------------------------------------------------------------------
PHASE A — FOUNDATIONS (Fri AM → early Fri PM)
--------------------------------------------------------------------------------
Goal: Unlock everything else. No big-bang UX yet, but shell routes exist.

| ID | Work | Priority |
|----|------|----------|
| REV-00 | Confirm six surfaces + Chat-default (this doc = locked) | P0 |
| REV-01 | Route map + redirects (`/dashboard` → `/app/projects`, `/project/:id` → builder mode) | P0 |
| REV-02 | AppShell layout (left rail placeholders) + design tokens | P0 |
| REV-03 | Light `SandboxRuntime` wrap over existing WC (no behavior change) | P1 |
| REV-04 | Tool registry: `chat` vs `builder` profiles in agent harness | P0 |
| REV-05 | Schema: `description`, `instructions`, `project_documents`, generalize sessions→chats, `code_artefacts` | P0 |
| REV-06 | Stand up SearXNG (or agent-search); wire `web_search` / `web_extract` | P0 |
| REV-07 | Feature flag `web_revamp_shell` if needed for mid-weekend rollback | P1 |

**Exit (Fri ~afternoon):** Migrations applied (or dual-write ready); `/app/*`
routes render shell chrome; search tool returns JSON in agent path.

--------------------------------------------------------------------------------
PHASE B — SHELL + STANDALONE CHAT (Fri PM → Sat AM)
--------------------------------------------------------------------------------
Goal: Authenticated home is Chat, not Builder.

| ID | Work | Priority |
|----|------|----------|
| CH-10 | `/app` shell rail: Chat, Projects, Code, Apps + avatar→Profile | P0 |
| CH-11 | General Chat: streaming with `chat` tool profile | P0 |
| CH-12 | Composer attachments (upload → existing artefacts/S3) | P0 |
| CH-13 | Web search **on by default** in Chat (+ toggle) | P0 |
| CH-14 | Citation chips under messages | P0 |
| CH-15 | Recent chats in rail | P0 |
| CH-16 | “Save to project…” from a chat | P1 |
| CH-17 | Post-signup lands on `/app/chat`; `/try` stays guest builder | P0 |
| PF-10 | Profile stub reachable from avatar (expand in Phase F) | P0 |

**Exit (Sat late morning):** Sign-in → Chat; attach a file; get cited search
answer; rail navigates to empty Projects/Code/Apps stubs.

--------------------------------------------------------------------------------
PHASE C — PROJECTS AS MEMORY CONTAINERS (Sat AM, overlaps B)
--------------------------------------------------------------------------------
Goal: Projects hold docs + instructions across the chat timeline.

| ID | Work | Priority |
|----|------|----------|
| PJ-10 | Project home: description, standing instructions, document library | P0 |
| PJ-11 | Multi-chat timeline under a project | P0 |
| PJ-12 | Inject/retrieve project docs + instructions into agent context | P0 |
| PJ-13 | “Remembered” panel (surface existing CRDB memory summaries) | P0 |
| PJ-14 | Backfill existing builder projects into new model | P0 |
| PJ-15 | “Start App Builder” from project home | P0 |
| PJ-16 | Archive / delete on project home | P1 |
| PJ-17 | Templates create Project first, then open Builder | P1 |

**Exit (Sat midday):** Create project → add instructions + doc → new chat
respects them → open Builder as project mode.

--------------------------------------------------------------------------------
PHASE D — APP BUILDER UX POLISH (Sat PM)  ★ must not slip past Saturday
--------------------------------------------------------------------------------
Goal: Metaphor A. Terminal closed by default. Code openable. Lovable-calm.

| ID | Work | Priority |
|----|------|----------|
| AB-10 | Builder chrome: preview dominant; chat left; bottom status bar | P0 |
| AB-11 | **Terminal drawer** collapsed by default; badge; expand/collapse | P0 |
| AB-12 | **Code drawer**: file tree + Monaco (read + light edit) | P0 |
| AB-13 | Structured activity chips instead of always-on mono log | P0 |
| AB-14 | Focus mode (hide ecosystem rail) | P0 |
| AB-15 | Plain-language empty/error states | P0 |
| AB-16 | Restyle Ship / Data / Versions to match shell | P1 |
| AB-17 | Dev mode toggle (open files+terminal by default) | P2 |
| RT-10 | Builder tools via `SandboxRuntime` (still WC) | P1 |

**Exit (Sat night):** Template → prompt → preview without opening terminal;
Code + Terminal each open in ≤2 clicks; focus mode works.

--------------------------------------------------------------------------------
PHASE E — CODE LIBRARY + APPS HUB (Sun AM)
--------------------------------------------------------------------------------
Goal: Outputs are first-class collections.

| ID | Work | Priority |
|----|------|----------|
| CD-10 | `/app/code` index from chats + builder sync | P0 |
| CD-11 | Artefact detail: preview / download / open in Builder / GitHub | P0 |
| CD-12 | “Save as code” from Chat for substantial code blocks | P1 |
| AP-10 | `/app/apps` — My deployments (existing deploy records) | P0 |
| AP-11 | Ecosystem products panel (Chrome, IDE, Desktop, CLI) + deep links | P0 |
| AP-12 | “Plugins — coming soon” stub | P2 |
| AP-13 | Share-link if time (else cut) | P2 |

**Exit (Sun midday):** Apps lists a live deployment; Code shows ≥1 chat file
and ≥1 builder file.

--------------------------------------------------------------------------------
PHASE F — PROFILE + HARDEN + SHIP (Sun AM late → Sun PM)
--------------------------------------------------------------------------------
Goal: Account destination + production cutover. Weekend complete.

| ID | Work | Priority |
|----|------|----------|
| PF-20 | Settings: account, appearance, usage | P0 |
| PF-21 | Stripe portal — only if already half-wired; else usage + “billing soon” | P1 |
| PF-22 | Connections: GitHub + IDE link status + Chrome install CTA | P0 |
| PF-23 | Export / delete account | P2 |
| PF-24 | Social auth | P2 |
| REV-30 | Smoke: Chat → Project → Builder → Deploy → Apps → Profile | P0 |
| REV-31 | Prod deploy + redirect verification | P0 |
| REV-32 | Demo script (5 min) covering all six surfaces | P0 |

**Weekend done when:** All six surfaces are reachable in prod, Chat is default
home, Builder terminal is closed by default, Projects carry instructions/docs,
Code + Apps are browsable, Profile opens from avatar.

--------------------------------------------------------------------------------
EXPLICITLY OUT OF WEEKEND SCOPE (do not start)
--------------------------------------------------------------------------------
  - E2B / Daytona / cloud-sandbox hybrid (research stands; build later)
  - MCP marketplace / plugin architecture beyond Apps stub
  - Mobile-first builder redesign
  - Multi-user project membership / collab
  - Two-way GitHub sync / custom domains (unless already done)
  - Replacing WebContainer

These are post-weekend follow-ons, not incomplete “phases” of this replacement.


================================================================================
7. DATA MODEL & API IMPLICATIONS (SKETCH)
================================================================================

Additive to existing CockroachDB schema — do not break current projects/sessions.

```
projects
  + description TEXT
  + instructions TEXT          -- standing instructions (Claude-like)
  + kind ENUM('general','app') -- app ⇒ has builder workspace

project_documents
  id, project_id, name, mime, s3_key, embedding_id, created_at

chats                          -- generalize today’s sessions
  id, user_id, project_id NULL, title, mode ENUM('chat','builder'), ...

chat_messages                  -- if not already normalized
  + attachments JSONB
  + citations JSONB

code_artefacts
  id, user_id, project_id NULL, chat_id NULL, path, content_hash, s3_key, language

deployments                    -- already exist; index from Apps hub

tool_invocations               -- optional audit for search/tools
```

API additions (illustrative):

  - `POST /chats`, `POST /chats/:id/prompt` (chat tool profile)
  - `POST /projects/:id/documents`
  - `PATCH /projects/:id` `{ description, instructions }`
  - `GET /code-artefacts`
  - `GET /apps/mine` (deployments + metadata)
  - `POST /tools/web-search` (or agent-internal only)

Agent harness: mount tool profiles `chat | project_chat | builder` from registry.


================================================================================
8. RISKS, OPEN QUESTIONS, DESCOPE
================================================================================

--------------------------------------------------------------------------------
8.1  Risks
--------------------------------------------------------------------------------

| Risk | Mitigation |
|------|------------|
| Weekend scope too large | Enforce §6 clock; cut P2 immediately; P1 only if ahead of clock |
| Old PRD still pulled into work | **This doc replaces it** — do not implement leftover Phase-4 items unless listed here as P0 |
| Two products in one confuse users | Shell clarity + Project home; Builder focus mode |
| SearXNG quality/reliability | Fri spike; if broken by Fri night, Brave/Tavily behind same `web_search` tool |
| WC license / browser limits | Stay on WC this weekend; document known browser limits in Profile help |
| Schema migration of sessions→chats | Dual-read Fri; backfill Sat AM; no perfect cleanup Sunday |
| Non-tech users still hit terminal via errors | Plain-language errors; raw stderr under “Technical details” |
| Burnout / slip past Sunday | Hard stop Sunday PM on REV-31/32; ship incomplete P1 as stubs |

--------------------------------------------------------------------------------
8.2  Open questions (resolve Friday morning — Day 0)
--------------------------------------------------------------------------------

1. Is Chat allowed to write code artefacts without opening Builder? (Recommend: yes, save-as-code only.)  
2. One agent model for Chat vs Builder, or different system prompts only? (Recommend: same model, different tool profile + system prompt.)  
3. Project membership / sharing this weekend? (Recommend: **single-user only**.)  
4. Default landing after login? (Recommend: `/app/chat` empty composer + recent rail.)  
5. Brand name in shell: “WalkCroach” only.  
6. SearXNG: self-host vs agent-search bundle? (Recommend: **fastest path Friday** — agent-search Docker or existing host; swap later.)

--------------------------------------------------------------------------------
8.3  Weekend descope order (if a block slips)
--------------------------------------------------------------------------------

**Never cut (definition of done):** Shell + Chat default home · Project
instructions/docs · Builder terminal closed-by-default · Apps list of
deployments · Profile reachable from avatar · Prod deploy.

**Cut next (in order):**
  1. Stripe portal / social auth / account delete  
  2. Monaco polish (tree + read-only viewer OK)  
  3. Citation chrome polish (plain URL list OK)  
  4. Code “save as” from Chat (builder sync into Code library is enough)  
  5. Ecosystem product cards beyond IDE connect link  
  6. `SandboxRuntime` neatness (keep direct WC calls if adapter costs hours)  
  7. Focus mode / Dev mode toggles  

**Do not “slip into next week” as silent scope** — anything cut goes to a dated
follow-up note, not back into this replacement doc as open phases.


================================================================================
9. SUCCESS METRICS
================================================================================

### 9.1  Weekend acceptance (Sunday night — hard gate)

| Check | Pass criteria |
|-------|---------------|
| Replacement cutover | `/` auth users land in `/app/chat`; old `/dashboard` redirects |
| Chat | Attachments + web search on by default + ≥1 citation path |
| Projects | Description + instructions + doc upload affect a later chat |
| Builder | Terminal collapsed by default; Code drawer opens; preview dominant |
| Code | Library lists artefacts from builder (and chat if CH-12/CD-12 shipped) |
| Apps | At least one deployment visible; IDE/Chrome deep links present |
| Profile | Avatar → settings with account + usage + connections |
| Prod | Deployed to live URL; 5-min demo script covers all six surfaces |

### 9.2  Near-term health (7–30 days after weekend ship)

| Metric | Baseline (today) | Target |
|--------|------------------|--------|
| % sessions that are non-builder Chat | ~0% | ≥ 35% of signed-in sessions |
| Builder tasks completed without opening terminal | Terminal always visible | ≥ 70% |
| Projects with ≥1 document or instructions | ~0% | ≥ 40% of active projects |
| Deployments opened from Apps hub | N/A | ≥ 50% of redeploys start from Apps |


================================================================================
APPENDIX A — PROVIDER MATRIX (SUMMARY)
================================================================================

| Capability | Claude | ChatGPT | Gemini | Perplexity | Lovable | Bolt | v0 | Replit | WalkCroach today | WalkCroach target |
|------------|--------|---------|--------|------------|---------|------|----|--------|------------------|-------------------|
| Chat default hub | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ~ | ~ | ✗ | ✓ |
| Projects as knowledge | ✓ | ✓ | Gems≠ | Spaces | weak | weak | weak | ~ | weak | ✓ |
| Artifacts / Code shelf | ✓ | blocks | ~ | ~ | GitHub | files | history | IDE | ✗ | ✓ |
| Attachments | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Web search default | ✓ | ✓ | ✓ | ✓✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (Chat) |
| Preview-first builder | Artifacts | ~ | ~ | ✗ | ✓✓ | IDE | UI | IDE | ~ | ✓✓ |
| Terminal hidden default | n/a | n/a | n/a | n/a | ✓ | ✗ | n/a | ✗ | ✗ | ✓ |
| File tree | n/a | n/a | n/a | n/a | opt | ✓ | ~ | ✓ | ✗ | drawer |
| Deploy / live URL | publish | ~ | ~ | ✗ | ✓ | ✓ | Vercel | ✓ | ✓ | ✓ + Apps |
| Cross-product memory | ~ | ~ | ~ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (CRDB) | ✓✓ surfaced |
| Profile/settings | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| Runtime | cloud | cloud | cloud | cloud | hosted | **WC** | Vercel | VM | **WC** | WC + hybrid |


================================================================================
APPENDIX B — RESEARCH BIBLIOGRAPHY (SELECTED)
================================================================================

General hubs / Projects / Artifacts
  - Claude Help: “What are artifacts and how do I use them?”
  - Claude Code Docs: Share session output as artifacts
  - Formation Claude: Projects vs Artifacts
  - Suprmind: Claude Features 2026 (Projects, Artifacts, Memory, Skills, MCP)
  - Albato: Claude Artifacts guide (2026) — persistent storage, Live Artifacts
  - OpenAI Canvas vs Claude Artifacts comparisons (InstaPods, Promtable, ShareDuo, toolchew)
  - Medium: Canvas removal from GPT-5.5 Instant/Thinking (May 28, 2026)
  - Venture Lab / MindLock / God of Prompt: ChatGPT Projects vs Gemini Gems

App builders
  - TechSifted: Best AI App Builders 2026 (v0, Bolt, Lovable, Replit)
  - NxCode / Banani / Cadence / Autonoma: Lovable vs Bolt UX philosophies
  - andrew.ooo / web3aiblog / nesyona: July–May 2026 builder roundups
  - Pondero: Replit Agent 4 vs Bolt vs Lovable CRUD timing study

Sandboxes / WebContainers
  - PkgPulse: E2B vs Daytona vs WebContainers (2026)
  - TechPlained: WebContainers in 2026
  - Freestyle: WebContainers alternative for AI agents (VM thesis)
  - StackBlitz WebContainers docs (COOP/COEP) — already in plan1.md
  - Ishaaan: WebContainers 101

Web search / tools
  - SearXNG Search API docs (JSON format)
  - agent-search (MIT): self-hosted SearXNG + extract + MCP
  - LangChain / Tavily docs (commercial default)
  - BrowserAct / ColdIQ: search API roundups 2026 (Tavily, Exa, Brave, SearXNG)

Internal
  - `docs/walkcroach-web-prd.md`
  - `docs/walkcroach-web-implementation-plan.md`
  - `docs/plan1.md`
  - Codebase exploration Jul 24, 2026 (BuilderPage, useWebContainer, routes)


================================================================================
APPENDIX C — WEEKEND TICKET SEED (EXECUTE IN ORDER)
================================================================================

Day 0 (Fri)
  1. `feat(db): project instructions/docs + chats/code_artefacts schema`
  2. `feat(web): AppShell + /app routes + legacy redirects`
  3. `feat(agent): tool profiles chat | builder + web_search (SearXNG)`

Day 1 (Sat)
  4. `feat(web): Chat composer attachments + citations`
  5. `feat(web): Project home (instructions, docs, timeline, open Builder)`
  6. `feat(web): Builder TerminalDrawer closed-by-default + CodeDrawer`

Day 2 (Sun)
  7. `feat(web): /app/code library + /app/apps deployments gallery`
  8. `feat(web): /app/settings profile + connections`
  9. `chore: prod deploy + six-surface smoke + demo script`


================================================================================
END OF DOCUMENT
================================================================================
