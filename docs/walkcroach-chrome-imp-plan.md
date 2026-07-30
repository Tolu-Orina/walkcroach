# WalkCroach Chrome — Phased Implementation Plan

**Date:** July 2026  
**Surface:** WalkCroach Chrome (`chrome/` + `infra-backend/modules/lambda-chrome`)  
**Status:** Dedicated evolution plan — separated from the consolidated master plan so Chrome can be reimagined without being sequenced as a thin Part-2 appendix.  
**Grounding:** Codebase audit in `walkcroach-master-doc.md` §2; existing Chrome PRD (`walkcroach-chrome-prd.md`); master plan Part 2 §5 (superseded for Chrome by this document); live extension at v0.1.5; 2026 Chrome Extensions / CWS / AI-browser-agent research (cited inline).  
**Cross-surface contracts this plan must honour:** CockroachDB as sole system of record; never-delete / `superseded_by` provenance; propose → confirm → execute; shared Cognito identity; shared credit ledger with Web (master plan Part 1 §4); connector OAuth credentials never reach the client (Secrets Manager proxy).

---

## How to read this document

This is the **sole implementation authority for WalkCroach Chrome** going forward. The master plan’s Chrome section (§5) remains useful historical context; where this document and that section disagree, **this document wins** — notably on the permission model, the sign-in root cause, and the scope of connectors on the Chrome surface.

Every phase answers four questions: **what is broken or missing today**, **what industry practice says**, **what we will build**, and **how it advances the five hackathon criteria** (Agentic Memory Design, Technical Implementation, Real-World Impact, Production Readiness, Creativity & Originality).

---

## 0. Product thesis (reimagined)

WalkCroach Chrome is **not** “ChatGPT in a sidebar.” It is the WalkCroach product that meets an SME where their work already is — a job board, a competitor’s storefront, a listing, an inbox — reads the page well enough to offer one useful action, remembers what they saved in CockroachDB, and (in later phases) acts on real connectors (calendar, email, Stripe) only after the user confirms.

**What we keep from today’s architecture**

- Side panel as the primary surface (not a FAB). Chrome’s Side Panel API is the 2026 platform standard for persistent AI companions; it needs zero page-host permissions at install time and matches competitors Claude-in-Chrome, Monica, and Sider. The PRD’s FAB was the wrong call; the audit already suspected as much. This plan does not revert it.
- Device-session → Cognito upgrade path (try-first without an account).
- Workspace linking into Web projects with capture backfill.
- Sector-aware site profiles (`profiles.v1.json`) and price-tracking (the most complete Chrome feature today).
- “Open in Web Chat” handoff.
- Minimal install-time permissions for CWS trust.

**What “reimagined” means**

1. Fix the two user-blocking bugs so the product is usable in the first sixty seconds.
2. Replace the broken `activeTab`-only page-read model with a trust-preserving pattern that actually works from a side panel.
3. Redesign the UI to feel like the same Graphite Lumen family as WalkCroach Web — brand-first, engaging, adaptive to a resizable 250–500px panel — not a green-system utility panel using Segoe UI.
4. Elevate the interaction model from “four tabs of tools” to a **context-aware companion**: page context always visible, one primary action, propose→confirm→execute everywhere, connectors as first-class tools.
5. Ship connectors on Chrome (not only Web Chat) so “check my calendar / draft this email / what’s my Stripe balance?” is a real claim from the browser surface.
6. Clear Chrome Web Store submission and post-submit monitoring that matches the shipped permission model.

**What it deliberately is not**

- Not a full browser-operating agent (Claude-in-Chrome’s click/navigate autonomy). WalkCroach stays trust-first: propose, confirm, execute. That is a deliberate product differentiation given SMB trust data (78% will not let AI act without oversight — Chrome PRD §2.3).
- Not a no-code automation builder (Bardeen’s territory).
- Not a second Web Chat with a different skin — Chrome’s unique value is **page context + sector shortcuts + durable memory**, then connectors layered on top.

---

## 1. Current state (audit-grounded)

### 1.1 What works

| Area | Evidence |
|---|---|
| Side panel copilot | `entrypoints/sidepanel/App.tsx` (~1,100 lines): Page / Recall / Workspaces / Trust |
| Device + Cognito auth plumbing | `lib/auth.ts` three-tier model; `/connect/chrome` one-time code; upgrade merge |
| Workspace ↔ Web project link | Backfill capped at 2,000; price updates mirrored into project memory |
| Sector profiles | Recruiting, sales, retail, real estate, support in `profiles.v1.json` |
| Price tracking | Most complete Chrome feature per audit |
| Packaging discipline | `VERSIONING.md`, `CHANGELOG.md`, `zip:prod`, CI buildspec |
| Store packet | Listing, privacy, permission justifications, screenshot scripts |

