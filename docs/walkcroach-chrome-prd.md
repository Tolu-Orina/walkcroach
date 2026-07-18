# WalkCroach Chrome — Product Requirements Document

**Module:** Module 2 — WalkCroach Chrome (the copilot)
**Status:** Re-scoping "Phase 5" from plan1.md's narrow developer-only stub into a full cross-sector SME product
**Companion docs:** `docs/plan1.md` (original architecture), `WalkCroach_Web_PRD.md` (Module 1, shared memory backbone)
**Version:** 1.0
**Date:** July 2026

---

## How to read this document

The original hackathon plan (`plan1.md`, Phase 5) scoped WalkCroach Chrome as a narrow feature: a floating action button that captures a page and feeds it into a WalkCroach Web builder session, purely to demonstrate cross-surface memory for the judges. That scope is real but too small to be a product — it only creates value for a user who is *also* actively building an app in WalkCroach Web, which excludes almost every non-developer.

This PRD re-scopes WalkCroach Chrome as a **standalone productivity copilot for SMEs and non-technical professionals across multiple sectors**, which happens to share WalkCroach's CockroachDB memory backbone and therefore *also* satisfies the original cross-surface-memory goal when a user has both surfaces. Chrome must deliver value on day one to someone who has never heard of WalkCroach Web and never will.

**A scheduling note, stated plainly:** the WalkCroach Web PRD already allocates the entire remaining runway to the hackathon deadline (Jul 17 – Aug 18, 2026) across four build phases. This PRD does not assume Chrome development displaces that plan — it assumes Chrome is either a parallel track with separate capacity, or a fast-follow immediately after submission. Section 12 states this assumption explicitly and flags it as a risk to resolve before committing a start date.

---

## 1. Executive summary

### 1.1 What deep-dive research found

