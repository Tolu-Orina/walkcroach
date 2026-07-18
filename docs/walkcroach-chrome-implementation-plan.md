# WalkCroach Chrome — Implementation Plan

**Status:** Ready to implement (pending capacity allocation vs Web)  
**Module:** Module 2 — WalkCroach Chrome (standalone SME copilot + shared memory)  
**Companion docs:** `walkcroach-chrome-prd.md`, `plan1.md`, `walkcroach-web-implementation-plan.md`  
**Research cutoff:** July 2026  
**Last updated:** July 18, 2026

---

## 0. One-sentence thesis

> WalkCroach Chrome is a Manifest V3 copilot that extracts page context on user gesture, streams short Bedrock answers through a thin Chrome BFF, and persists captures into the same CockroachDB memory plane as WalkCroach Web — without reusing the Web builder agent loop.

**Platform stays shared. Surface adapter is new.**

---

## 1. Locked architecture decisions

Do not reopen unless blocked. These supersede the narrow Phase 5 stub in `plan1.md` where they conflict with the Chrome PRD.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data + identity plane | **Same** Cognito pool, CockroachDB cluster, Bedrock, Secrets Manager, CloudWatch | Product moat is cross-surface memory (FR-C17/C18); forking CRDB/Cognito breaks it |
| Compute for Chrome API | **New Lambda** (`walkcroach-chrome-{env}`) behind same API Gateway (path prefix `/chrome/*`) | Web Lambda is builder-protocol heavy; Chrome needs short TTFB summarize/draft/capture/recall |
| Shared packages | Reuse `@walkcroach/db`; extract embed/recall helpers (do not import codegen tools) | Same migrations and vector search; no WebContainer tool surface |
| Extension runtime | Manifest V3 only; service worker as coordinator | MV2 dead for new store submissions in 2026 |
| Extension tooling | **WXT + React + TypeScript + Vite** | 2026 default for new production extensions (active maintenance, Vite HMR, file-based entrypoints). Plasmo maintenance slowed; CRXJS is fine but thinner |
| UI shell | FAB (content script, Shadow DOM) + Chrome **Side Panel** for workspace/chat | Side Panel API = persistent UI without host permission; competitors still inject DOM sidebars, which fights CSP/host pages |
| Page extraction | `@mozilla/readability` on cloned DOM + plain-text fallback; never send until user action | Industry standard (Firefox Reader View); extraction quality dominates perceived AI quality |
| Permissions | Install: `storage`, `activeTab`, `scripting`, `sidePanel`. Host access via `optional_host_permissions` JIT | Matches PRD trust model + Chrome privacy guidance; lowers store review friction |
| Auth | Anon device session first; Cognito PKCE via `chrome.identity.launchWebAuthFlow` when saving across devices / linking Web | Zero-setup activation (UJ-C1); tokens never in plaintext `chrome.storage` |
| Streaming | API Gateway REST + Lambda response streaming (same pattern as Web `/prompt`); SW forwards chunks over `chrome.runtime.Port` | Sub-2s first token (NFR-C02) requires stream, not buffered JSON |
| Site profiles | Versioned JSON shipped in extension bundle; match client-side only | NFR-C13: no per-navigation backend call |
| Out of scope forever (for this plan) | Bardeen-style playbooks, autonomous form fill, local LLM in SW for MVP | Trust design + MV3 memory/CPU cost |

### What “same infra” means vs does not mean

| Shared (one of each) | Separate (Chrome-owned) |
|----------------------|-------------------------|
| AWS account / envs | Lambda function + handlers under `/chrome` |
| Cognito User Pool | Extension package `chrome/` |
| CockroachDB + migrations | CI path filter for extension zip / store package |
| Bedrock Nova 2 Lite + Titan Embeddings V2 | Chrome-specific IAM least privilege (no deploy/CodeBuild) |
| Terraform root modules (extend `infra-backend`) | Site-profile versioning + Web Store release train |
| Observability account/log groups | Privacy policy page + store listing assets |

---

## 2. Research findings (July 2026)

### 2.1 Competitor product models