### 1.2 Two reproducible, user-blocking bugs

#### Bug A — “no active tab — click the WalkCroach toolbar icon on the page first”

**Reproduced against:** ordinary `https://` pages with the side panel open.

**Shipped model:** Manifest permissions are `storage`, `activeTab`, `scripting`, `sidePanel` + narrow API `host_permissions`. Page extract runs via `chrome.scripting.executeScript` from the service worker when the side panel sends `GET_ACTIVE_EXTRACT` / `GET_ACTIVE_TAB_INFO` (`background.ts:39–78`). Side-panel actions (`Summarize`, sector quick-action, Save) all call `preparePage()` which depends on that path.

**Root cause (industry-confirmed, stronger than the master plan’s diagnosis):** Google’s 2026 Chrome Extensions guidance states explicitly that **`activeTab` does not activate from side-panel button clicks**. Qualifying gestures are: toolbar action click, context menu, keyboard shortcut, omnibox. A click inside the side panel is **not** one of them. The master plan’s fix (“only extract in direct response to the toolbar click”) is necessary but **insufficient** for a side-panel product whose primary UX is “open once, then click Summarize / Ask / Save repeatedly as you browse.”

Additional failure modes that produce the same error string:

- Panel left open across tab switches; `tabs.query({ active: true })` can resolve to a tab the extension no longer has temporary host access to.
- Restricted schemes (`chrome://`, Web Store, PDF viewer, `chrome-extension://`) where scripting is impossible regardless of gesture.
- `setPanelBehavior({ openPanelOnActionClick: true })` opens the panel on toolbar click, but does **not** by itself cache page content for later panel actions.

**Why the current error copy is misleading:** it tells the user to click the toolbar icon, which grants `activeTab` briefly — but the next Summarize click inside the panel still does not qualify, so the error returns. The UX is not self-resolving.

#### Bug B — Sign-in “blocked by Chrome” (`ERR_BLOCKED_BY_CLIENT` / `chrome-extension://…`)

**Shipped flow:** Trust → `startWebSignIn()` opens WalkCroach Web `/connect/chrome?state=…&redirect_uri=chrome-extension://{id}/auth.html` → after Cognito sign-in, `ConnectChromePage` issues a one-time code and does `window.location.assign(redirectUri)` back into the extension (`ConnectChromePage.tsx:100–104`).

**Root cause (confirmed against Chrome docs):**  
> “A navigation from a web origin to an extension resource is blocked unless the resource is listed as web accessible.”  
> — [Web Accessible Resources](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)

`wxt.config.ts` declares **no** `web_accessible_resources`. `auth.html` is therefore not navigable from `walkcroach.conquerorfoundation.com`. Chrome blocks the redirect → user sees “This page has been blocked by Chrome” / `ERR_BLOCKED_BY_CLIENT`.

**Secondary risks that can produce `chrome-extension://invalid`:**

- Unpacked extension ID is non-deterministic unless a stable `"key"` is pinned in the manifest; OAuth allowlists and local testing drift.
- Any path that constructs a `chrome-extension://` URL from an empty/undefined `chrome.runtime.id` (defensive check missing in `chromeRedirectUri()`).
- Packed vs unpacked ID mismatch between what Web/Lambda allowlist regex accepts (`[a-p]{32}`) and what is actually presented.

**Preferred long-term auth pattern (2026 industry practice):** `chrome.identity.launchWebAuthFlow` with redirect `https://<extension-id>.chromiumapp.org/` — no WAR required, cancel is observable, works across Chromium. Keep the Web `/connect/chrome` custom Cognito UX (no Hosted UI / no Amplify, per platform auth rule), but complete the handoff through `launchWebAuthFlow` (or WAR-listed `auth.html` as a short-term fix). Pin the extension ID via the manifest `"key"` field in every environment.

### 1.3 Structural debt that blocks redesign

| Debt | Detail |
|---|---|
| Dead Trust tab | `lib/permissions.ts` is self-documented stub (`ensureOriginPermission` → always `true`, `hasOriginPermission` → always `false`) after v0.1.3’s move to `activeTab`-only. FR-C15 revoke UI is fiction. |
| Unused better extractor | Mozilla Readability in `lib/extract.ts` is not wired; `background.ts` ships a cruder heuristic. |
| Monolith UI | ~1,100-line `App.tsx`, zero unit tests; `background.ts` also untested. |
| Brand drift | Chrome uses a green utility palette + Segoe UI / system fonts. Web ships **Graphite Lumen** (ink `#0b0c0f`, amber signal `#f0b429`, steel `#6b9eff`, Bricolage Grotesque + Source Sans 3). Master plan’s “navy/teal/amber” shorthand is outdated relative to Web’s actual system. |
| Store gap | `SUBMISSION_CHECKLIST.md` still targets v0.1.4; “Upload to CWS” unchecked; no evidence of a live listing. Enterprise policy template still has `EXTENSION_ID_REPLACE_ME`. |
| Thin Lambda tests | `price-track`, `link`, `upgrade` handlers lack dedicated tests (audit finding). |
| No connectors on Chrome | Connector architecture lives in master plan Part 1 §3 for Web Chat; Chrome has no connector UI, no MCP client path, no propose→confirm surface for calendar/email/Stripe. |

