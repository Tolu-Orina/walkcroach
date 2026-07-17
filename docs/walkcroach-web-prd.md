================================================================================
WALKCROACH WEB — PRODUCT REQUIREMENTS DOCUMENT (PRD)
Beyond-MVP Product Scope, User Journey, and Functional/Non-Functional Requirements
================================================================================

Document owner : WalkCroach team
Surface        : Module 1 — WalkCroach Web (prompt-to-app builder)
Live build     : https://walkcroach.conquerorfoundation.com
Status         : Phases 0-4 of the hackathon implementation plan are complete
                 (agent harness, Lambda + streaming API, WebContainer builder UI,
                 CockroachDB memory layer, CloudFront demo URL). This PRD re-scopes
                 WalkCroach Web itself — the product, not the hackathon submission —
                 based on deep-dive research into the AI app-builder category and a
                 gap analysis against the current build.
Build intent   : EVERY feature and requirement in this PRD is committed for delivery
                 before the August 18, 2026 hackathon deadline. Phasing below is a
                 build SEQUENCE across the ~4.5 weeks remaining (Jul 17 - Aug 18,
                 2026), not a validate-before-you-build gate. Section 9 gives the
                 week-by-week schedule; Section 10 gives an honest, pre-agreed
                 descope order to fall back to only if a specific week slips.
Version        : 2.0 — full-scope, phased-before-deadline delivery plan
Date           : July 2026 (revised)
Companion docs : docs/plan1.md (locked technical/infra architecture — not reopened
                 here except where a new requirement implies an infra change)

--------------------------------------------------------------------------------
HOW TO READ THIS DOCUMENT
--------------------------------------------------------------------------------
This PRD assumes the locked architecture decisions in plan1.md remain in force:
Lambda + API Gateway streaming, WebContainer execution, CockroachDB as the sole
durable memory layer, Amazon Nova 2 Lite via Bedrock, React/TypeScript/Vite/
Tailwind as the generated stack. Nothing here reopens those decisions. What this
PRD adds is the layer plan1.md deliberately left out: the end-to-end USER JOURNEY,
the PRODUCT SURFACE AREA needed to make that journey coherent, and the FUNCTIONAL
and NON-FUNCTIONAL REQUIREMENTS needed to ship it as a real product with defensible
ROI — not just a hackathon demo.

Requirement IDs are stable identifiers for backlog/ticket tracking:
  FR-xx  = Functional Requirement
  NFR-xx = Non-Functional Requirement
  UJ-xx  = User Journey stage
Each requirement has a Priority: MUST (P0) / SHOULD (P1) / COULD (P2), a Phase tag,
and an acceptance-style description. Phase tags now map to a build SEQUENCE inside
the pre-deadline window, not a ship/defer decision:
  PHASE 1 (Jul 17 - Jul 27)  Foundation UX — additive to the current architecture,
                             no new AWS services, unblocks everything after it.
  PHASE 2 (Jul 28 - Aug 5)   Visual editing + generated-app backend/data/secrets.
  PHASE 3 (Aug 6 - Aug 12)   Ownership, deploy/publish, billing/usage.
  PHASE 4 (Aug 13 - Aug 18)  Remaining surface area (social auth, two-way GitHub
                             sync, custom domains, collaboration groundwork) +
                             submission polish (video, README, checklist).
Every requirement below carries one of these four labels — nothing in this PRD is
open-ended "someday" scope. Section 9 lays out the same information as a week-by-
week schedule; Section 10 states the pre-agreed descope order if a week runs over.


================================================================================
1. EXECUTIVE SUMMARY
================================================================================

1.1  The problem with the current scope
--------------------------------------------------------------------------------
The current WalkCroach Web build proves the hard part: a memory-aware codegen
agent that recalls prior decisions across sessions via CockroachDB, running
inside a WebContainer with live preview. That is the core technical bet, and it
works. But "prompt in, preview out, memory persists" is a demo, not a product.
Reviewed end-to-end, the current build has no answer for the questions every
AI app-builder user asks within their first ten minutes:

  - What can I actually build here, and where do I start? (no templates, no
    guided first prompt, no example gallery)
  - What happens if the agent breaks something? (no checkpoints, no rollback,
    no diff review before changes land)
  - Where does my app's DATA live once it needs real users, not just a preview?
    (WebContainer is temporary/in-browser only; there is no story for a
    generated app's own backend/database/auth)
  - How do I get this out of the browser tab and onto the internet, with my
    own domain? (deploy is listed as "deferred / stretch" in plan1.md 4.4)
  - Do I have to re-explain my project every time I open it? (session hydrate
    exists, but there is no project dashboard, no "resume where I left off"
    landing experience)
  - What does this cost me, and why would I pay for it after the free credits
    run out? (no pricing/credit model at all yet)

Every one of these is a solved problem in the category (Lovable, Bolt.new, v0,
Replit Agent all ship answers to all six), which means WalkCroach Web is
currently missing table-stakes surface area, not just "nice to haves."

1.2  The ROI argument for closing these gaps
--------------------------------------------------------------------------------
Industry-wide subscription data for AI-powered apps in 2026 (RevenueCat's State
of Subscription Apps report, aggregating 115,000+ apps and $16B+ in tracked
revenue) shows a specific, well-documented failure pattern that WalkCroach Web
is currently exposed to: AI apps monetize aggressively on first contact (41%
higher revenue per payer than non-AI apps) but churn roughly 30% faster over
12 months (21.1% annual retention vs 30.7% for non-AI apps). The industry's own
diagnosis of why: users get a "wow" moment on first use, but if the product
does not become embedded in a recurring workflow with compounding value, they
hit what the research literature calls the "novelty cliff" — the AI feels
impressive once, then unnecessary. The documented fix is twofold: (1) deep
workflow integration that raises switching cost, and (2) consistent, compounding
value delivery rather than a one-off gimmick.

This is precisely the ROI case for scoping WalkCroach Web properly rather than
shipping the current thin slice:

  - Cross-session MEMORY (already built) is a textbook "compounding value"
    mechanism IF it is visible and reliable to the user — a project dashboard,
    checkpoints, and a visible "the agent remembered X" moment are what turn a
    backend capability into a felt product benefit. Right now the memory layer
    is real but invisible to the end user, which means it currently contributes
    ~0% to retention even though it is the single most differentiated thing
    about the product.
  - CHECKPOINTS/rollback and VISUAL EDIT are what the category has converged on
    as the #1 and #2 requested features after "does it build what I asked for"
    — every competitor researched (Lovable, Bolt.new, Replit Agent) ships both,
    and their own user forums show unprompted feature requests for exactly
    these when absent. Their absence is a credible cause of first-session
    abandonment, which caps the top of the retention funnel before memory ever
    gets a chance to compound.
  - A DEPLOY/EXPORT path is the point at which a "toy" becomes a "thing I
    own" — this is the single highest-leverage feature for the "Real-World
    Impact" judging criterion and, post-hackathon, for word-of-mouth (a shipped
    URL is a marketing asset; a browser tab is not).
  - A CREDIT/PRICING model, even a generous one, is required before ROI can be
    measured at all — without it there is no monetization signal, no way to
    validate willingness-to-pay, and no defensible unit economics story for
    Rinegan/TradeGym-style stakeholders evaluating WalkCroach as a venture
    rather than a hackathon artifact.