| Product | Model | How they feel fast | Gap we exploit |
|---------|-------|--------------------|----------------|
| **Monica** | Side panel / overlay; multi-LLM via their BFF; auto page-context | Context already in prompt; multi-model routing on server; credit budgets | Chat history, not structured durable workspace memory; not sector-aware |
| **Sider / MaxAI** | Agentic side panels; content script + background | Same three-tier pattern; deep page interaction | 2026 security disclosures (Spyder / MaXSS): untrusted page → content script → privileged background. We must never trust page-origin messages for privileged actions |
| **Merlin** | Injected sidebar; site-specific scripts (Gmail, LinkedIn, YouTube) | Per-site content scripts for compose/draft UX | Generic memory; credit-cap UX friction |
| **Perplexity extension** | Research + citations | Narrow scope = simpler latency path | No capture/workspace depth |
| **Grammarly** | Inline overlay on text fields | Extremely optimized local + cloud pipeline; least-surprise UX | Writing only |
| **Bardeen** | No-code playbooks / automation | Deep scrape + multi-step | Learning curve; conflicts with our trust-first SME bet |
| **Gemini in Chrome** | Native browser integration | Zero install latency | Not workspace/memory oriented |

**Consistent industry architecture (all serious AI copilots):**

```text
Side panel / overlay UI
        ↕  chrome.runtime (ports for streams)
Service worker (coordinator, API calls, auth)
        ↕  chrome.tabs.sendMessage / scripting
Content script (DOM extract, FAB, field detect)
        →  Your BFF  →  LLM providers
```

Nobody serious runs LLM keys in the content script. Nobody serious keeps conversation state only in the popup (popups die). Background owns state; UI is a client.

### 2.2 What actually makes them feel “highly performant”

Research across production writeups and Chrome docs converges on these levers (ordered by impact for our scope):

1. **Time to first token, not total latency.** Users tolerate a 4s full answer if text starts streaming at ~1–2s. Buffered “wait then dump” feels broken. Groq/Flash-class speeds (~2s summaries) changed adoption for summarizer extensions more than model quality did.
2. **Extract less, better.** Mozilla Readability on a **cloned** document beats dumping `body.innerText`. Cap payload (e.g. 8–12k tokens of page text) before Bedrock. Bad extraction → long prompts → slow + expensive.
3. **Do nothing on navigation until gesture.** Persistent content scripts that scrape every page load are the opposite of our trust NFRs and waste CPU. FAB can mount light; extract only on click (FR-C16).
4. **Shadow DOM for injected UI.** Isolate FAB/panel styles from host CSS; avoid layout thrash on the page.
5. **Service worker resilience.** SW terminates after ~30s idle; persist to `chrome.storage` / session storage; register listeners at top level; use ports while streaming so the worker stays busy.
6. **Cache per URL (session).** Summary for `url + contentHash` in `chrome.storage.session` avoids repeat Bedrock calls when the user reopens the panel.
7. **Client-side sector matching.** Pattern match URL/DOM locally (NFR-C13). Competitors’ site-specific scripts prove this; they pay maintenance cost — budget for it.
8. **Backend close to model.** Our eu-west-2 Lambda + Bedrock already matches Web. Keep Chrome BFF in the same region; no extra hop through a second product cloud.

### 2.3 Security lessons (mandatory for WalkCroach)

Rebora’s 2026 research on SiderAI / MaxAI (10M+ installs): content scripts accepted messages that looked like extension messages but originated from the page, then forwarded privileged commands to background (tabs, screenshots, synthetic clicks).

**WalkCroach rules:**

- Privileged actions only from extension pages (side panel) or SW after verifying `sender.id === chrome.runtime.id`.
- Content script never exposes a “run arbitrary command” bridge.
- Validate message `type` with a closed allowlist; ignore unknown types.
- Page content is untrusted input: sanitize before render; treat extracted text as data for the model, not executable UI HTML.
- Prefer Side Panel over embedding arbitrary third-party frames inside the extension UI.

### 2.4 Chrome Web Store / policy (2026)

- MV3 required; no remotely hosted executable code.
- Privacy policy: public HTTPS URL, categories aligned with Developer Dashboard disclosures.
- **Limited Use (enforcement Aug 1, 2026):** collect only data necessary for the disclosed single purpose; disclose collection prominently; disclose policy changes after install.
- Broad `<all_urls>` host permissions invite longer review; `activeTab` + optional hosts is the path that matches our PRD and review odds.
- First-time developer account: plan 7–14 business days for review (NFR-C17).

### 2.5 Tooling recommendation detail