Browser-based AI copilots are a mature, fast-growing 2026 category (Monica, Sider, Merlin, Perplexity's extension, Grammarly, Bardeen, Tactiq, Gemini in Chrome), and the research surfaced three findings that directly reshape WalkCroach Chrome's scope:

1. **The highest-value use cases are not developer use cases.** Across every reviewed source, the categories generating the most measurable time-savings are: research/summarization without tab-switching, writing assistance (email, replies, outreach), and browser-based workflow automation for **sales, recruiting, customer success, and operations** roles — not coding. Bardeen's own positioning explicitly targets "sales, recruiting, operations, and productivity" professionals, and reports users saving 10+ hours weekly on exactly these tasks.

2. **SME AI adoption is real but sector-uneven, and the gap is the opportunity.** 2026 adoption data shows information services (39%), professional/technical services (30%), financial services (~30%), healthcare (~50%), and retail/e-commerce (~42%) already well ahead — while **construction (8.9%), transportation (5.4%), and hospitality (~8%) lag far behind**, not because these sectors have no use for AI, but because tools built for knowledge workers don't fit trades, hospitality, and field-based businesses. This is a direct overlap with WalkCroach's own portfolio audience (TradeGym's blue-collar upskilling focus) and represents genuine first-mover opportunity rather than a crowded, contested segment.

3. **Trust, not capability, is the adoption blocker — and it dictates the product's design philosophy.** 82% of SMBs report at least one barrier to going deeper with AI: data security concerns lead at 33% (up from 23% a year earlier), distrust of AI accuracy is close behind at 31%, and a full 78% of SMB owners do not trust AI to handle even low-level tasks *without human oversight*. Separately, 45-47% cite a skills gap or difficulty choosing the right tool. This means WalkCroach Chrome's competitive edge cannot be "does more autonomously" (the Bardeen/browser-automation direction) — it has to be "does less, but transparently, with zero setup and the user always in the loop," which is a different design philosophy from most of the category.

### 1.2 The repositioning

WalkCroach Chrome becomes: **a floating copilot that summarizes, drafts, and remembers — never acts without a click — and recognizes what kind of page you're on well enough to offer the right shortcut, whether that's drafting a reply, tracking a price, or saving a candidate's profile.** It is deliberately *not* a no-code automation builder (Bardeen's territory, and the wrong fit given the skills-gap barrier) and *not* a fully autonomous browsing agent (Prophet/Monica's "Browser Operator" direction, and the wrong fit given the 78% oversight-trust barrier). It is closer to Monica/Sider's assistant model, but with two differentiators neither has: **sector-aware quick actions** instead of one generic assistant for everyone, and **durable, recallable memory in CockroachDB** instead of per-session chat history that evaporates.

### 1.3 Why this is still "agentic memory," not scope creep

Every capture, draft, and quick action still writes to the same `page_captures` / `memory_entries` tables and C-SPANN vector index already modeled in the architecture. Broadening the target audience does not change the backend — it changes what triggers a save and who benefits from recall. A recruiter's saved candidate profiles, a retailer's tracked competitor prices, and a founder's design references are the same underlying mechanism (a captured page + an embedding + a workspace it belongs to). This PRD is a UX and positioning re-scope, not an architecture re-scope.

---

## 2. Market research findings (detailed)

### 2.1 Competitive landscape

| Product | Core model | Strength | Gap relative to WalkCroach Chrome |
|---|---|---|---|
| **Monica** | Side panel + floating toolbar, multi-LLM | Best-in-class email/content drafting; automatic page-context injection (no copy-paste) | No durable, structured, queryable memory across sessions — chat history only; not sector-aware |
| **Sider** | Side panel, multi-model | Strong all-in-one assistant, good text-selection toolbar | Same memory limitation as Monica; generic, not sector-tuned |
| **Merlin** | Side panel | Broad feature set, competitive pricing | Same category-wide memory limitation |
| **Perplexity (extension)** | Research-first, cited answers | Best-in-class sourced research/Q&A | Narrow: research only, no capture/recall workspace, no writing assistance depth |
| **Grammarly** | Inline writing overlay | Ubiquitous, trusted, works on any text field | Single-purpose (writing quality only); no research, capture, or memory |
| **Bardeen** | No-code browser automation ("playbooks") | Deepest automation: scraping, CRM updates, multi-step workflows; strong in sales/recruiting/real estate | Real learning curve for non-technical users (explicitly noted in its own reviews); requires the user to *build* workflows, which the skills-gap data (45-47% of SMEs) says is exactly the wrong ask for this audience |
| **Tactiq** | Meeting transcription | Best-in-class for meeting notes/action items | Single-purpose; no general page assistant |
| **Gemini in Chrome** | Native browser integration | Zero-install advantage, tab comparison, YouTube Q&A | Not sector-aware; general Google ecosystem assistant, not workspace/memory-oriented |

**The consistent gap across the entire category:** every reviewed competitor is either (a) a generic assistant with no durable structured memory, or (b) a powerful-but-technical automation builder with a real adoption barrier for the least AI-confident SME segment. Nothing in the category combines "zero-setup, always-in-the-loop assistant" with "durable, recallable, sector-aware memory." That combination is WalkCroach Chrome's position.

### 2.2 Sector opportunity, ranked by fit

Ranked by a combination of (a) documented pain point intensity, (b) current AI-adoption headroom, and (c) how well a lightweight, non-automation-builder copilot fits the workflow:

| Sector | Adoption today | Primary pain point a copilot addresses | Fit |
|---|---|---|---|
| Sales / business development | High-adopting, but tool-fragmented | Prospect research, lead/company summarization, outreach drafting | Strong — well-documented demand (Bardeen, HubSpot Sales extension both validate this) |
| Recruiting / HR (SME-scale) | Moderate | Candidate profile extraction from LinkedIn/job boards, screening notes | Strong — explicitly named as a top Bardeen use case; scoped-down (extract + save, not auto-apply) fits WalkCroach's trust-first design |
| Retail / e-commerce (small sellers) | ~42% adoption | Competitor price tracking, product research, listing copy drafting | Strong — retail/e-commerce already has the highest non-tech-sector adoption rate, meaning the audience is already primed |
| Real estate (independent agents, small brokerages) | Moderate | Listing summarization, comparable-property research, client follow-up drafting | Strong — Bardeen's own case studies single out real estate for exactly this pattern |
| Customer support / success (small teams) | High documented ROI | Reply drafting grounded in saved context, FAQ/ticket summarization | Strong — SME research names AI-powered customer messaging as the single fastest, most measurable ROI use case for small businesses |
| Trades, construction, hospitality | 5-9% adoption (lowest of any sector) | Admin overhead (quotes, supplier research, customer messages) — not the same browsing-heavy pattern as the above | Moderate, longer-term — genuine first-mover opportunity and direct overlap with WalkCroach's own TradeGym audience, but the workflow is less browser-centric (more mobile/on-site), so this is a Phase-3+ sector, not launch-critical |
| Solo founders / generalist SME owners | Growing fast | Everything above, in smaller volume, plus general research and writing | Strong — this is the "Founder-Builder" persona already defined in the WalkCroach Web PRD, and Chrome should feel like the same product family to this exact person |

### 2.3 The trust design constraint, restated as a set of product rules

Because 78% of SMB owners do not trust AI to act without oversight and 33% cite data security as a primary barrier, WalkCroach Chrome adopts these as non-negotiable product rules, not just NFRs:

- Every capture, draft, or extraction is a **proposal the user clicks to accept** — nothing is saved, sent, filled, or posted automatically.
- The extension requests the narrowest possible browser permission at install time and asks for site access **only when the user first invokes it on a given site**, not a blanket all-sites grant up front.
- What was captured and where it went is **always visible**, not buried in a settings page.
- No page content is sent anywhere until the user takes an action that requires it (opening the panel does not silently transmit the page).

---

## 3. Product vision

**WalkCroach Chrome is the copilot that shows up wherever an SME's work already happens — a job board, a competitor's storefront, a listing site, an inbox — reads the page well enough to offer one useful, specific action instead of a blank chat box, and remembers what you saved, in your own words, the next time you need it.**

It is one product in the WalkCroach family: the same CockroachDB-backed memory principle as WalkCroach Web, applied to browsing instead of building. A user who only ever uses Chrome should feel it is a complete, valuable product on its own. A user who also uses WalkCroach Web should feel the two surfaces know each other.

---

## 4. Target users and personas

### 4.1 Primary persona — "Solo Operator"
A small-business owner or independent professional (sales rep, recruiter, real-estate agent, retail seller, support lead) who spends significant time in the browser doing research, outreach, or admin, has little time or appetite to learn a workflow-automation tool, and is cautious about handing an AI tool access to sensitive data or the ability to act on their behalf. This persona maps directly onto the sectors ranked "Strong" in Section 2.2, and overlaps with the WalkCroach Web PRD's "Founder-Builder" persona where the two products' users intersect.

### 4.2 Secondary persona — "Team Member at a Small Company"
An employee at a small (2-50 person) company — a support agent, a junior recruiter, a marketing coordinator — who does not own the AI-adoption decision but benefits from a tool that requires no admin setup, works immediately, and doesn't require IT approval for broad permissions (directly relevant given enterprise/SME Chrome-extension security policies increasingly require allowlisting and least-privilege review).

### 4.3 Tertiary persona — "WalkCroach Web builder"
The existing Module 1 user, for whom Chrome's page-capture feature feeds directly into their active build project's memory, exactly as scoped in the original `plan1.md` Phase 5. This persona is fully served by the "Strong" sector fit already covered above — a founder researching competitors while building is simply a Solo Operator whose "workspace" happens to be a WalkCroach Web project.

---

## 5. User journeys

### UJ-C1 — Install and first use (zero setup)
User installs WalkCroach Chrome from the Chrome Web Store. No account creation is required to try it. A FAB appears bottom-right on the next page they visit, with a single-line tooltip on first appearance ("Click for a quick summary of this page") — no multi-step onboarding tour, consistent with the skills-gap finding that this audience is put off by anything resembling a setup burden.

### UJ-C2 — First action: page understanding
User clicks the FAB. It expands to a compact panel with page context already summarized (using the page's extracted text, no separate prompt required) and 2-3 sector-relevant quick-action buttons (see Section 6.2) determined by lightweight URL/DOM pattern matching against a small, versioned site-profile list. If no sector pattern matches, the panel shows generic actions only (summarize, ask a question, save).

### UJ-C3 — Sector-aware quick action
On a recognized page type (e.g., a LinkedIn profile, a product page, a property listing), the user sees a specific one-click action (e.g., "Extract candidate summary," "Track this price," "Summarize this listing") instead of having to describe what they want. Clicking it produces a structured proposal (not yet saved) for the user to review.

### UJ-C4 — Save to a workspace
The user accepts the proposal, optionally edits it inline, and assigns it to a workspace (a lightweight, user-named collection — e.g., "Q3 hiring," "Competitor pricing," or, for a WalkCroach Web user, their active build project). This write lands in `page_captures` with an embedding, exactly as scoped in `plan1.md`.

### UJ-C5 — Ask about saved context
Later, on any page (or with no page open), the user can ask the copilot a question that gets answered using their own saved captures via C-SPANN vector search ("What did I save about the Riverside property?" / "Who were the three candidates I looked at last week?"), turning passive captures into active recall.

### UJ-C6 — Draft assistance in place
On a page with an editable text field the copilot recognizes (a compose box, a reply field, a comment box), the user can request a draft or rewrite grounded in their saved workspace context, review it inline, and manually insert it — the copilot never auto-sends or auto-submits.

### UJ-C7 — Workspace review
The user opens the extension's workspace view (a popup or side panel, not a full web app) to browse everything saved to a given workspace, in reverse-chronological order, with the ability to edit, re-tag, or delete any entry.

### UJ-C8 — Cross-surface handoff (WalkCroach Web users only)
If the user is signed in and has an active WalkCroach Web project, captures assigned to that project's workspace are recallable inside the Web builder's `recall_project_memory` tool on their next build session, closing the loop the original Phase 5 scope set out to demonstrate.

### UJ-C9 — Trust and control check-in
At any point, the user can open a simple "what WalkCroach Chrome can see" panel showing exactly which sites it currently has access to (per the activeTab / optional-permissions model) and revoke access per-site with one click.

---

## 6. Feature set

### 6.1 Core universal features (every sector, launch-critical)

- **Floating action button (FAB)** — bottom-right, dismissible, reappears on next page load.
- **Page summarize** — one-click summary of the current page using extracted text, no prompt required.
- **Ask about this page** — scoped Q&A grounded in the current page's content; can optionally use Nova 2 Lite's built-in web-grounding tool for citation-backed answers when the question needs outside context.
- **Save to workspace** — capture the page (or a user-highlighted portion) into a named workspace, with an embedding written for later recall.
- **Recall / ask my workspace** — cross-session, cross-page Q&A grounded in the user's own saved captures via C-SPANN vector search.
- **Inline draft assistance** — on recognized editable fields (email compose, reply boxes, comment fields), propose a draft or rewrite; user manually inserts it.
- **Workspace browser** — a simple list/grid view of everything saved, editable and deletable, no separate web app required to manage it.

### 6.2 Sector-aware quick actions (site-profile-triggered, fast-follow)

A small, versioned list of URL/DOM patterns maps recognized page types to a specific one-click action. Launch set (chosen for Section 2.2's "Strong fit" sectors):

- **Recruiting:** on profile/job-board pages → "Extract candidate summary" (name, role, key skills, visible contact info) saved to a Hiring workspace.
- **Sales:** on company/LinkedIn pages → "Extract lead/company summary" saved to a Leads workspace.
- **Retail/e-commerce:** on product pages → "Track this price" (captures price + timestamp; repeat visits append a price-history note to the same entry) saved to a Pricing workspace.
- **Real estate:** on listing pages → "Summarize this listing" (price, size, key features) saved to a Property workspace.
- **Customer support:** on webmail/helpdesk compose views → draft-reply assistance grounded in the relevant workspace, using the Core inline draft feature with a support-specific tone default.

The site-profile list is intentionally small and versioned centrally (not user-configurable at launch) so it can ship and improve without requiring the no-code workflow-builder UX that the research identifies as a poor fit for this audience.

### 6.3 Trust and control features (launch-critical, not deferrable)

- Per-site access request, granted only on first use on that domain (see NFR-C13).
- Visible "what's captured and where" confirmation on every save.
- One-click per-site access revocation panel (UJ-C9).
- No autonomous form submission, sending, or posting, ever, at any phase.

### 6.4 Cross-surface integration (WalkCroach Web users, fast-follow)

- Sign-in linking a Chrome workspace to an active WalkCroach Web project.
- Captures assigned to a linked project appear in that project's `recall_project_memory` results.

### 6.5 Later-phase candidates (explicitly not launch scope)

- Meeting transcription/notes (Tactiq-style) — valuable but a materially different technical scope (tab audio capture), evaluated only after core adoption is proven.
- Deeper sector coverage (legal, healthcare admin, hospitality/trades-specific quick actions) — added once the launch sectors validate the pattern.
- Any browser automation beyond a single click-to-propose action (multi-step playbooks, scheduled runs) — deliberately excluded; this is Bardeen's territory and conflicts with the trust-first design philosophy in Section 2.3.

---

## 7. Functional requirements

| ID | Priority | Requirement |
|---|---|---|
| FR-C01 | MUST | The extension shall display a floating action button on any page after installation, dismissible per-session, reappearing on next navigation. |
| FR-C02 | MUST | Clicking the FAB shall expand a compact panel showing a page summary generated from extracted page text, without requiring the user to type a prompt. |
| FR-C03 | MUST | The user shall be able to ask a free-text question scoped to the current page's content and receive a grounded answer. |
| FR-C04 | SHOULD | Page-scoped questions may invoke Nova 2 Lite's built-in web-grounding tool when the question requires context beyond the current page, with the source disclosed in the answer. |
| FR-C05 | MUST | The user shall be able to save the current page (or a user-selected excerpt) to a named workspace; the save action shall require an explicit click and shall never occur automatically. |
| FR-C06 | MUST | Every save shall write a `page_captures` row (url, title, extracted text, embedding, workspace reference) consistent with the schema already defined in `plan1.md`. |
| FR-C07 | MUST | The user shall be able to create, rename, and delete workspaces; a save action must always resolve to exactly one workspace. |
| FR-C08 | MUST | The user shall be able to ask a question that is answered using C-SPANN vector search over their own saved captures, scoped to one workspace or across all of a user's workspaces (user's choice at query time). |
| FR-C09 | SHOULD | On a recognized editable text field, the extension shall offer to draft or rewrite text grounded in the active workspace's context; the draft shall be inserted only after explicit user confirmation, never automatically submitted or sent. |
| FR-C10 | MUST | The user shall be able to browse, edit, and delete any saved capture from a workspace-browser view within the extension, without needing a separate web app. |
| FR-C11 | SHOULD | The extension shall maintain a small, centrally versioned list of URL/DOM site profiles that trigger sector-specific quick actions (Section 6.2) instead of the generic panel. |
| FR-C12 | SHOULD | Each sector quick action shall produce a structured, editable proposal before any save occurs — the user may edit fields before accepting. |
| FR-C13 | MUST | The "Track this price" action shall, on a repeat visit to a previously tracked product page, append a new price/timestamp entry to the existing capture rather than creating a duplicate, and shall surface the price history to the user. |
| FR-C14 | MUST | The extension shall request host permission for a given site only when the user first invokes an action on that site (via `activeTab` and `optional_host_permissions`), not as a blanket install-time grant. |
| FR-C15 | MUST | The user shall be able to view, at any time, exactly which sites the extension currently has access to, and revoke access per-site with one click. |
| FR-C16 | MUST | No page content shall be transmitted off-device until the user takes an action that requires it; opening or expanding the panel alone shall not transmit page content. |
| FR-C17 | SHOULD | A signed-in user with an active WalkCroach Web project shall be able to link a Chrome workspace to that project, so that captures saved to it appear in the Web builder's `recall_project_memory` results. |
| FR-C18 | MUST | Every functional requirement above shall persist exclusively to CockroachDB, consistent with the architecture's single-system-of-record principle established for WalkCroach Web. |

---

## 8. Non-functional requirements

### 8.1 Performance
- **NFR-C01 (MUST):** The FAB shall render within 300ms of page load completing, with no measurable impact on the host page's own load performance.
- **NFR-C02 (MUST):** A page summary (FR-C02) shall stream its first content within 2 seconds at p50.
- **NFR-C03 (SHOULD):** Workspace recall queries (FR-C08) shall return within 1.5 seconds at p95 as a user's total capture count grows, consistent with the vector-search latency target already set for WalkCroach Web.

### 8.2 Security and privacy (elevated priority given Section 2.3)
- **NFR-C04 (MUST):** The extension shall request the minimum permission set at install time (`storage`, `activeTab`) and shall use `optional_host_permissions` for any site-specific access, requested just-in-time per FR-C14.
- **NFR-C05 (MUST):** The extension shall comply with Manifest V3 requirements in full — no remotely hosted executable code, event-driven service worker (not a persistent background page), and a Content Security Policy that permits no relaxation of `script-src`/`object-src` beyond Chrome's enforced minimum.
- **NFR-C06 (MUST):** No credential, API key, or authentication token shall be stored in `chrome.storage` in plaintext; session tokens shall be short-lived and refreshed via the same backend-mediated pattern used elsewhere in the architecture.
- **NFR-C07 (MUST):** A public, plain-language privacy policy shall state exactly what is captured, where it is stored, and who can access it, published before Chrome Web Store submission (required for store approval and directly responsive to the 33%-of-SMBs data-security barrier).
- **NFR-C08 (SHOULD):** The extension shall support an enterprise-managed allowlist/policy configuration path (Chrome Enterprise policy JSON) so that small-company IT admins evaluating the tool (Section 4.2 persona) can pre-approve it without a manual per-user review.

### 8.3 Reliability and compatibility
- **NFR-C09 (MUST):** The extension shall function correctly on the current and previous major Chrome release; Manifest V3 is required (V2 is no longer supported by Chrome as of 2026).
- **NFR-C10 (SHOULD):** A failed capture or draft request shall fail visibly with a plain-language retry option, never silently.
- **NFR-C11 (COULD):** The extension shall degrade gracefully (FAB present, generic actions only) on pages where content-script injection is restricted (e.g., `chrome://` pages, some banking sites), rather than erroring.

### 8.4 Scalability
- **NFR-C12 (SHOULD):** The backend shall support the same concurrent-session scale already targeted for WalkCroach Web (500 concurrent active users) without a separate scaling model, reusing the existing Lambda-first, scale-to-zero architecture.
- **NFR-C13 (MUST):** Site-profile pattern matching (FR-C11) shall execute entirely client-side (in the content script or service worker) with no per-page-load backend call, so sector detection adds no latency or server cost on ordinary browsing.

### 8.5 Usability
- **NFR-C14 (MUST):** First-use onboarding shall require no more than a single-line tooltip (UJ-C1) — no multi-step tour, no mandatory account creation before first value, directly responsive to the skills-gap adoption barrier in Section 2.3.
- **NFR-C15 (SHOULD):** All sector quick-action labels (Section 6.2) shall use plain, role-specific language ("Extract candidate summary," not "Run extraction playbook") to avoid the technical-sounding framing that Bardeen's own reviews cite as a barrier for less technical users.

### 8.6 Observability
- **NFR-C16 (MUST):** Every capture, draft, and permission grant/revoke shall be logged (CloudWatch, consistent with the existing WalkCroach observability pattern) with enough detail to reconstruct a user's action history, without logging captured page content itself in plaintext logs.

### 8.7 Store compliance
- **NFR-C17 (MUST):** The extension shall be built to pass Chrome Web Store review on first or second submission — complete privacy policy, no overly broad permissions, no CSP violations — accounting for the store's typical 2-5 business day review window (7-14 days for a first-time developer account) when planning any date-sensitive launch.

---

## 9. Data model additions

Extends the schema already defined in `plan1.md` — no new tables required for launch scope, only additive columns on the existing `page_captures` table and one new lightweight table for workspaces (previously implicit as "project" only).

```sql
-- workspaces: generalizes "project" so Chrome-only users (no WalkCroach Web project)
-- have a first-class place to save to.
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  name STRING NOT NULL,
  linked_project_id UUID NULL REFERENCES projects(id), -- set only for UJ-C8 handoff
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- page_captures: add workspace reference, capture_type, and structured-field payload
-- for sector quick actions, alongside the columns already defined in plan1.md.
ALTER TABLE page_captures ADD COLUMN workspace_id UUID REFERENCES workspaces(id);
ALTER TABLE page_captures ADD COLUMN capture_type STRING NOT NULL DEFAULT 'general';
  -- general | candidate | lead | price | listing | draft
ALTER TABLE page_captures ADD COLUMN structured_fields JSONB NOT NULL DEFAULT '{}';
  -- e.g. { "price": 129.99, "currency": "USD", "history": [...] } for capture_type = price
```

`superseded_by`-style provenance (never delete, mark superseded) is reused for `structured_fields` updates such as price-history appends (FR-C13), consistent with the provenance principle already established for `memory_entries`.

---

## 10. Success metrics

- **Activation:** % of installs that complete at least one save (FR-C05) within the first session — the equivalent of WalkCroach Web's "time to first preview" activation metric.
- **Sector fit validation:** save-rate broken down by site-profile category (Section 6.2) — used to confirm or correct the sector-priority ranking in Section 2.2 with real usage data rather than research alone.
- **Recall usage:** % of returning sessions where the user issues at least one recall query (FR-C08) — the direct behavioral proxy that memory is doing its job, mirroring the equivalent metric already defined for WalkCroach Web.
- **Trust proxy:** % of users who grant site access to more than one domain within their first week — a low number would indicate the per-site permission model (FR-C14) is being respected but the value proposition isn't clearing the trust bar fast enough.
- **Cross-surface adoption (secondary):** % of WalkCroach Web users who also install Chrome and link at least one workspace (FR-C17).

---

## 11. Out of scope

- Any multi-step workflow automation, scheduled runs, or no-code playbook builder — deliberately Bardeen's territory and against the trust-first design philosophy (Section 2.3).
- Fully autonomous "browser operator" style form-filling or task completion without per-action confirmation.
- Meeting transcription/tab-audio capture (Section 6.5) — different technical scope, evaluated later.
- Non-Chrome browsers (Firefox, Safari) — Chrome's Manifest V3 model and market share make it the correct single-browser launch target; revisit only after core adoption is validated.
- Sector-specific quick actions beyond the five launch sectors in Section 6.2 (trades/construction/hospitality, legal, deep healthcare-admin workflows) — genuine opportunities per Section 2.2 but scoped for a later phase once the browsing-centric pattern is validated with the launch sectors.

---

## 12. Phasing and timeline assumption

**Timeline assumption, stated explicitly:** the WalkCroach Web PRD already commits the full team's capacity through August 18, 2026 across four sequential phases. This PRD does not resolve how Chrome's build capacity is allocated against that commitment — that is a team-capacity decision, not a product-scope decision, and should be made explicitly (parallel track with separate ownership, or a fast-follow immediately after the hackathon submission) before a start date is set. What follows is a build sequence, not a calendar.

| Phase | Scope | Depends on |
|---|---|---|
| **Chrome Phase A — Core copilot** | FR-C01–FR-C10, FR-C14–FR-C16, FR-C18 (universal features + trust/permission model + data model) | Nothing outside Chrome itself; reuses the existing CockroachDB cluster and Lambda backend pattern |
| **Chrome Phase B — Sector quick actions** | FR-C11–FR-C13 (recruiting, sales, retail, real estate, support quick actions) | Phase A's capture/workspace pipeline |
| **Chrome Phase C — Cross-surface handoff** | FR-C17 (WalkCroach Web linking) | WalkCroach Web's account/sign-in model (Web PRD FR-31 onward) |
| **Chrome Phase D — Store submission and launch** | NFR-C17 compliance pass, privacy policy publication, submission | Phases A-C feature-complete |

Phase A alone is sufficient to validate the core repositioning (Section 1.2) and should be the priority if capacity is constrained — it is also the minimum needed to satisfy the original hackathon "cross-surface memory" demonstration goal via Phase C once Web's sign-in model exists.

---

## 13. Risks

- **Capacity conflict with the Web PRD's committed schedule** (Section 12) — the single biggest open risk in this document; resolve before committing a Chrome start date.
- **Site-profile detection accuracy** — sector quick actions (FR-C11) depend on pattern-matching real-world page structures (LinkedIn, job boards, listing sites, product pages) that change without notice; the versioned, centrally-updated list (not user-configurable) is the mitigation, but it creates ongoing maintenance load that should be budgeted, not treated as a one-time build cost.
- **Chrome Web Store review timeline** — first-time developer account submissions can take 7-14 business days; factor this into any launch-date planning per NFR-C17, especially if a demo/submission deadline is involved.
- **Trust-bar miscalibration** — Section 2.3's design rules are a deliberate bet against the more autonomous, automation-heavy direction competitors like Bardeen have taken. If early users *want* more automation than this scope provides, that is a signal to revisit, not a design flaw to silently work around — track the "trust proxy" metric (Section 10) explicitly to catch this early.
- **Sector-priority ranking is research-derived, not usage-validated** — Section 2.2's ranking should be treated as a launch hypothesis, confirmed or corrected by the sector-fit validation metric (Section 10) within the first weeks of real usage.