### 1.4 Permission reality check (2026 best practice)

| Approach | Install warning | Works from side-panel buttons? | CWS review posture | Fit for WalkCroach |
|---|---|---|---|---|
| `activeTab` only (today) | None for hosts | **No** | Excellent install trust, broken product | Reject as sole model |
| Install-time `<all_urls>` | Scary “read and change all data” | Yes | Slow review, trust hit | Reject |
| **`optional_host_permissions` + runtime `permissions.request()` per origin** | None at install; in-context prompt on first use of a site | **Yes** (request is a user gesture) | Official Chrome recommendation for side panels that need page access | **Adopt** |
| Capture-on-toolbar-open cache only | None | Only for the tab state at open time | Good | Useful **complement**, not sufficient alone |

**Locked decision for this plan:** hybrid permission model —

1. Keep install-time minimal: `storage`, `sidePanel`, `scripting`, `identity` (for auth flow), narrow API host, `optional_host_permissions: ["http://*/*", "https://*/*"]`.
2. On first page action for an origin, call `chrome.permissions.request({ origins: [originPattern] })` from the button click (qualifying gesture) — restores a real Trust / Sites UI.
3. On toolbar open, eagerly extract + cache page context into `chrome.storage.session` so the panel feels instant when the grant already exists or when `activeTab` just fired.
4. Never silently transmit page content on panel open — only on an explicit user action (summarize, save, ask, connector write). Preserves Chrome PRD trust rule §2.3.

This is the same pattern Google’s modern-web-guidance skill documents for side-panel page readers, and the same optional-permissions recipe Chrome Web Store reviewers expect in 2026.

---

## 2. Competitive & research inputs (July 2026)

### 2.1 AI browser companions

| Product | Model | Lesson for WalkCroach |
|---|---|---|
| **Claude in Chrome** | Side panel; Manual / Auto / Skip permission modes; always confirm purchases & sensitive actions | Trust tiers are table stakes. WalkCroach stays at Manual (propose→confirm) by default — our differentiator is memory + SME connectors, not autonomy. |
| **Monica / Sider / Merlin** | Side panel + page context | Prove the side-panel AI category; none have durable cross-surface CockroachDB memory. |
| **Perplexity / ChatGPT Atlas** | Research-first / full browser | Account-gated free tier is acceptable; Chrome already requires sign-in for paid features — align free credit grant with Part 1 §4. |
| **Bardeen** | Automation playbooks | Wrong fit for our audience’s skills-gap barrier; do not chase. |
| **Chromex / modern side-panel AI kits** | Side panel + content script + SW messaging | Three-way messaging (panel ↔ SW ↔ page) is the backbone; session storage for SW ephemerality. |

### 2.2 Chrome platform practices to follow