1.3  What this PRD proposes
--------------------------------------------------------------------------------
A complete, beyond-MVP scope for WalkCroach Web organized around a full user
journey (Section 3), with every new feature (Section 4) tied to a specific gap
identified in the competitive research (Section 2) and a specific functional/
non-functional requirement (Sections 5-6). The team has committed to building
the ENTIRE scope in this document before the August 18, 2026 deadline. Phase 1-4
labels (Section 9) sequence the work across the ~4.5 remaining weeks so that
each phase unblocks the next without re-architecting the locked backend:
Phase 1 lands the additive, no-new-infra foundation; Phase 2 introduces the one
genuinely new trust boundary (generated-app backend/secrets); Phase 3 completes
ownership/deploy/billing; Phase 4 fills in remaining breadth and hardens the
submission. This is an aggressive schedule for a two-person team — Section 10
names the honest risk and gives a pre-agreed descope order to protect the
highest-ROI items (memory visibility, checkpoints, deploy) if any single week
slips, rather than letting a slip silently erode the whole scope.


================================================================================
2. RESEARCH FINDINGS — WHAT THE CATEGORY HAS ALREADY SOLVED
================================================================================
Deep-dive research (July 2026) into Lovable, Bolt.new/StackBlitz, v0, and
Replit Agent, plus WebContainer's own documented technical constraints and
2026 AI-subscription retention data, surfaced the following patterns directly
relevant to re-scoping WalkCroach Web. This section is the evidence base for
Sections 3-6; each finding is tagged with the feature/requirement it drives.

2.1  Version control is not optional — it is the #1 trust mechanism
  - Every reviewed competitor creates a CHECKPOINT on every AI-driven edit,
    surfaced under a version-history panel, with one-click revert to any prior
    state. Bolt.new's own GitHub issue tracker shows this was originally
    under-built (checkpoints existed but were hard to navigate for long
    sessions) and users explicitly asked for named, user-triggered checkpoints
    in addition to automatic ones — both patterns are now considered baseline.
  - Drives: FR-10 to FR-13 (Section 5.3), UJ-05.

2.2  Visual/inline editing closes the "describe what you mean" gap
  - Lovable's "Visual Edits" (documented in their own engineering blog) computes
    precise diffs from direct manipulation of the live preview (click an
    element, drag, or edit text inline) and triggers HMR immediately, without a
    full agent turn. Their newer "preview toolbar" pattern unifies this into a
    single always-available toolbar over the preview: inline text edit, element
    select + chat, and freehand annotation-to-chat (draw on the preview, attach
    the sketch to a prompt). Inline text edits are explicitly kept FREE (no
    credit cost) up to a daily cap, specifically to keep small, low-stakes
    fixes frictionless — only full agent turns consume metered usage.
  - Drives: FR-14 to FR-17 (Section 5.4), UJ-06.

2.3  The generated app needs a real backend story, not just a sandbox
  - Both Lovable (via "Lovable Cloud" / Supabase auto-provisioning) and Bolt.new
    (Bolt v2 consolidated auth, edge functions, storage, secrets management,
    user management into the core product) treat "my app needs a database, auth,
    and secrets" as a first-session expectation, not an advanced feature. This
    is also a hard technical constraint, not just a UX nicety: WebContainer has
    no supported mechanism for storing secrets/API keys safely inside the
    in-browser sandbox (open StackBlitz feature request, unresolved) and its
    CORS behavior blocks naive calls to most third-party/backend APIs from
    inside the container. A generated app that needs persistent data or an
    external API key CANNOT be safely wired up using WebContainer alone.
  - Drives: FR-18 to FR-23 (Section 5.5), UJ-07 — this is the most
    architecturally significant gap in the current build.

2.4  GitHub sync and code export are the "no lock-in" trust signal
  - Lovable pushes every AI change to a connected GitHub repo automatically
    (two-way sync: edits in either place propagate). Bolt.new offers full
    project ZIP export at any time plus GitHub connection. Both explicitly
    market this as "you are never locked in — take the code and self-host
    whenever you want." Reviewed comparison articles consistently cite the
    ABSENCE of this as the top reason non-technical founders hesitate to build
    anything beyond a throwaway prototype on a given platform.
  - Drives: FR-24 to FR-26 (Section 5.6), UJ-09.