| Tool | Verdict for WalkCroach |
|------|------------------------|
| **WXT** | Preferred. Vite, React, file-based entrypoints, healthy 2025–2026 maintenance. |
| Plasmo | Strong CSUI/shadow helpers historically; maintenance risk in 2026. Skip for greenfield. |
| CRXJS | Acceptable if we want “just Vite plugin”; more manual structure. |

---

## 3. Target architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│  Chrome tab                                                     │
│  ┌──────────────┐   messages    ┌────────────────────────────┐  │
│  │ Content      │◄─────────────►│ Service worker             │  │
│  │ - FAB (SD)   │               │ - auth session             │  │
│  │ - extract    │               │ - stream ports             │  │
│  │ - field hint │               │ - site-profile match       │  │
│  └──────────────┘               │ - optional host request    │  │
│                                 └─────────────┬──────────────┘  │
│  ┌──────────────┐                             │                 │
│  │ Side Panel   │◄──── Port stream ───────────┘                 │
│  │ summarize / ask / workspaces / trust panel                   │
│  └──────────────┘                                               │
└────────────────────────────────────┬────────────────────────────┘
                                     │ HTTPS (JWT or anon device key)
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  API Gateway REST  (/chrome/* stream + buffered)                │
│  JWT authorizer (Cognito) + anon device middleware              │
└────────────────────────────────────┬────────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  Lambda: walkcroach-chrome-{env}                                │
│  handlers: summarize | ask | draft | capture | recall |         │
│            workspaces | auth/device | link-project              │
│  uses: Bedrock ConverseStream, Titan embed, @walkcroach/db      │
└───────────────┬─────────────────────┬───────────────────────────┘
                ▼                     ▼
         CockroachDB              CloudWatch
         workspaces               (no plaintext page bodies)
         page_captures
         memory_entries (optional mirror for Web recall)
         projects (link only)
```

**Web Lambda stays untouched** for builder routes. Chrome never calls `/sessions/:id/prompt`.

---

## 4. Repo layout

```text
walkcroach/
├── chrome/                          # NEW — WXT extension (own package.json)
│   ├── wxt.config.ts
│   ├── package.json
│   ├── entrypoints/
│   │   ├── background.ts            # service worker
│   │   ├── content.ts               # FAB + extract + field detect
│   │   ├── sidepanel/               # React UI
│   │   └── options/                 # trust / revoke / privacy links
│   ├── lib/
│   │   ├── extract.ts               # Readability + fallback + hash
│   │   ├── messaging.ts             # typed ports + allowlist
│   │   ├── permissions.ts           # optional host JIT
│   │   ├── site-profiles/           # versioned JSON + matcher
│   │   ├── api.ts                   # Chrome BFF client
│   │   └── auth.ts                  # anon device + Cognito PKCE
│   └── public/
├── infra-backend/
│   ├── modules/lambda-chrome/       # NEW TF module (or sibling to lambda-agent)
│   ├── packages/
│   │   ├── db/                      # migrations 007_chrome_workspaces.sql
│   │   ├── agent-harness/           # shared embed/recall only (or split package)
│   │   └── chrome-api/              # NEW — Chrome handlers (optional package)
│   └── ...
├── ci-cd/                           # path filter: chrome/** → package + artifact
└── docs/
    ├── walkcroach-chrome-prd.md
    └── walkcroach-chrome-implementation-plan.md   # this file
```

Install/run separately (same pattern as `web/` vs `infra-backend/`):

```bash
cd chrome && npm i && npm run dev        # WXT
cd infra-backend && npm i && npm run migrate
```

---

## 5. Data model

Migration `007_chrome_workspaces.sql` (additive; do not rewrite `001`).

**Problem today:** `page_captures.project_id` is `NOT NULL`, which blocks Chrome-only users.

```sql
-- Workspaces: first-class save target for Chrome-only users
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,                 -- Cognito sub OR anon:device:{id}
  name STRING NOT NULL,
  linked_project_id UUID NULL REFERENCES projects(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspaces_owner_id_idx ON workspaces (owner_id);

-- Loosen page_captures for workspace-first saves
ALTER TABLE page_captures ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS owner_id STRING;
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS capture_type STRING NOT NULL DEFAULT 'general';
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS structured_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS content_hash STRING;
ALTER TABLE page_captures ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES page_captures(id);

CREATE INDEX IF NOT EXISTS page_captures_workspace_id_idx ON page_captures (workspace_id);
CREATE INDEX IF NOT EXISTS page_captures_owner_id_idx ON page_captures (owner_id);
CREATE INDEX IF NOT EXISTS page_captures_url_workspace_idx ON page_captures (workspace_id, url);

-- Optional vector index when cluster supports it (same as memory_entries)
-- CREATE VECTOR INDEX IF NOT EXISTS page_captures_embedding_idx ON page_captures (embedding);

-- Device sessions for anon try-first (server-side; hashed device key)
CREATE TABLE IF NOT EXISTS chrome_device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_key_hash STRING NOT NULL UNIQUE,
  owner_id STRING NOT NULL,               -- anon:device:{uuid}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  upgraded_to_cognito_sub STRING NULL
);
```

**Price track (FR-C13):** on repeat URL in same workspace with `capture_type = 'price'`, append to `structured_fields.history` and set previous row `superseded_by` (or update in place with provenance note). Prefer append + supersede to match memory provenance elsewhere.

**When linking to Web (Phase C):** set `workspaces.linked_project_id`; on save, also write a `memory_entries` row (`source_surface = 'chrome'`) so `recall_project_memory` in Web sees it without a second search path.

---

## 6. Chrome BFF API surface

Base path: `/chrome/v1`. All mutating routes require auth (anon device JWT or Cognito). Streaming routes use API Gateway response streaming (same transfer mode as Web).

| Method | Route | Mode | Purpose | Phase |
|--------|-------|------|---------|-------|
| POST | `/chrome/v1/device/session` | buffered | Mint anon device session | A |
| POST | `/chrome/v1/summarize` | **stream** | Page summary from client-supplied extract | A |
| POST | `/chrome/v1/ask` | **stream** | Q&A over page extract (+ optional web grounding later) | A |
| POST | `/chrome/v1/draft` | **stream** | Draft/rewrite grounded in workspace + optional page | A |
| GET | `/chrome/v1/workspaces` | buffered | List workspaces | A |
| POST | `/chrome/v1/workspaces` | buffered | Create | A |
| PATCH | `/chrome/v1/workspaces/:id` | buffered | Rename | A |
| DELETE | `/chrome/v1/workspaces/:id` | buffered | Soft-delete or hard-delete captures policy TBD | A |
| POST | `/chrome/v1/captures` | buffered | Save capture + embed | A |
| GET | `/chrome/v1/captures` | buffered | List by workspace | A |
| PATCH | `/chrome/v1/captures/:id` | buffered | Edit text / structured fields | A |
| DELETE | `/chrome/v1/captures/:id` | buffered | Delete / supersede | A |
| POST | `/chrome/v1/recall` | **stream** or buffered | Vector recall Q&A over captures | A |
| POST | `/chrome/v1/captures/price-track` | buffered | Upsert price history (FR-C13) | B |
| POST | `/chrome/v1/extract/propose` | **stream** | Sector quick-action structured proposal | B |
| POST | `/chrome/v1/workspaces/:id/link-project` | buffered | Link to Web project (FR-C17) | C |
| GET | `/chrome/v1/me/projects` | buffered | List linkable Web projects | C |

### Request contract (summarize / ask)

Client sends **already extracted** text (never “fetch this URL server-side” for MVP — avoids SSRF and matches FR-C16):

```json
{
  "url": "https://example.com/listing/123",
  "title": "...",
  "extractedText": "...",
  "contentHash": "sha256:...",
  "workspaceId": null
}
```

Server truncates to a hard char/token budget, calls Bedrock, streams NDJSON tokens (reuse Web event shape where possible: `{ type: 'token', text }` / `{ type: 'done' }` / `{ type: 'error' }`).

### Auth headers

- Anon: `Authorization: Bearer <device_jwt>` from `/device/session`
- Signed-in: Cognito access token (same authorizer as Web)
- Upgrade path: on Cognito login, reassign `owner_id` from `anon:device:*` → Cognito `sub` in a single transaction

---

## 7. Performance budget

Tied to PRD NFRs. Treat as exit criteria, not aspirations.

| Metric | Target | How we hit it |
|--------|--------|---------------|
| FAB paint | ≤ 300ms after `document_idle` (NFR-C01) | Tiny content script; Shadow DOM; no network on load |
| Summary first token | ≤ 2s p50 (NFR-C02) | Stream; truncate extract; warm Lambda; cache by `contentHash` |
| Recall | ≤ 1.5s p95 (NFR-C03) | C-SPANN / vector index; workspace-scoped query; limit k |
| Site-profile match | 0 network | Local JSON matcher |
| Content script cost on idle pages | Negligible | No Readability until user opens panel / clicks action |
| SW cold start during stream | Masked | Port keep-alive while `ReadableStream` active; persist resume tokens in `chrome.storage.session` if SW dies mid-flight |

**Payload caps (initial):**

- Max extracted text to API: **24k characters** (~6–8k tokens); prefer Readability body over full DOM
- Max captures returned in workspace browser page: 50, cursor pagination
- Embed async after capture ACK when possible (return `captureId` first, embed in same invocation if p50 allows)

---

## 8. Extension internal design

### 8.1 Messaging allowlist

Only these message types (extend deliberately):

| Type | Direction | Privilege |
|------|-----------|-----------|
| `EXTRACT_PAGE` | UI/SW → content | Needs tab access |
| `PAGE_EXTRACT_RESULT` | content → SW | Data only |
| `FAB_CLICK` | content → SW | Opens side panel |
| `REQUEST_HOST_PERMISSION` | UI → SW | User gesture required |
| `STREAM_SUBSCRIBE` | UI ↔ SW (port) | Stream chunks |
| `GET_GRANTED_ORIGINS` | UI → SW | Trust panel |
| `REVOKE_ORIGIN` | UI → SW | Trust panel |

Reject everything else. Never accept `window.postMessage` from the page as a substitute for `chrome.runtime` messages.

### 8.2 Extraction pipeline

1. User opens panel or taps FAB (user gesture → `activeTab`).
2. Content script: `document.cloneNode(true)` → `isProbablyReaderable` → `Readability.parse()`.
3. Fallback: main landmark / `article` / trimmed `innerText`.
4. Compute `contentHash` (sha-256 of normalized text).
5. SW checks session cache; else POST summarize stream.
6. **Nothing leaves the device until step 5 is triggered by an explicit action** (FR-C16). Opening FAB chrome alone does not upload.

### 8.3 Site profiles (Phase B)

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "linkedin-profile",
      "sector": "recruiting",
      "match": { "hostSuffix": ["linkedin.com"], "pathIncludes": ["/in/"] },
      "action": { "id": "extract_candidate", "label": "Extract candidate summary" }
    }
  ]
}
```

Ship in extension; bump `version` on update. Optional later: signed remote JSON as **data** (not code) if store policy allows — default is bundle-only to keep review simple.

### 8.4 Inline draft (FR-C09)

- Detect editable fields via content script heuristics (contenteditable, `textarea`, known compose selectors).
- Show non-blocking affordance; on click, stream draft into side panel; user copies/inserts manually.
- **Never** `element.value = draft` + submit. Insert only after explicit confirm into the focused field if we add insert-at-cursor later.

---

## 9. Phased implementation

Capacity assumption (from PRD §12): Chrome is a **parallel track** with separate ownership, or a **fast-follow** after Web hackathon submission. Phases below are sequential for Chrome itself; they do not displace Web’s Aug 18 plan unless you explicitly reallocate people.

Each phase has **exit criteria**. Do not start the next phase until exits pass.

---

### Phase 0 — Platform slice (3–5 days) ✅ **IMPLEMENTED (local)**

**Goal:** Chrome can call a dedicated Lambda that shares CRDB/Cognito without touching Web builder routes.

| # | Task | Status |
|---|------|--------|
| P0.1 | Terraform `lambda-chrome` module | ✅ |
| P0.2 | API Gateway `/chrome/{proxy+}` | ✅ |
| P0.3 | CORS `*` (extension-compatible; same as Web) | ✅ |
| P0.4 | Migration `007_chrome_workspaces.sql` | ✅ (apply with `npm run migrate`) |
| P0.5 | `POST /chrome/v1/device/session` | ✅ |
| P0.6 | `GET /chrome/v1/health` | ✅ |
| P0.7 | Scaffold `chrome/` with WXT | ✅ |
| P0.8 | CI: `chrome/**` on web pipeline + `chrome/buildspec.yml` | ✅ |

**Local verify:**
```bash
cd infra-backend && npm run migrate && npm run package:lambda:all && npm run dev:chrome
# other terminal:
curl -s http://localhost:3002/chrome/v1/health
curl -s -X POST http://localhost:3002/chrome/v1/device/session -H 'content-type: application/json' -d '{}'
cd chrome && npm run dev
```

**Deploy note:** Terraform apply (via backend pipeline) creates `walkcroach-{env}-chrome` and `/chrome/*` routes. Add `chrome_device_signing_key` to the runtime secret before prod.

**Exit:** Unpacked extension gets 200 from `/chrome/v1/health` with device session. Migration applied. Web `/prompt` path unchanged in prod smoke.

---

### Phase A — Core copilot (PRD Phase A) ✅ **IMPLEMENTED (local)**

**Goal:** FR-C01–C10, C14–C16, C18. Standalone value with zero Web dependency.

| Area | Status |
|------|--------|
| A1 Trust shell + FAB + permissions + trust panel | ✅ |
| A2 Summarize / ask streams + Readability + session cache | ✅ |
| A3 Workspaces / captures / recall / draft / Cognito upgrade | ✅ |

**Local verify:**
```bash
cd infra-backend && npm run dev:chrome
cd chrome && npm run dev
# Side panel: Summarize → Create workspace → Save → Recall
```

#### A1. Trust shell + FAB (days 1–3)

| # | Task | Maps to |
|---|------|---------|
| PA.1 | FAB in Shadow DOM; dismiss per session; restore next navigation | FR-C01, NFR-C01 |
| PA.2 | Open Side Panel on FAB / action click | UJ-C2 |
| PA.3 | `activeTab` + `scripting.executeScript` extract path | FR-C14 |
| PA.4 | Optional host permission request on first save/summarize per origin | FR-C14, NFR-C04 |
| PA.5 | Trust panel: list granted origins, revoke one-click | FR-C15, UJ-C9 |
| PA.6 | First-run single-line tooltip only | NFR-C14 |
| PA.7 | Messaging allowlist + sender checks | Security research |

**Exit:** Install → FAB → open panel on example.com without blanket host permission. Revoke works.

#### A2. Summarize + ask (days 4–7)

| # | Task | Maps to |
|---|------|---------|
| PA.8 | Readability extract + hash + truncation | FR-C02 |
| PA.9 | Stream summarize via Port → Side Panel progressive render | FR-C02, NFR-C02 |
| PA.10 | Ask-about-page stream | FR-C03 |
| PA.11 | Session cache by `url + contentHash` | Perf |
| PA.12 | Visible error + retry on failure | NFR-C10 |
| PA.13 | CloudWatch metrics: TTFB, extract_chars, errors (no body logs) | NFR-C16 |

**Exit:** p50 first token ≤ 2s on a 3k-word article in staging. Opening panel alone sends zero page bytes (assert in test with network spy).

#### A3. Workspaces + capture + recall (days 8–14)

| # | Task | Maps to |
|---|------|---------|
| PA.14 | Workspace CRUD UI + API | FR-C07 |
| PA.15 | Save capture (explicit click) + Titan embed | FR-C05, FR-C06 |
| PA.16 | Workspace browser: list / edit / delete | FR-C10 |
| PA.17 | Recall query over embeddings (workspace or all) | FR-C08, NFR-C03 |
| PA.18 | Inline draft affordance on text fields + manual insert | FR-C09 |
| PA.19 | Cognito upgrade: merge anon captures to signed-in owner | Auth |
| PA.20 | Token storage: short-lived; refresh via backend; no plaintext secrets | NFR-C06 |

**Exit:** Fresh install → summarize → save to “Q3 hiring” → new tab → recall answers with that capture. Anon → sign-in preserves data.

**Phase A exit bar (product):** Activation path complete for Solo Operator without any WalkCroach Web account.

---

### Phase B — Sector quick actions (PRD Phase B) ✅ **IMPLEMENTED (local)**

**Goal:** FR-C11–C13. Launch sectors only.

| # | Task | Status |
|---|------|--------|
| PB.1 | Site-profile JSON v1 + matcher unit tests | ✅ |
| PB.2 | Panel shows sector actions when matched | ✅ |
| PB.3 | `extract/propose` + editable proposal before save | ✅ |
| PB.4 | Price track upsert + history UI | ✅ |
| PB.5 | Support draft tone default | ✅ |
| PB.6 | Maintenance notes in `chrome/README.md` | ✅ |

**Exit:** LinkedIn-like / product / listing fixtures match; price revisit appends history.

---

### Phase C — Cross-surface handoff (PRD Phase C) ✅ **IMPLEMENTED (local)**

**Depends on:** WalkCroach Web sign-in model (Web FR-31+). Do not start before Cognito is reliable in the env you target.

| # | Task | Detail |
|---|------|--------|
| PC.1 | `GET /chrome/v1/me/projects` | ✅ Owner-scoped Web projects |
| PC.2 | Link workspace → `linked_project_id` | ✅ `POST …/workspaces/:id/link-project` |
| PC.3 | On capture to linked workspace, write `memory_entries` with `source_surface='chrome'` | ✅ + price-track + backfill on link |
| PC.4 | Web `recall_project_memory` includes chrome-sourced entries | ✅ No surface filter (verified in harness) |
| PC.5 | UX copy: “Also available in your WalkCroach project” | ✅ Workspaces link UI + save notes |

**Exit:** Demo script: Chrome save → Web builder turn recalls it without re-paste.


---

### Phase D — Store submission + launch (PRD Phase D) ✅ **KIT READY (local)**

| # | Task | Detail |
|---|------|--------|
| PD.1 | Privacy policy page (HTTPS) matching Limited Use + disclosures | ✅ `web/public/chrome-privacy.html` — publish with Web host before submit |
| PD.2 | Developer Dashboard privacy practices aligned to manifest | ✅ `chrome/store/PRIVACY_PRACTICES.md` |
| PD.3 | Permission justifications for every manifest permission | ✅ `chrome/store/PERMISSION_JUSTIFICATIONS.md` |
| PD.4 | Screenshots, store description, single-purpose wording | ✅ `chrome/store/STORE_LISTING.md` (screenshots: capture at submit time) |
| PD.5 | Unpacked → packed zip from CI; version bump policy | ✅ `npm run zip` + `chrome/buildspec.yml`; `VERSIONING.md` |
| PD.6 | Submit; buffer 7–14 days if first publisher account | ⬜ Operator action — see `SUBMISSION_CHECKLIST.md` |
| PD.7 | Post-submit: monitor crash / permission revoke rates | ✅ `POST_SUBMIT_MONITORING.md` + `POST /chrome/v1/telemetry` |
| PD.8 | Optional: Chrome Enterprise policy JSON stub | ✅ `chrome/enterprise/policies.json` |

**Exit:** Listing kit complete; actual CWS publish is an operator step after HTTPS privacy URL + screenshots + prod API zip.


---

## 10. Testing strategy

| Layer | What | Status |
|-------|------|--------|
| Unit | Site-profile matcher, extract truncation, message allowlist, contentHash | ✅ `chrome` `lib/**` Vitest + coverage |
| Handler (local) | Supertest Chrome Lambda — health/401 always; device session + workspace CRUD when `CRDB_CONNECTION_STRING` | ✅ `chrome-api.integration.test.ts` |
| Handler (deployed Test) | Device session → create/list workspace | ✅ `tests/integration/chrome-workspaces.integration.test.ts` |
| Extension E2E | Playwright Chromium + unpacked WXT (`--load-extension`), Xvfb in CodeBuild | ✅ `tests/e2e/chrome/extension.spec.ts` |
| Perf smoke | Scripted summarize TTFB against staging; fail CI if p50 > 2.5s on fixture page | ⬜ deferred |
| Security | Fuzz: page `postMessage` attempts must not trigger privileged SW actions | ⬜ deferred |
| Privacy | Network assertion: no upload before explicit action | ⬜ deferred |

**Exact CI paths:** `web/buildspec-integration.yml` (chrome-api workspace) · `web/buildspec-e2e.yml` builds `chrome` then runs Playwright under `xvfb-run`.

---

## 11. Observability

Log / metric dimensions (never log `extractedText` or draft bodies in plaintext):

- `chrome.summarize.ttfb_ms`, `chrome.ask.ttfb_ms`, `chrome.recall.latency_ms`
- `chrome.extract.chars`, `chrome.cache.hit`
- `chrome.permission.grant`, `chrome.permission.revoke`
- `chrome.capture.save`, `chrome.capture.price_append`
- `chrome.auth.anon`, `chrome.auth.cognito_upgrade`
- Errors by `route` + `error_code` only

Dashboard: reuse CloudWatch; add Chrome-specific log group `walkcroach/chrome/{env}`.

---

## 12. Success metrics wiring (product)

Instrument early so Phase A ships with analytics hooks (even if only CloudWatch + simple event table):

| Metric (PRD §10) | Event |
|------------------|-------|
| Activation | `capture.save` within first session after install |
| Sector fit | `capture.save` + `profile_id` |
| Recall usage | `recall.query` on returning session |
| Trust proxy | distinct granted origins ≥ 2 in first 7 days |
| Cross-surface | `workspace.link_project` |

---

## 13. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Capacity collision with Web Aug 18 plan | Explicit owner for Chrome; Phase A only until Web submits if needed |
| Site profiles rot | Versioned fixtures + monthly maintenance budget; start with 1–2 hosts per sector |
| SW killed mid-stream | Port activity + AbortController; show retry; optional resume not required for MVP |
| Store rejection on permissions | Stick to activeTab + optional hosts; Side Panel for main UI |
| Spyder-class bugs | Allowlist + sender.id checks; security test in CI |
| `page_captures.project_id` legacy rows | Migration nullable; Web-linked path sets both workspace + project when linked |
| Anon abuse | Rate limit per device hash + IP; captcha only if abused |
| Bedrock cost from huge pages | Hard truncate; cache; reject empty/near-empty extracts |

---

## 14. Suggested calendar shapes

Pick one explicitly before coding.

### Shape 1 — Parallel track (recommended if 1 engineer free)

| Window | Focus |
|--------|-------|
| Week 1 | Phase 0 + A1 |
| Week 2 | A2 + start A3 |
| Week 3 | Finish A3; Phase A exit |
| Week 4 | Phase B |
| After Web auth stable | Phase C |
| + store buffer | Phase D |

### Shape 2 — Fast-follow after Web submission

| Window | Focus |
|--------|-------|
| Through Aug 18 | Web only |
| Next 2–3 weeks | Phase 0 + A compressed |
| Following 1–2 weeks | B + D (C when ready) |

Phase A alone validates the repositioning and is enough to demo memory with Phase C later.

---

## 15. Explicit non-goals (engineering)

- Second Cognito pool or second CRDB cluster
- Reusing Web `/prompt` / tool-result protocol from the extension
- Local on-device LLM for MVP (Transformers.js / WebLLM possible later; SW memory cost is high)
- Firefox/Safari builds (WXT can emit later; out of PRD scope)
- Playwright automation / form submit
- Meeting transcription / tab audio

---

## 16. References

### Product / internal

- [walkcroach-chrome-prd.md](./walkcroach-chrome-prd.md)
- [plan1.md](./plan1.md) — locked shared memory architecture
- [walkcroach-web-implementation-plan.md](./walkcroach-web-implementation-plan.md)

### Chrome platform (2026)

- [Extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Protect user privacy](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy)
- [Side Panel API](https://developer.chrome.com/blog/extension-side-panel-launch)
- [Chrome Web Store policy updates (July 1, 2026)](https://developer.chrome.com/blog/cws-policy-updates-2026) — Limited Use enforcement Aug 1, 2026

### AWS (already used by Web)

- [API Gateway Lambda response streaming](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html)
- [Lambda response streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html)

### Extraction / extension patterns

- [mozilla/readability](https://github.com/mozilla/readability)
- [Hugging Face: Transformers.js in Chrome extensions](https://huggingface.co/blog/transformersjs-chrome-extension) (architecture split; local LLM deferred)
- WXT vs Plasmo vs CRXJS comparisons (2026 industry consensus: WXT default for new projects)

### Competitor / security research

- Monica / Merlin / Sider category reviews (2026): multi-model BFF + sidebar; weak durable structured memory
- [Rebora: Spyder & MaXSS (SiderAI / MaxAI)](https://rebora.io/blog/spyder-and-maxss-chrome-extension-vulnerabilities-put-millions-at-risk/) — privileged message handling failures

---

*This plan is the engineering companion to the Chrome PRD. Update task status in the issue tracker; keep phase exits here as the source of truth.*