- Side panel as persistent companion; `setPanelBehavior({ openPanelOnActionClick: true })`; no `default_popup` when using that behavior ([Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)).
- Container queries for 250–500px resizable panel widths — not viewport media queries ([2026 adaptive UI guidance](https://extensionbooster.net/blog/chrome-extension-adaptive-ui-responsive-layouts-guide/)).
- Service worker: no state in globals; persist to `chrome.storage.local` / `.session`.
- Pin extension ID with manifest `"key"` for stable OAuth redirect URIs.
- Prefer `launchWebAuthFlow` + `*.chromiumapp.org` for OAuth completion; WAR-list `auth.html` only if retaining tab-redirect.
- CWS: single-purpose side panel, no unnecessary distractions, discoverability copy in listing + first-run coach mark ([Chrome side panel launch blog](https://developer.chrome.com/blog/extension-side-panel-launch)).

### 2.3 Connectors (why Chrome must own them too)

Master plan Part 1 §3 correctly frames connectors as the highest Real-World Impact lever: *“A chat agent that can check a calendar, draft and send a real email, or look up a Stripe balance is a materially different claim…”*

That claim is **surface-agnostic**. An SME who is staring at a supplier quote in the browser should be able to say “put a reminder on my calendar for Friday” or “draft a reply and send it” without bouncing to Web Chat. Chrome therefore consumes the **same** `connectors` / `workflow_runs` tables and Secrets Manager proxy as Web — it does not invent a second connector subsystem. What Chrome adds is:

- Page-context-aware proposals (“Draft a reply to this email thread” / “Add this listing’s open house to Calendar”).
- A Connectors section in the redesigned panel (status, scopes, revoke).
- Propose → confirm cards rendered in the side panel (same JSON contract as Web).

Connector priority for Chrome (aligned with Part 1 §3, ordered by browser-context usefulness):

| Tier | Connectors | Chrome-native scenarios |
|---|---|---|
| 1 | Gmail, Google Calendar | Draft/send reply while reading a page; schedule follow-up from a lead/listing page |
| 1b | Slack (optional in same tier if capacity) | Post a saved capture / summary to a channel |
| 2 | Stripe | “What’s my balance / MRR?” from any tab — CFO-moment usefulness |
| 3 | Sheets / HubSpot | Later; overlap with sector lead/candidate extraction |

Implementation vehicle: MCP client already proven in the IDE (`mcp.ts`) and scheduled for Web’s agent-harness in Part 1 §3A — Chrome’s Lambda BFF gains connector tool routes that call the same server-side MCP/OAuth layer. The extension never holds provider refresh tokens.

---

## 3. Target experience (UX redesign brief)

### 3.1 Brand alignment — Graphite Lumen on a narrow canvas

Adopt Web’s design tokens, adapted for a light-or-dark **companion** panel (Chrome sits next to bright web pages; pure Web-dark can feel heavy). Recommended adaptation:

| Token | Web | Chrome panel |
|---|---|---|
| Ink / text | `#0b0c0f` | `#0b0c0f` on light raised surface, or paper on dark — pick **one** mode and ship it; prefer light panel with dark ink for page-adjacency readability |
| Raised / panel | `#14161b` / `#1c1f26` | `#f2f3f5` paper / `#ffffff` raised with `#2e333c` line at 12% — atmospheric gradient, not flat white |
| Signal (CTA) | `#f0b429` amber | Same — primary actions only |
| Steel / memory | `#6b9eff` | Same — recall, memory badges, connector status |
| Ember / danger | `#f07167` | Errors, revoke |
| Display font | Bricolage Grotesque | Load via extension pages (self-hosted woff2, not remote) for “WalkCroach” wordmark |
| UI font | Source Sans 3 | Self-hosted |
| Mono | JetBrains Mono | Hashes, IDs, prices |

**Brand test (from WalkCroach frontend rules):** if you remove the nav chrome, the first viewport must still read as WalkCroach — wordmark is hero-level in the panel header, not a tiny eyebrow.

**Avoid:** Segoe UI / system stacks; green Obsidian remnant palette currently in `style.css`; card-spam; purple AI clichés; pill clusters; stat strips.

### 3.2 Information architecture (replace four flat tabs)

```
┌─────────────────────────────────────┐
│  WalkCroach                    [◎]  │  ← brand + account chip
│  context: {page title · sector}     │
├─────────────────────────────────────┤
│  [ Primary sector action ]          │  ← one obvious CTA when profile matches
│  Summarize · Ask · Save             │
├─────────────────────────────────────┤
│  Conversation / proposal stream     │  ← propose cards live here
│  (confirm / edit / dismiss)         │
├─────────────────────────────────────┤
│  Memory · Sites · Connectors · …    │  ← secondary nav (icon rail at narrow width)
└─────────────────────────────────────┘
```

Principles:

- **One job in the first screen:** act on *this page*. Recall, workspaces, connectors, trust are secondary.
- **Propose → confirm → execute** for: save capture, track price, send email, create calendar event, any connector write. Read-only connector queries (Stripe balance, calendar list) may stream results with a visible “live from Stripe” badge but no confirm gate.
- **Container queries:** at ~250px, collapse secondary nav to icons; at ~400px+, show labels.
- **Motion (2–3 intentional):** panel mount fade, streaming token caret, confirm-card entrance — no decorative noise.
- **First-run coach:** single coach mark on first open — “WalkCroach reads a page only when you click an action, and only on sites you allow.” No multi-step tour.

### 3.3 Trust / Sites model (replaces dead Trust tab)

Real capabilities:

- List origins granted via `optional_host_permissions`.
- One-click revoke (`chrome.permissions.remove`).
- Sign in / sign out (Cognito).
- Privacy link.
- Credit meter (shared Web/Chrome ledger once Part 1 §4 ships).
- Connector connection status (Phase E).

### 3.4 Accessibility & quality bar

- Focus order matches visual order in the narrow panel.
- Streaming regions use `aria-live="polite"`.
- Contrast: amber CTA on dark/light checked; steel on paper checked.
- No page content uploaded until explicit action (privacy copy must match behavior for CWS).

---

## 4. Architecture

### 4.1 Extension runtime (target)

```
┌──────────────┐     message      ┌─────────────────────┐
│  Side panel  │ ←──────────────→ │  Service worker     │
│  (React)     │                  │  background.ts      │
└──────┬───────┘                  └──────────┬──────────┘
       │                                     │
       │                          scripting / tabs.sendMessage
       │                                     │
       │                          ┌──────────▼──────────┐
       │                          │  Page extract layer │
       │                          │  Readability +      │
       │                          │  optional content   │
       │                          │  script (later)     │
       │                          └─────────────────────┘
       │
       │ HTTPS (API host only)
       ▼
┌──────────────────────────────────────────────────────┐
│  lambda-chrome (BFF)                                 │
│  device session · LLM routes · captures · workspaces │
│  oauth/connect · handoff · price-track               │
│  NEW: connector proxy routes → shared connector svc  │
└───────────────────────────┬──────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
  CockroachDB         Bedrock/Nova        Secrets Manager
  captures, memory,   summarize/ask/      connector OAuth
  connectors,         draft/propose       tokens (never to
  workflow_runs,                          client)
  usage_ledger
```

### 4.2 Auth flow (target)

**Phase B short fix:** declare `auth.html` in `web_accessible_resources` matched to WalkCroach Web origins only; pin `"key"`; assert `chrome.runtime.id` before building redirect URIs; smoke-test packed + unpacked.

**Phase B+ preferred:**

```
Side panel "Sign in"
  → chrome.identity.launchWebAuthFlow({
       url: `${WEB}/connect/chrome?state=…&redirect_uri=${chrome.identity.getRedirectURL('auth')}`,
       interactive: true
     })
  → Web custom Cognito pages (unchanged)
  → redirect to https://<ext-id>.chromiumapp.org/auth?code=…&state=…
  → SW / panel completes exchange + /auth/upgrade
```

Requires: `identity` permission; Cognito/Web redirect allowlist updated for `chromiumapp.org`; Lambda oauth allowlist regex extended; stable extension ID documented in `VERSIONING.md`.

### 4.3 Page-access flow (target)

```
User clicks Summarize (side panel)
  → if origin not granted:
       chrome.permissions.request({ origins: [`${origin}/*`] })  // user gesture
  → SW executeScript / content-script extract (Readability)
  → cache extract in chrome.storage.session keyed by tabId+contentHash
  → stream summarize via lambda-chrome
  → show result; Save is a separate confirm
```

Toolbar open additionally warms the cache when `activeTab` is available, so the panel can show title/sector chip immediately without uploading content.

### 4.4 Connector flow (target — shared with Web)

```
User: "Email this summary to alex@acme.com tomorrow 9am"
  → agent (lambda-chrome or shared harness) proposes:
       { connector: 'gmail', action: 'send', draft: {...} }
       { connector: 'google_calendar', action: 'create_event', ... }
  → side panel ConfirmCard (edit recipients / time)
  → on confirm: POST /chrome/v1/connectors/execute
       → server resolves Secrets Manager token
       → MCP / provider API
       → workflow_runs row (status=executed)
       → credit debit (weight 2 per Part 1 §4.3)
  → optional: embed result into memory_entries for recall
```

Chrome does **not** talk to Stripe/Google APIs directly from the extension.

### 4.5 Data model additions (Chrome-relevant)

Reuse Part 1 §3 tables (`connectors`, `workflow_runs`). Chrome-specific additions:

```sql
-- Already exist / keep: page_captures, chrome_device_sessions,
-- chrome_auth_codes, chrome_chat_handoffs, workspaces, memory_entries

-- Optional Chrome UX preference (panel-local OK in chrome.storage;
-- durable prefs that should sync cross-device belong in CockroachDB):
CREATE TABLE chrome_site_grants_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  origin STRING NOT NULL,
  action STRING NOT NULL,          -- 'granted' | 'revoked'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Note: live grants live in Chrome's permission API; this table is
-- an optional audit trail for Trust UX / support, not the source of truth.
```

No new database engine. Soft-delete / superseded patterns apply to captures and workflow runs as elsewhere.

---

## 5. Phased build plan

### Phase A — Unblock (P0): page access + sign-in

**Goal:** A judge or SME can open the panel on a normal HTTPS page, summarize it, and sign in successfully. Nothing else matters until this is true.

| ID | Work item | Done when |
|---|---|---|
| A1 | **Permission model migration** — add `optional_host_permissions` for `http(s)://*/*`; implement `permissions.request` / `contains` / `remove` in a revived `lib/permissions.ts`; keep API host as install-time `host_permissions` | Summarize works from a side-panel button on a fresh origin after one in-context grant |
| A2 | **Toolbar warm-cache** — on `action` / panel-open path, extract once under `activeTab` into `chrome.storage.session` | Panel shows page title/sector chip immediately after toolbar open |
| A3 | **Error UX rewrite** — replace generic “no active tab” with specific states: needs site access / restricted page / grant revoked / click Allow | Error is self-resolving; copy matches the actual next action |
| A4 | **Sign-in WAR fix** — add `auth.html` (+ needed assets) to `web_accessible_resources` matched only to WalkCroach Web origins; defensive ID checks | Web → extension redirect no longer blocked |
| A5 | **Pin extension ID** — add stable `"key"` for local/dev; document packed/CWS ID procedure in `VERSIONING.md` | Redirect URI stable across reloads |
| A6 | **Packed smoke** — sign-in + summarize on packed zip, not only unpacked | Both flows green on packed build |
| A7 | **Regression tests** — unit tests for permissions helpers; messaging contract tests for extract failures; auth redirect URI builder | Bugs cannot silently return |

**Depends on:** nothing.  
**Out of scope for A:** visual redesign, connectors, store upload.  
**Criteria:** Production Readiness (primary), Technical Implementation.

**Estimated shape:** ~3–5 engineering days if focused; this is the critical path for the entire Chrome track.

---

### Phase B — Auth hardening + Trust honesty

**Goal:** Sign-in matches 2026 Chromium best practice; Trust tab tells the truth.

| ID | Work item | Done when |
|---|---|---|
| B1 | Migrate completion path to `chrome.identity.launchWebAuthFlow` + `chromiumapp.org` redirect; keep Web custom Cognito pages | Sign-in works without relying on WAR navigation (WAR retained as fallback during rollout) |
| B2 | Extend Lambda + Web redirect allowlists for `https://[a-p]{32}.chromiumapp.org/*` | Backend accepts new redirect class |
| B3 | Rebuild Trust → **Account & Sites**: real granted-origin list, revoke, sign-in/out, privacy, session source badge | FR-C15 honest again |
| B4 | Remove / rewrite dead telemetry that still assumes host-grant events (`POST_SUBMIT_MONITORING.md`) | Monitoring matches shipped model |
| B5 | Wire Mozilla Readability extractor into the shipped extract path; delete duplicated heuristic or make it fallback-only | Extraction quality matches `lib/extract.ts` |

**Depends on:** A1–A6.  
**Criteria:** Production Readiness, Technical Implementation.

---

### Phase C — Visual & interaction redesign (“reimagined”)

**Goal:** Chrome feels like WalkCroach. Engaging, brand-first, propose→confirm everywhere, adaptive side panel.

| ID | Work item | Done when |
|---|---|---|
| C1 | Design tokens + self-hosted fonts (Bricolage / Source Sans 3 / JetBrains Mono) ported into `sidepanel` + `auth` pages | Visual side-by-side with Web passes brand test |
| C2 | Restructure `App.tsx` into components: `Shell`, `ContextHeader`, `PrimaryActions`, `Stream`, `ConfirmCard`, `MemoryRail`, `SitesPanel`, `AccountChip` | App.tsx no longer a 1,100-line monolith |
| C3 | IA per §3.2 — page-first companion; secondary icon rail | First viewport = brand + context + one CTA group + stream |
| C4 | Propose→confirm UI for save / price-track / structured sector proposals (unify with existing proposal fields) | No silent writes |
| C5 | Container-query layouts + 2–3 motions | Usable at 250px and 480px |
| C6 | First-run coach mark + empty states that teach site-grant model | New user completes first summarize without support copy |
| C7 | Credit meter placeholder wired to API when Part 1 §4 ledger endpoint exists | Shared-pool visibility |
| C8 | Component-level tests for ConfirmCard, permissions gate, stream cancellation | Coverage on new UI surface |

**Depends on:** A (functional), can parallelize design tokens with B.  
**Criteria:** Creativity & Originality (branded companion, not generic AI sidebar), Real-World Impact (usable without training), Production Readiness.

**Design constraints (hard):** no FAB revival; no card-heavy dashboard; no purple gradient AI look; no hero overlays; brand wordmark remains the strongest text signal in the header.

---

### Phase D — Sector depth & memory excellence

**Goal:** Chrome’s unique wedge — sector-aware actions + durable recall — becomes unmistakably better than a generic sidebar LLM.

| ID | Work item | Done when |
|---|---|---|
| D1 | Harden candidate/lead extraction proposals (LinkedIn/Indeed/company pages already profiled) to production quality + confirm cards | Recruiter/sales happy path demoable |
| D2 | Price-track UX polish (history sparkline-in-panel, alert threshold later) | Retail sector story is crisp |
| D3 | Selection-based capture (PRD FR-C05) via context menu + `activeTab` / granted origin | User can save a highlight without full-page extract |
| D4 | Optional screenshot-to-memory (later in phase) via `chrome.tabs.captureVisibleTab` only after grant + confirm | Stretch; do not block D1–D3 |
| D5 | Recall UX: “from Chrome” badges, project-linked availability, natural-language recall that cites captures | Agentic Memory visible in UI |
| D6 | Site-profile v2 — versioned profiles, remote-updatable JSON via API (signed) without extension release for copy tweaks | Profiles not frozen in the XPI only |
| D7 | Lambda handler tests for `price-track`, `link`, `upgrade`, `propose` | Audit thin-coverage gap closed for Chrome BFF |

**Depends on:** C for UX; A for page access.  
**Criteria:** Agentic Memory Design, Real-World Impact, Creativity & Originality.

---

### Phase E — Connectors on Chrome (Real-World Impact)

**Goal:** From the side panel, a signed-in user can check Calendar, draft/send Gmail, and read Stripe balance — with propose→confirm on every write — using the shared connector platform.

| ID | Work item | Done when |
|---|---|---|
| E0 | **Platform dependency** — Part 1 §3A/3B (MCP client + Tier-1 OAuth + `connectors` / `workflow_runs`) must be underway; Chrome consumes, does not fork | Shared tables + Secrets Manager proxy exist |
| E1 | Chrome BFF connector routes: list connections, start OAuth (open Web settings or `launchWebAuthFlow`), execute proposed action, fetch run status | Extension never sees refresh tokens |
| E2 | Side-panel Connectors section: connect/disconnect, scope disclosure, last-error | User can manage connections in-panel |
| E3 | Agent tool wiring for Chrome LLM routes — `calendar.list_events`, `calendar.create_event`, `gmail.draft`, `gmail.send`, `stripe.balance` | Tools appear in Chrome ask/summarize agent path |
| E4 | ConfirmCard variants for email send + calendar create (editable fields) | Write actions always confirm |
| E5 | Page-aware prompts: “Draft a reply referencing this page” includes extract + memory | Browser context multiplies connector value |
| E6 | Tier-2 Stripe balance + simple revenue snapshot | Demo line: “What’s my Stripe balance?” works |
| E7 | Credit debit weight 2 per connector action; free-tier caps | Aligned with Part 1 §4 |
| E8 | `workflow_runs` recallable from Chrome Recall (“what did we send last week”) | Memory graph includes actions, not only captures |
| E9 | Security review: prompt-injection from page content into connector arguments; Bedrock Guardrails on connector-bound prompts; deny-by-default on send | Production Readiness for irreversible actions |

**Depends on:** A, B (auth), C (ConfirmCard), Part 1 §3A/3B.  
**Can start E1 UI stubs against mocks before 3B lands; must not ship write paths before shared OAuth proxy is real.**  
**Criteria:** Real-World Impact (primary), Agentic Memory Design (E8), Production Readiness (E9).

---

### Phase F — Store, enterprise, observability

**Goal:** Public CWS listing; enterprise stub completed; monitoring honest.

| ID | Work item | Done when |
|---|---|---|
| F1 | Refresh `SUBMISSION_CHECKLIST.md` for the redesigned version (not 0.1.4); update permission justifications for `optional_host_permissions` + `identity` | Checklist matches zip |
| F2 | New store screenshots + 30s listing video showing grant → summarize → confirm save → connector confirm | Listing converts |
| F3 | Upload to CWS; track review; fix policy feedback | Live store URL exists |
| F4 | Fill `enterprise/policies.json` with real extension ID; document force-install | SME IT path exists |
| F5 | Post-submit monitoring: summarize success rate, site-grant rate, sign-in success, connector execute success/fail — retire dead grant-event metrics | Dashboards match reality |
| F6 | Wire Chrome health into Platform Ops Portal (master plan §9) when available | Cross-surface visibility |

**Depends on:** A–C minimum for a credible listing; E optional for “connectors” store copy (do not claim connectors before E ships).  
**Criteria:** Production Readiness.

---

### Phase G — Hardening & quality (parallel track)

| ID | Work item | Done when |
|---|---|---|
| G1 | Unit tests for extracted sidepanel components + background message router | Background + UI no longer at 0% |
| G2 | Playwright e2e extension suite expanded (`tests/e2e/chrome`) for grant → summarize → sign-in | CI catches Bug A/B regressions |
| G3 | Privacy policy + in-product copy audit vs actual data flows | CWS privacy review safe |
| G4 | Performance budgets: panel interactive < 300ms after open; extract < 1s P95 on average article pages | NFR-style budgets measured |
| G5 | Threat model note: page-content prompt injection → connector send; mitigations in E9 documented | Reviewable artifact |

**Runs parallel to C–F.**

---

## 6. Sequencing

```
A (Unblock bugs + optional hosts) ─────────────────────────────┐
   │                                                            │
   ├─► B (Auth launchWebAuthFlow + honest Trust)                │
   │         │                                                  │
   │         └─► C (Visual/UX redesign) ──► D (Sector + memory) ┤
   │                    │                                       │
   │                    └─► E (Connectors) ◄── Part 1 §3A/3B ───┤
   │                              │                             │
   └──────────────────────────────┴─► F (CWS + monitoring) ◄────┘
                                      G (tests) parallel throughout
```

### Priority call-outs

1. **Phase A is non-negotiable and first.** Both live bugs make Chrome fail in under a minute. No redesign work should outrank A.
2. **Phase E must not invent a Chrome-only OAuth vault.** It rides Part 1 §3; if Web connectors slip, Chrome ships read-only mocks behind a feature flag rather than a divergent security model.
3. **Store claims must lag reality.** Do not advertise connectors or “reads every page” until A+E (as applicable) are shipped.
4. **BYOK does not apply to Chrome.** Chrome remains account-gated and credit-metered (Part 1 §4); inference stays platform-hosted.

### Suggested version milestones

| Version | Ships |
|---|---|
| **0.2.0** | Phase A + B5 (extractor) — usable copilot |
| **0.3.0** | Phase B + C — reimagined UX, honest Trust |
| **0.4.0** | Phase D — sector/memory excellence; CWS candidate |
| **0.5.0** | Phase E Tier-1 connectors |
| **0.6.0** | Phase E Stripe + F store live |

---

## 7. Explicit non-goals (this evolution)

- Reviving the PRD FAB / content-script injection on every page.
- Autonomous multi-step browser operation (click around the web without confirm).
- Install-time `<all_urls>`.
- Amplify or Cognito Hosted UI as the primary Chrome sign-in UX.
- A separate Chrome database or embedding store.
- Desktop / IDE feature parity inside the panel (handoff to Web Chat / IDE remains the escape hatch).
- Claiming Chrome Web Store presence before Phase F completes.

---

## 8. Judging-criteria map

| Criterion | How Chrome’s plan moves the needle |
|---|---|
| **Agentic Memory Design** | Captures, price history, workspace↔project link, and (Phase E/E8) `workflow_runs` all land in the same CockroachDB memory graph, recallable from Chrome and other surfaces. |
| **Technical Implementation** | Correct MV3 side-panel permission model; `launchWebAuthFlow`; shared connector proxy; Readability wiring; tests on the two largest untested files. |
| **Real-World Impact** | Sector actions (recruiting/sales/retail) + connectors (calendar, email, Stripe) from the browser — the SME’s actual workplace. |
| **Production Readiness** | Bug A/B fixed; honest Trust; CWS submission; monitoring; prompt-injection posture on connector writes; packed-build smoke. |
| **Creativity & Originality** | Trust-first companion with durable memory and sector awareness — not another generic sidebar LLM and not an autonomous browser agent. |

---

## 9. Open decisions (resolve before Phase C/E build)

1. **Panel color mode:** light-companion (recommended) vs full Graphite dark — pick one for v0.3; do not ship a half-themed toggle.
2. **Connector OAuth UX:** connect entirely inside `launchWebAuthFlow`, or deep-link to Web Settings connectors page then return — recommend Web Settings as source of truth UI, panel as status + execute.
3. **Content script vs executeScript-only:** start with executeScript (simpler CWS story); introduce a narrow content script only if selection toolbar / always-on sector chip is required in D3+.
4. **Whether Chrome Ask becomes a multi-turn agent loop** (shared harness) vs remains single-shot streamed completions — recommend graduating to shared harness when connectors land (E3), so tool-calling is real.

---

## 10. Reference links (research)

- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Web Accessible Resources — navigation blocking](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)
- [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Declare permissions / optional_host_permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Stay secure (MV3)](https://developer.chrome.com/docs/extensions/mv3/security)
- [Side panel launch UX guidance](https://developer.chrome.com/blog/extension-side-panel-launch)
- [Google modern-web-guidance — side panel / activeTab caveat](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/chrome-extensions/references/extensions/side-panel.md)
- [Claude in Chrome permissions model](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide)
- Internal: `docs/walkcroach-master-doc.md` §2, `docs/walkcroach-chrome-prd.md`, master plan Part 1 §3–§4 (connectors + credits)

---

## 11. One-page summary

WalkCroach Chrome today is a real side-panel copilot with cross-surface memory — blocked by a **structurally invalid `activeTab`-only model for side-panel actions** and a **sign-in redirect to a non-web-accessible `auth.html`**. Fix those first (Phase A/B). Then redesign to Graphite Lumen as a page-first companion (Phase C), deepen sector memory (Phase D), attach shared calendar/email/Stripe connectors with propose→confirm (Phase E), and clear the Chrome Web Store (Phase F). Keep trust-first: never silent writes, never client-held provider tokens, never claim store or connector capabilities before they ship.