2.5  Templates and a guided first prompt shrink time-to-first-value
  - Lovable ships 80+ production-ready templates across SaaS, internal tools,
    dashboards, and portfolios specifically to give users "a head start" rather
    than a blank prompt box. A blank-box cold start is a well-documented
    activation killer in this category — it forces the least AI-fluent users
    (WalkCroach's own target persona, see Section 3.1) to write the hardest
    prompt of their entire session before they have seen the product do
    anything.
  - Drives: FR-01 to FR-04 (Section 5.1), UJ-01/UJ-02.

2.6  Credit-based, usage-metered pricing is the entire category's model
  - Every reviewed competitor (Lovable $25/mo Pro, Bolt.new $20/mo, v0 $30/user/
    mo Team) uses a credits-or-tokens metered model with a limited free tier,
    typically consuming credits per agent "message"/turn while keeping cheap or
    free actions (inline text edits, chat-only planning) uncharged. The
    consistent user complaint across review sites is "credits run out faster
    than expected, especially when debugging" — i.e., the failure mode is
    opacity about consumption, not the existence of metering itself.
  - Drives: FR-31 to FR-34 (Section 5.8), NFR-15.

2.7  Plan-mode vs build-mode materially reduces unwanted edits
  - Referenced in the original WalkCroach research dossier (Lovable's own
    reported drop in build error rates after separating "Chat/Plan Mode" from
    "Agent/Build Mode") and reflected already in plan1.md's Plan/Build toggle
    (Phase 3.8, built). This PRD extends it: the CURRENT toggle is a mode
    switch with no visible reasoning trail; competitors surface the plan
    itself (a short structured list of intended changes) for user approval
    before edits land, which is the missing half of the pattern.
  - Drives: FR-08, FR-09 (Section 5.2), UJ-04.

2.8  Browser platform constraints WalkCroach Web must design around
  - WebContainer requires Cross-Origin-Embedder-Policy: require-corp and
    Cross-Origin-Opener-Policy: same-origin on the serving origin (already
    handled in infra-web per plan1.md) and is Chromium-first: Firefox does not
    fully support the required cross-origin isolation mode, and Safari support
    is beta-grade even in mid-2026. This is a real, disclosed reach constraint,
    not a bug to "fix."
  - WebContainer state is IN-MEMORY/browser-local and does not survive a tab
    close without explicit export — CockroachDB already solves this for
    WalkCroach's OWN memory (chat, decisions, preferences), but the generated
    PROJECT'S FILES themselves have no durability story beyond the current
    session unless the browser's storage is used or files are synced to
    CockroachDB/S3/GitHub. This is currently a silent data-loss risk.
  - Drives: NFR-01 to NFR-04 (Section 6.1), FR-25 (GitHub sync as durability,
    not just convenience).


================================================================================
3. TARGET USERS AND END-TO-END USER JOURNEY
================================================================================

3.1  Primary persona
--------------------------------------------------------------------------------
"Founder-Builder" — a non-technical or lightly-technical solo founder, product
manager, or small-business owner (the same audience segment WalkCroach's
broader portfolio already targets via TradeGym-style upskilling audiences) who:
  - Has a concrete idea (a landing page, a small internal tool, an MVP to show
    investors or early customers) but cannot hire a developer yet.
  - Has used ChatGPT/Claude conversationally but has never touched an IDE,
    terminal, or Git.
  - Judges the product almost entirely on "did it build what I meant" and "can
    I trust it enough to put my real business in front of it."

Secondary persona: "Technical Tinkerer" — a developer who wants to scaffold
fast and either export to their own repo or hand off to WalkCroach IDE (Module
3) once the shape of the app is right. This persona cares more about code
quality, GitHub sync fidelity, and escape hatches than about hand-holding.

3.2  Current journey (as built today) — gap-annotated
--------------------------------------------------------------------------------
  1. User lands on walkcroach.conquerorfoundation.com
  2. [GAP] No onboarding, no templates, no example prompts — blank chat box
  3. User types a free-form prompt
  4. Agent streams tokens + tool calls; WebContainer applies file writes live
  5. [GAP] No plan preview before edits land in Build mode
  6. Live preview updates in an iframe
  7. [GAP] No checkpoint created; no way to name or revert to this state
  8. [GAP] No way to select/click an element in the preview to request a
     targeted change — every change is a fresh free-text prompt
  9. User refreshes or returns later; session/messages hydrate correctly
     (memory recall works here — this is the one part of the journey that is
     ahead of the category, not behind it)
 10. [GAP] No project dashboard — user cannot see "my projects," cannot start
     a second project without losing context on the first
 11. [GAP] User wants their app to have a signup form / a database table / a
     saved order — no supported path; WebContainer cannot safely hold secrets
     or call external stateful APIs
 12. [GAP] User wants to put this online for a real user to visit — no deploy
     button; the only "export" is the (deferred) stretch item in plan1.md 4.4
 13. [GAP] No pricing, no account limits — the free experience is unbounded and
     un-instrumented, so there is no monetization or capacity-planning signal

3.3  Proposed end-to-end journey (target state, phased — see Section 4)
--------------------------------------------------------------------------------
UJ-01  Landing & sign-in
       Visitor lands on a marketing/product landing page (not the raw builder)
       that explains the memory differentiator in one screen, then signs in
       (Section 5.1). Cold, anonymous "try without an account" access remains
       supported for a single scratch session to preserve today's frictionless
       demo path, but is capped and non-persistent.

UJ-02  Project creation — guided start
       User chooses: (a) start from a template gallery (categorized: landing
       page, internal tool, small SaaS MVP, portfolio), (b) start from a blank
       prompt with 3-5 inspirational example prompts shown, or (c) import an
       existing GitHub repo (Later phase). A project is created in CockroachDB
       immediately (already true today) and the WebContainer boots against the
       chosen starting point.

UJ-03  First build turn
       User describes what they want. Agent responds first with a short PLAN
       (structured list of files/sections it intends to touch) before switching
       to Build mode and applying edits — closing the gap noted in 2.7.

UJ-04  Plan review / approval
       For any turn that will touch more than a small file-count threshold, or
       whenever the user is in "Plan mode," the plan is shown for approval
       (Approve / Adjust / Cancel) before file writes execute. Quick single-
       file text tweaks can skip this by design (kept low-friction, per 2.2).

UJ-05  Live build with checkpoints
       As the agent edits, a CHECKPOINT is created automatically after each
       completed turn (already partially possible via existing build_events —
       this adds a first-class, user-facing checkpoint entity). User can also
       manually name a checkpoint ("this is the version I'm showing my
       investor"). A version-history panel lists checkpoints with one-click
       revert and a readable diff/summary per checkpoint.

UJ-06  Visual/inline refinement
       User can click any element in the live preview to open a targeted edit
       (inline text edit, ask-about-this-element chat scoped to that
       component, or freehand annotation). Inline text edits are free (no
       credit cost, daily cap) per the pattern in 2.2; scoped element chat and
       annotations consume normal usage.

UJ-07  Backend & data wiring
       When the user's request implies persistent data, auth, or a secret
       (detected via prompt classification and/or an explicit "Add a
       database" / "Add sign-in" affordance), WalkCroach provisions a
       project-scoped CockroachDB database (using the SAME cluster/tooling
       already in the architecture — ccloud CLI + Managed MCP Server — but a
       database dedicated to the GENERATED APP's own data, distinct from
       WalkCroach's own memory tables) and a secrets vault (AWS Secrets
       Manager-backed) for any API keys the generated app needs, injected at
       Lambda-proxy or deploy time — never placed inside the WebContainer
       filesystem in plaintext.

UJ-08  Preview → review → deploy
       User reviews the app one more time, then clicks Deploy. WalkCroach
       exports the current WebContainer filesystem, builds a static/serverless
       artifact, and publishes it (S3 + CloudFront, matching the existing
       infra-web pattern) to a WalkCroach-provided subdomain, with a custom-
       domain option later. Deployment history is recorded (deployments
       table already exists in the schema).

UJ-09  Ownership & portability
       User can connect a GitHub repo at any point (before or after deploy);
       from then on, every subsequent AI change two-way-syncs to that repo.
       Full-project ZIP export is available regardless of GitHub connection
       status, at any time, with no plan restriction — this is the "you are
       never locked in" trust signal identified in 2.4.

UJ-10  Return session — memory made visible
       On a later visit, the project dashboard shows the project card with a
       short "what WalkCroach remembers about this project" summary pulled
       from memory_entries (e.g., "muted tones, no salesy copy, uses Inter
       font"), making the existing memory capability VISIBLE rather than only
       operating silently in the background — directly addressing the "0%
       retention contribution" problem named in Section 1.2.

UJ-11  Multi-project management
       Project dashboard lists all of a user's projects with status
       (draft / deployed / archived), last-edited time, and a one-click
       "Open" that hydrates the session exactly as today's single-project
       hydrate already works, generalized to N projects per account.

UJ-12  Usage, billing, and limits
       User can see current credit/usage balance at all times (not just when
       they run out), a breakdown of what consumed credits, and an upgrade
       path when approaching the limit — addressing the "credits run out
       unexpectedly" complaint pattern from 2.6.


================================================================================
4. WALKCROACH WEB — FEATURE SET (BEYOND MVP)
================================================================================
Features are grouped by journey stage. Each entry states the gap it closes and
the build week it lands in. Every item below is committed for delivery by
August 18, 2026 — Phase 1 items are additive to the current Lambda/
WebContainer/CockroachDB architecture and introduce no new AWS services;
Phase 2 introduces the generated-app backend/secrets trust boundary; Phase 3
completes ownership/deploy/billing; Phase 4 fills in remaining breadth and
hardens the submission (see Section 9 for the dated schedule).

4.1  Onboarding & project creation
  - Template gallery (8-12 curated starting templates at launch, not 80+)   PHASE 1
  - Example-prompt carousel on blank-start                                  PHASE 1
  - Guided first-run tooltip tour (dismissible, shown once)                 PHASE 1
  - GitHub repo import as a project starting point                         PHASE 4

4.2  Build loop transparency
  - Structured plan preview before multi-file Build-mode turns              PHASE 1
  - Approve / Adjust / Cancel on plan preview                               PHASE 1
  - Visible tool-call log (already partially present via chat tool chips;
    extend to a persistent, filterable activity panel)                     PHASE 1

4.3  Version control & trust
  - Automatic checkpoint per completed agent turn                           PHASE 1
  - User-named manual checkpoints                                          PHASE 1
  - Version-history panel with diff summary + one-click revert              PHASE 1
  - AS OF SYSTEM TIME-backed "what did the agent believe when it built
    this" debug view (dev-only initially, surfaced to users later)         PHASE 3

4.4  Visual & inline editing
  - Click-to-select element + scoped chat                                  PHASE 2
  - Inline text edit (free, daily-capped, no full agent turn)              PHASE 2
  - Freehand annotation-on-preview attached to next prompt                 PHASE 4

4.5  Backend & data for the generated app
  - "Add a database" affordance provisioning a project-scoped CockroachDB
    database (distinct from WalkCroach's own memory schema)                PHASE 2
  - Managed secrets vault for generated-app API keys (never in WebContainer
    plaintext; injected via a signed backend proxy at runtime/deploy)       PHASE 2
  - "Add sign-in" affordance (email/password to start; social in Phase 4)   PHASE 3

4.6  Ownership, export, portability
  - Full-project ZIP export, always available                              PHASE 1
  - One-way GitHub push (create + push to a new/connected repo)            PHASE 3
  - Two-way GitHub sync (pull external edits back into the session)        PHASE 4

4.7  Deploy & publish
  - One-click deploy to a WalkCroach subdomain (S3 + CloudFront, reusing
    infra-web pattern; completes plan1.md's deferred item 4.4)             PHASE 3
  - Deployment history view (deployments table already modeled)            PHASE 3
  - Custom domain connection                                               PHASE 4

4.8  Returning users & multi-project management
  - Project dashboard (list, status, last-edited, resume)                  PHASE 1
  - "What WalkCroach remembers" summary card per project                   PHASE 1
  - Archive / delete project                                               PHASE 1

4.9  Usage, billing, and account
  - Always-visible credit/usage meter                                      PHASE 3
  - Usage breakdown by action type (agent turn, deploy, storage)           PHASE 3
  - Free tier + metered paid tier (mirroring category-standard structure,
    Section 2.6)                                                          PHASE 3
  - Annual discount option + self-serve upgrade/downgrade + billing portal PHASE 4

4.10  Collaboration
  - Single shareable "view-only preview" link per project (lightweight,
    no accounts required for the viewer)                                  PHASE 4
  - Multi-user edit access, comments, live shared editing                 PHASE 4
    (Scheduled last by design — Section 10 names this the first candidate
    to descope if Phase 4 runs short, since it is the least validated
    demand signal for WalkCroach's solo-founder persona and the most
    expensive to build correctly.)


================================================================================
5. FUNCTIONAL REQUIREMENTS
================================================================================
Each FR: ID | Priority | Phase | Requirement | Notes/Acceptance signal

--------------------------------------------------------------------------------
5.1  Onboarding & Project Creation
--------------------------------------------------------------------------------
FR-01  MUST   PHASE 1  The system shall present a template gallery of at least 8
                    curated starting templates (e.g., landing page, waitlist
                    page, small internal tool, portfolio) when a user creates
                    a new project. Selecting a template pre-populates the
                    WebContainer with that template's file set instead of an
                    empty scaffold.
                    Acceptance: selecting any template boots a working preview
                    within the same latency budget as NFR-05, with no agent
                    turn required before first preview.

FR-02  MUST   PHASE 1  The system shall present at least 5 example prompts on the
                    blank-project start screen, rotated or curated by
                    category, that the user can click to pre-fill the prompt
                    box (editable before submit).

FR-03  SHOULD PHASE 1  The system shall show a one-time, dismissible guided tour
                    (3-5 steps) covering: prompt box, live preview, plan/build
                    toggle, and project dashboard, on a user's first project.

FR-04  COULD  PHASE 4  The system shall support creating a project by importing
                    an existing public or authorized-private GitHub repository
                    as the starting file set.

--------------------------------------------------------------------------------
5.2  Build Loop & Plan Transparency
--------------------------------------------------------------------------------
FR-05  MUST   PHASE 1  (Already built, restated for completeness) The system shall
                    support a Plan mode (no file/shell tool execution) and a
                    Build mode (full tool execution), user-toggleable per turn.

FR-06  MUST   PHASE 1  When a Build-mode turn is estimated to touch more than a
                    configurable file-count threshold (default: 3 files), the
                    system shall first stream a structured plan (list of
                    intended file changes with a one-line reason each) and
                    hold file-write tool execution pending user approval.

FR-07  MUST   PHASE 1  The user shall be able to Approve, Adjust (send a
                    follow-up instruction before any files change), or Cancel
                    a pending plan. Approval resumes the existing agent loop
                    exactly as today's tool_call/tool-result contract defines.

FR-08  SHOULD PHASE 1  Turns below the file-count threshold (e.g., single small
                    text or style tweaks) shall execute directly without a
                    plan-approval gate, preserving today's low-friction path
                    for small changes.

FR-09  SHOULD PHASE 1  The system shall maintain a persistent, filterable activity
                    log per session (tool name, target file/path, timestamp,
                    result summary) sourced from the existing build_events
                    table, visible in a dedicated panel (not only inline chat
                    chips).

--------------------------------------------------------------------------------
5.3  Version Control & Checkpoints
--------------------------------------------------------------------------------
FR-10  MUST   PHASE 1  The system shall create an automatic checkpoint at the
                    completion of every agent turn that produced at least one
                    file write, recording the WebContainer file-tree state (or
                    a diff sufficient to reconstruct it) alongside the
                    existing build_events entry for that turn.

FR-11  MUST   PHASE 1  The user shall be able to view a version-history panel
                    listing checkpoints in reverse-chronological order, each
                    with a short auto-generated summary (e.g., "Added pricing
                    section") and timestamp.

FR-12  MUST   PHASE 1  The user shall be able to revert the active WebContainer
                    session to any prior checkpoint with one click; reverting
                    shall not delete newer checkpoints (they remain accessible
                    for forward-navigation), matching the "never delete,
                    mark superseded" provenance rule already used for
                    memory_entries.

FR-13  SHOULD PHASE 1  The user shall be able to manually create and name a
                    checkpoint at any point during a session, independent of
                    the automatic per-turn checkpoint.

--------------------------------------------------------------------------------
5.4  Visual & Inline Editing
--------------------------------------------------------------------------------
FR-14  MUST   PHASE 2  The user shall be able to click any rendered element in the
                    live preview to select it, revealing a lightweight toolbar
                    with at least: edit text inline, ask about this element
                    (opens chat scoped to that component's file/selector).

FR-15  MUST   PHASE 2  Inline text edits shall apply directly to the underlying
                    source (via DOM-to-source mapping) and trigger the
                    existing WebContainer HMR path without invoking a full
                    agent turn or consuming metered usage, up to a
                    configurable daily-per-user cap (default: 100/day,
                    mirroring the category-standard pattern in 2.2).

FR-16  SHOULD PHASE 2  Inline text edits beyond the daily cap shall fall back to
                    a normal metered agent turn, with the user informed of the
                    cap before the action is taken.

FR-17  COULD  PHASE 4  The user shall be able to draw a freehand annotation
                    directly on the live preview; the annotation image is
                    attached to the next chat message as visual context.

--------------------------------------------------------------------------------
5.5  Backend & Data for the Generated App
--------------------------------------------------------------------------------
FR-18  MUST   PHASE 2  The system shall detect (via prompt classification and/or
                    an explicit "Add a database" UI affordance) when a user's
                    request requires persistent structured data beyond the
                    WebContainer's session-local filesystem, and offer to
                    provision a project-scoped CockroachDB database dedicated
                    to the generated app's own data.

FR-19  MUST   PHASE 2  A project-scoped generated-app database shall be logically
                    and credentially isolated from WalkCroach's own memory
                    schema (projects, sessions, memory_entries, etc.) — no
                    shared credentials, no shared connection pool, distinct
                    least-privilege service account per project database.

FR-20  MUST   PHASE 2  The system shall never place a secret, API key, or database
                    credential inside the WebContainer filesystem in plaintext.
                    Any credential the generated app's runtime code needs at
                    preview time shall be injected via a backend-mediated
                    proxy (the WebContainer calls a WalkCroach-hosted endpoint,
                    which holds the real secret server-side) rather than
                    embedded in client-visible source or environment files.

FR-21  MUST   PHASE 2  Secrets provided by the user (e.g., a third-party API key
                    the generated app should call) shall be stored in AWS
                    Secrets Manager, scoped per project, and never returned in
                    plaintext to the browser after initial entry (write-only
                    from the client's perspective; the UI shows a masked
                    placeholder on any later view).

FR-22  SHOULD PHASE 3  The system shall offer an "Add sign-in" affordance that
                    scaffolds email/password authentication for the generated
                    app, backed by the project-scoped CockroachDB database
                    from FR-18.

FR-23  COULD  PHASE 4  The system shall support social sign-in providers
                    (Google at minimum) for generated-app authentication.

--------------------------------------------------------------------------------
5.6  Ownership, Export & Portability
--------------------------------------------------------------------------------
FR-24  MUST   PHASE 1  The user shall be able to export the current project's full
                    file tree as a downloadable ZIP archive at any time,
                    regardless of account plan or credit balance.

FR-25  MUST   PHASE 3  The user shall be able to connect a GitHub account and push
                    the current project to a new or existing repository.
                    Subsequent Build-mode turns shall commit changes to that
                    repository (one-way: WalkCroach to GitHub) in addition to
                    the existing checkpoint mechanism.

FR-26  COULD  PHASE 4  The system shall support two-way GitHub sync: changes
                    pushed to the connected repository from outside WalkCroach
                    shall be pulled into the active session's WebContainer
                    file tree, with conflict handling consistent with the
                    superseded_by provenance pattern used elsewhere.

--------------------------------------------------------------------------------
5.7  Deploy & Publish
--------------------------------------------------------------------------------
FR-27  MUST   PHASE 3  The user shall be able to trigger a one-click Deploy action
                    that builds a static/serverless production artifact from
                    the current WebContainer file tree and publishes it to a
                    WalkCroach-provided subdomain (e.g.,
                    {project-slug}.walkcroach.app), reachable over HTTPS.

FR-28  MUST   PHASE 3  Every deploy action shall create a row in the existing
                    deployments table (target, url, status, deployed_at) and
                    the user shall be able to view deployment history for a
                    project.

FR-29  SHOULD PHASE 4  The user shall be able to connect a custom domain to a
                    deployed project, with WalkCroach providing DNS/CNAME
                    setup instructions and automatic TLS provisioning.

FR-30  COULD  PHASE 4  The system shall support rollback of a live deployment to
                    a prior deployment record, independent of the in-session
                    checkpoint mechanism in Section 5.3.

--------------------------------------------------------------------------------
5.8  Returning Users, Multi-Project & Memory Visibility
--------------------------------------------------------------------------------
FR-31  MUST   PHASE 1  The system shall present a project dashboard on sign-in,
                    listing all of the user's projects with name, status
                    (draft / deployed / archived), and last-edited timestamp.

FR-32  MUST   PHASE 1  Each project card on the dashboard shall display a short,
                    auto-generated "what WalkCroach remembers" summary,
                    sourced from that project's highest-relevance
                    memory_entries rows (kind=preference or kind=decision),
                    making the existing cross-session memory capability
                    visible to the user without requiring a chat turn.

FR-33  MUST   PHASE 1  The user shall be able to archive or permanently delete a
                    project. Archiving shall preserve all CockroachDB records
                    (soft-delete pattern, consistent with superseded_by
                    provenance) while removing the project from the default
                    dashboard view. Deletion shall be a distinct, confirmed
                    action.

FR-34  SHOULD PHASE 1  Opening any existing project from the dashboard shall
                    hydrate the session (messages, pending_tool, file state)
                    using the existing session-hydrate mechanism, generalized
                    from today's single-project implicit flow to explicit
                    per-project selection.

--------------------------------------------------------------------------------
5.9  Usage, Billing & Account
--------------------------------------------------------------------------------
FR-35  MUST   PHASE 3  The system shall display the user's current credit/usage
                    balance at all times within the builder UI (not only when
                    exhausted), with a running breakdown by action type (agent
                    turn, deploy, database provisioning).

FR-36  MUST   PHASE 3  The system shall define a free tier with a fixed monthly
                    credit allotment sufficient to complete at least one small
                    project end-to-end (build + one deploy), and at least one
                    metered paid tier above it.

FR-37  SHOULD PHASE 4  The system shall support self-serve upgrade and downgrade
                    between plans, and an annual billing option at a discount
                    to the monthly rate, consistent with category-standard
                    retention practice (Section 2.6/1.2).

FR-38  SHOULD PHASE 4  The user shall have access to a billing portal (invoices,
                    payment method, cancellation) without contacting support.

--------------------------------------------------------------------------------
5.10  Cross-cutting
--------------------------------------------------------------------------------
FR-39  MUST   PHASE 1  All new user-facing entities introduced by this PRD
                    (checkpoints, deployments, credit ledger, secrets
                    metadata) shall be persisted in CockroachDB, consistent
                    with the existing architectural principle that
                    CockroachDB is the sole system of record — no new
                    external state store shall be introduced without an
                    explicit, documented exception.

FR-40  MUST   PHASE 1  Every new write path introduced by this PRD shall reuse
                    the existing serializable-transaction and
                    superseded_by/never-delete provenance patterns already
                    established for memory_entries, rather than introducing a
                    new, inconsistent persistence convention.


================================================================================
6. NON-FUNCTIONAL REQUIREMENTS
================================================================================

6.1  Performance & Latency
--------------------------------------------------------------------------------
NFR-01 MUST  Time to first streamed token after a prompt submission shall not
             exceed 2.5 seconds at the p50 and 5 seconds at the p95, measured
             from client request to first NDJSON token event.
NFR-02 MUST  Time to a working live preview from selecting a template (FR-01)
             shall not exceed 8 seconds at p50 (WebContainer boot + template
             file write + dev-server ready), independent of any agent call.
NFR-03 SHOULD Inline text edits (FR-15) shall reflect in the live preview via
             HMR within 500ms of the user confirming the edit, since this path
             is explicitly designed to feel instantaneous relative to full
             agent turns.
NFR-04 SHOULD Checkpoint creation (FR-10) shall not add more than 300ms of
             perceptible latency to the end of a completed agent turn; it
             shall be performed asynchronously relative to the "done" stream
             event where possible.
NFR-05 MUST  One-click Deploy (FR-27) shall complete (artifact build +
             publish + CDN availability) within 90 seconds at p50 for a
             template-sized project, with progress feedback shown throughout
             (no silent multi-second gaps without a status indicator).

6.2  Scalability & Capacity
--------------------------------------------------------------------------------
NFR-06 MUST  The backend shall support at least 500 concurrent active build
             sessions without p95 latency (NFR-01) degrading by more than 25%,
             using Lambda's existing horizontal-scaling model — no
             architectural change required to meet this at MVP+ scale.
NFR-07 SHOULD The CockroachDB schema and query patterns (especially
             recall_project_memory's C-SPANN vector search) shall maintain
             sub-200ms p95 query latency as memory_entries grows past
             1 million rows across all projects, validated by load testing
             before general availability of FR-32 (memory-visibility on
             dashboard, which runs this query on every dashboard load).
NFR-08 COULD  The system shall support horizontal partitioning/locality
             configuration (CockroachDB multi-region) for future geographic
             expansion without a schema rewrite, per the multi-region-capable
             design already noted in the broader WalkCroach architecture
             dossier.

6.3  Reliability & Availability
--------------------------------------------------------------------------------
NFR-09 MUST  The publicly reachable builder UI and deploy pipeline shall
             target 99.5% monthly uptime, consistent with a single-region
             MVP+ product (not yet claiming enterprise SLA-grade
             availability).
NFR-10 MUST  A browser tab crash or accidental close shall not lose any
             agent-confirmed state: all messages, build_events, checkpoints,
             and memory_entries already committed to CockroachDB before the
             crash shall be fully recoverable on next session hydrate.
             In-flight, unconfirmed WebContainer edits at the moment of crash
             MAY be lost — this is a disclosed limitation of client-side
             execution, not a defect, and shall be clearly communicated in
             product copy (e.g., "auto-saved as of your last message").
NFR-11 SHOULD A failed Deploy action (FR-27) shall not corrupt or roll back
             the prior live deployment; the previous deployment shall remain
             serving traffic until the new one is confirmed healthy
             (blue/green-style cutover), consistent with FR-30's rollback
             requirement.
NFR-12 SHOULD The agent loop shall gracefully handle a Bedrock throttling or
             transient-error response by retrying with backoff at least
             twice before surfacing an error to the user, and any partial
             tool-call state shall be recoverable via the existing
             pending_tool mechanism rather than requiring the user to restart
             the session.

6.4  Security & Data Protection
--------------------------------------------------------------------------------
NFR-13 MUST  No secret, API key, or database credential shall ever be
             transmitted to or stored within the browser/WebContainer runtime
             in a form retrievable by client-side JavaScript, per FR-20/FR-21.
             This shall be verified by an explicit security test that
             attempts to read injected secrets from within a generated app's
             client bundle.
NFR-14 MUST  All CockroachDB service-account credentials (WalkCroach's own,
             and any per-project generated-app database credentials from
             FR-19) shall be least-privilege scoped and stored exclusively in
             AWS Secrets Manager, never in source control, build logs, or
             client-visible configuration.
NFR-15 MUST  Every billing-relevant action (FR-35/FR-36) shall be logged with
             enough detail (user, project, action type, credit cost,
             timestamp) to reconstruct any disputed charge, stored in
             CockroachDB under the same serializable-transaction guarantees
             as other structured data.
NFR-16 SHOULD User authentication (account sign-in, distinct from any
             generated-app end-user auth in FR-22) shall support at minimum
             email/password with secure password storage (bcrypt/argon2 or
             equivalent) and SHOULD support OAuth (GitHub, Google) given the
             existing GitHub integration surface in FR-25.
NFR-17 MUST  The Managed MCP Server connection shall remain read-only by
             default for any new automated process introduced by this PRD
             (e.g., a scheduled memory-summary job for FR-32); explicit write
             scopes shall be granted per-service-account only where a
             requirement demands it (e.g., FR-10 checkpoint writes), per the
             consent-gated write posture already established in the
             architecture dossier.

6.5  Usability & Accessibility
--------------------------------------------------------------------------------
NFR-18 MUST  The onboarding flow (FR-01-FR-03) shall be completable by a
             first-time, non-technical user without external documentation,
             validated via unmoderated usability testing with at least 5
             representative Founder-Builder-persona participants before
             general availability.
NFR-19 SHOULD The builder UI shall meet WCAG 2.1 AA contrast and keyboard-
             navigation standards for all WalkCroach-authored chrome (chat
             panel, dashboard, version-history panel, toolbar) — this
             requirement applies to WalkCroach's OWN interface, not to
             arbitrary AI-generated app output, which is user-directed
             content outside WalkCroach's control.
NFR-20 SHOULD Error states (failed tool call, Bedrock error, deploy failure)
             shall always present a plain-language explanation and a
             concrete next action (retry, revert to last checkpoint, contact
             support), never a raw stack trace or opaque error code as the
             primary message.

6.6  Compatibility
--------------------------------------------------------------------------------
NFR-21 MUST  WalkCroach Web shall be fully functional on the latest two major
             versions of Chrome, Edge, and Brave (Chromium-based), consistent
             with WebContainer's documented first-class support tier.
NFR-22 SHOULD WalkCroach Web shall degrade gracefully on Firefox and Safari
             (informational banner explaining reduced/beta support for the
             live-preview/WebContainer feature specifically) rather than
             failing silently or presenting a blank screen, given WebContainer's
             documented partial cross-origin-isolation support on those
             browsers.
NFR-23 COULD  The project dashboard, billing, and account-management surfaces
             (which do not depend on WebContainer) shall remain fully usable
             on Firefox/Safari even where the live builder itself is
             degraded, so a user is never fully locked out of managing their
             account.

6.7  Observability & Operability
--------------------------------------------------------------------------------
NFR-24 MUST  Every new backend code path introduced by this PRD (checkpoint
             writes, deploy pipeline, secrets proxy, billing ledger) shall
             emit structured CloudWatch logs sufficient to trace a single
             user action end-to-end, consistent with the existing
             observability pattern for Bedrock latency and memory-write
             failures.
NFR-25 SHOULD Key funnel metrics from Section 7 (activation, checkpoint usage,
             deploy completion, return-session memory-recall rate) shall be
             instrumented from day one of each feature's release, not added
             retroactively.
NFR-26 SHOULD A synthetic end-to-end smoke test (template select → prompt →
             preview → deploy) shall run on a schedule against the production
             environment, alerting the team before users encounter a broken
             critical path.

6.8  Cost Efficiency
--------------------------------------------------------------------------------
NFR-27 MUST  New AWS resources introduced by this PRD (secrets proxy, deploy
             pipeline compute) shall follow the existing "scale to $0 idle"
             principle already locked for Module 1 (Lambda-first, no
             always-on compute) unless a specific NFR above (e.g., NFR-05
             deploy latency) cannot be met without provisioned capacity, in
             which case the exception shall be explicitly documented.
NFR-28 SHOULD Per-project-database provisioning (FR-18) shall default to
             CockroachDB's smallest viable tier/shared-cluster pattern rather
             than a dedicated cluster per project, to keep marginal cost per
             free-tier user low enough to sustain the free tier defined in
             FR-36.


================================================================================
7. SUCCESS METRICS
================================================================================
These metrics operationalize the ROI argument in Section 1.2 and should be
instrumented per NFR-25.

  Activation
    - % of new sign-ups reaching a working live preview within their first
      session (target: >70%, informed by NFR-02's latency budget existing to
      support this)
    - Time-to-first-preview (median), tracked from FR-01/FR-02 onward

  Engagement / compounding value (the retention hypothesis from 1.2)
    - % of returning sessions where the "what WalkCroach remembers" summary
      (FR-32) is shown and where the user's next prompt does NOT re-state a
      previously captured preference (a direct behavioral signal that memory
      is doing its job, not just a technical checkbox)
    - Checkpoint usage rate (% of sessions using at least one manual revert)
      as a trust proxy
    - Visual/inline edit adoption rate once shipped (FR-14/FR-15)

  Conversion to ownership (the "Real-World Impact" proxy)
    - % of projects that reach at least one Deploy action (FR-27)
    - % of projects that connect GitHub (FR-25) or export a ZIP (FR-24)

  Monetization (once FR-35/FR-36 ship)
    - Free-to-paid conversion rate
    - 12-month payer retention, benchmarked explicitly against the 21.1%
      AI-app-category median cited in Section 1.2 — WalkCroach's differentiated
      memory/checkpoint/deploy loop should be judged against whether it beats
      this category benchmark, not against an arbitrary internal target.


================================================================================
8. OUT OF SCOPE FOR THIS PRD
================================================================================
Everything IN this PRD (Sections 4-6) is committed for delivery by the
deadline — see Section 9 for the schedule. The items below are the only
things genuinely excluded, because they sit outside WalkCroach Web itself:
  - WalkCroach Chrome and WalkCroach IDE (Modules 2 and 3) — covered by
    plan1.md Phases 5-6 and the original three-surface product overview;
    a separate workstream from this document, not phased alongside it.
  - Non-React/Vite generated stacks (Vue, Svelte, multi-service backends) —
    remains out of scope per plan1.md's locked "opinionated stack" decision;
    nothing in this PRD reopens that.
  - Enterprise features (SSO/SAML, audit-log export, dedicated clusters,
    contractual SLAs) — premature before free/paid-tier product-market fit is
    established via Section 7's metrics; revisit post-deadline.
  - Real-time, simultaneous multi-cursor collaborative editing (as opposed
    to the shareable view-only link and basic multi-user access in Section
    4.10, which ARE in scope for Phase 4) — full simultaneous co-editing is a
    materially larger engineering effort (presence, conflict resolution at
    the keystroke level) than the rest of this PRD and is deferred past the
    deadline on its own.


================================================================================
9. PHASING SUMMARY — WEEK-BY-WEEK SCHEDULE TO AUG 18, 2026
================================================================================
Today: July 17, 2026. Deadline: August 18, 2026, 5:00 PM EDT (~4.5 weeks / 32
days). All four phases below are committed; nothing here is contingent on
validation. Each phase has an exit bar — do not start the next phase's build
until the current phase's exit bar is met, to avoid compounding integration
risk this close to a hard deadline.

--------------------------------------------------------------------------------
PHASE 1 — Foundation UX            Jul 17 (Thu) -> Jul 27 (Mon)   [~10 days]
--------------------------------------------------------------------------------
Scope   : FR-01, FR-02, FR-03, FR-05..FR-13, FR-24, FR-31..FR-34, FR-39, FR-40
Theme   : Make the existing memory/agent loop VISIBLE and TRUSTWORTHY — no new
          AWS services, entirely additive to the shipped Lambda/WebContainer/
          CockroachDB stack.
Exit bar: Template gallery + example prompts live; plan-preview/approve gate
          live; automatic + manual checkpoints with one-click revert live;
          project dashboard with "what WalkCroach remembers" card live;
          ZIP export live.

--------------------------------------------------------------------------------
PHASE 2 — Visual editing + generated-app backend   Jul 28 (Tue) -> Aug 5 (Wed)  [~9 days]
--------------------------------------------------------------------------------
Scope   : FR-14..FR-16, FR-18..FR-21
Theme   : The one genuinely new trust boundary in this PRD — a project-scoped
          CockroachDB database and a secrets vault for the GENERATED APP's own
          data/keys, plus click-to-edit on the live preview.
Exit bar: Click-to-select + inline text edit + scoped chat live; "Add a
          database" provisions an isolated, least-privilege-scoped CockroachDB
          database per project; secrets proxy passes the NFR-13 plaintext-leak
          test (Section 6.4) before this phase is considered closed.

--------------------------------------------------------------------------------
PHASE 3 — Ownership, deploy, billing         Aug 6 (Thu) -> Aug 12 (Wed)  [~7 days]
--------------------------------------------------------------------------------
Scope   : FR-22, FR-25, FR-27, FR-28, FR-35, FR-36
Theme   : Turn a browser-tab project into something owned, shipped, and
          metered.
Exit bar: One-click Deploy live (S3 + CloudFront) with deployment history;
          GitHub one-way push live; "Add sign-in" (email/password) live;
          always-visible credit meter + free/paid tier live.

--------------------------------------------------------------------------------
PHASE 4 — Remaining breadth + submission polish   Aug 13 (Thu) -> Aug 18 (Tue)  [~6 days]
--------------------------------------------------------------------------------
Scope   : FR-04, FR-17, FR-23, FR-26, FR-29, FR-30, FR-37, FR-38, Section 4.10
          (share link + basic multi-user access), plus hackathon submission
          requirements (architecture diagram, demo video, README, CRDB/AWS
          usage statements — plan1.md Section 6.4/6.5).
Theme   : Round out breadth where time allows; protect the deadline above all
          else in this final window.
Exit bar: Submission checklist (plan1.md Section 15) complete. If Phase 1-3
          ran on schedule, all Phase 4 items are attempted in the order listed
          in Section 10's descope table; if any prior phase slipped, Phase 4
          time goes first to submission polish, then to Phase 4 features in
          that same priority order.

Note on sequencing logic: Phases 1-3 are ordered by dependency and by ROI
(Section 1.2/7) — memory visibility and trust (Phase 1) must exist before
visual editing matters (Phase 2), and a generated app needs a place to put
data (Phase 2) before "ship it" (Phase 3, Deploy) is meaningful. Phase 4 is
intentionally the only phase with no hard internal dependencies, which is why
it is also the phase most able to absorb schedule pressure.


================================================================================
10. RISKS SPECIFIC TO THIS PRD
================================================================================
10.1  Timeline risk — stated plainly
--------------------------------------------------------------------------------
This is a full beyond-MVP product scope (40 functional requirements spanning
onboarding, checkpoints, visual editing, a new generated-app backend/secrets
system, deploy pipeline, billing, and collaboration) committed to a ~4.5-week
window for a two-person team, on top of finishing the hackathon submission
artifacts. That is genuinely aggressive. This PRD does not soften that fact —
instead, it fixes the descope order BEFORE the deadline pressure hits, so that
if a phase slips, the team is cutting from a pre-agreed list instead of making
that decision under stress in the final week.

10.2  Pre-agreed descope order (only invoked if a phase exit bar is missed)
--------------------------------------------------------------------------------
If — and only if — a phase's exit bar (Section 9) is not met by its end date,
cut from the BOTTOM of this list first. Items are ordered by ROI-per-build-hour
(Section 1.2/7), so the highest-retention-impact items are protected longest:

  1.  (Protect first, cut last)  Phase 1 memory-visibility + checkpoints —
      this is the single highest-ROI item in the whole PRD (Section 1.2); it
      must ship even if everything below it is cut.
  2.  Phase 3 Deploy (FR-27/FR-28) — the "Real-World Impact" judging-criterion
      proxy; protect above billing and visual editing.
  3.  Phase 2 generated-app database + secrets (FR-18..FR-21) — cut the
      "Add sign-in" affordance (FR-22) before cutting the database/secrets
      core, since a database with no auth is still useful; auth with no
      database is not.
  4.  Phase 2 visual/inline editing (FR-14..FR-16) — high user-facing polish,
      lower judging-criterion weight than items 1-3.
  5.  Phase 3 billing/credits (FR-35/FR-36) — needed for the ROI STORY but not
      for the hackathon submission itself; can ship in a minimal "usage
      counter, no real payment processor yet" form if Stripe integration
      (Section 10.3) is not resolved in time.
  6.  Phase 4 breadth (FR-04, FR-17, FR-23, FR-26, FR-29, FR-30, FR-37, FR-38)
      — cut individually as needed; none of these block any other item.
  7.  (Cut first if any time pressure at all)  Section 4.10 collaboration —
      explicitly the least validated, most expensive-per-feature item in the
      PRD; the share-link half is cheap and can stay, multi-user edit access
      is the first thing to drop.

10.3  Other risks
--------------------------------------------------------------------------------
  - Secrets/backend-for-generated-apps (FR-18..FR-21) is the single most
    architecturally novel addition in this PRD — it introduces a new trust
    boundary (WalkCroach holding a THIRD party's, i.e. the end-user's own
    generated app's, secrets) that the current architecture has not modeled
    at all. Given the compressed Phase 2 window, run a short, dedicated
    security review in the first 1-2 days of Phase 2 (against FR-18..FR-21
    and NFR-13/NFR-14) before writing the provisioning code, not after.
  - Credit/billing (FR-35..FR-38) requires a payment-processor decision
    (Stripe is the category default per Section 2.3/2.6) not yet made
    anywhere in the existing architecture docs — this needs to be decided in
    Phase 1 (even though the feature builds in Phase 3) so Phase 3 is not
    blocked on a vendor decision with only 7 days on the clock.
  - Two people, four phases, one deadline: Phase 1-3 have hard dependencies
    on each other (Section 9's sequencing note) — a slip in Phase 1 or 2
    propagates directly into Phase 3/4's available time. Track phase exit
    bars explicitly (a daily or every-other-day check-in against Section 9)
    rather than discovering a slip only at the phase boundary.
  - Retention-benchmark honesty: Section 7's 21.1% category-median retention
    figure should be revisited against fresh data before being used
    externally (e.g., in investor conversations), since 2026 AI-subscription
    retention data is moving quickly and this PRD's figure is current only
    as of July 2026.


================================================================================
END OF DOCUMENT
================================================================================