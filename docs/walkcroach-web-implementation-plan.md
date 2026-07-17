# WalkCroach Web — Phased Implementation Plan

**Document:** Engineering delivery plan for full PRD scope  
**Companion:** [walkcroach-web-prd.md](./walkcroach-web-prd.md) (requirements), [plan1.md](./plan1.md) (locked hackathon infra)  
**Live product:** https://walkcroach.conquerorfoundation.com  
**Deployed apps:** `https://{slug}.walkcroach.conquerorfoundation.com`  
**Timeline:** July 17 → August 18, 2026 (~32 days)  
**Version:** 1.2 — July 17, 2026 (Phases 1–3 + Cognito/JWT hardening implemented; pending prod GitOps deploy)

---

## 1. Executive summary

WalkCroach Web has a **working product core**: Bedrock Nova streaming agent, CockroachDB memory, WebContainer preview, prod builder on Lambda + CloudFront, checkpoints, generated-app backend (secrets + DB proxy), visual editing, one-click deploy, GitHub sync, and usage metering. That is roughly **70–80% of the PRD surface area** (Phases 1–3 implemented; Phase 4 + production hardening remain).

The remaining work is **submission polish, breadth features, and production verification**: prod Cognito sign-up flow, Stripe billing, custom domains, E2E smoke tests, demo video, and Phase 4 items (share link, social auth, annotation).

This plan sequences that work across **four phases** aligned with the PRD, with concrete engineering tasks, schema/API changes, infra additions, and exit criteria. It assumes:

- **Locked** (from `plan1.md`): Lambda + API Gateway streaming, WebContainer, CockroachDB memory, Nova 2 Lite + Titan embeddings, React/Vite/Tailwind generated stack, separate `web/` and `infra-backend/` npm projects.
- **New** (from PRD): user accounts, checkpoints, file durability, secrets proxy, deploy pipeline, Stripe metering, GitHub integration.

### Current maturity snapshot (updated July 17, 2026)

| Area | Maturity | Notes |
|------|----------|-------|
| Agent harness + streaming | **Strong** | `runPromptTurn`, tools, memory recall, NDJSON, plan approval |
| WebContainer preview | **Strong** | Boot, write/edit, terminal, HMR, per-project remount |
| Lambda API | **Strong** | 30+ routes, CORS, streaming, proxy, deploy |
| Chat + Plan/Build UI | **Strong** | Router, `BuilderPage`, plan review, activity panel |
| Memory (backend) | **Strong** | `memory_summary` refresh after preferences |
| Memory (product UX) | **Good** | FR-32 dashboard cards; more polish possible |
| Checkpoints | **Strong** | S3 snapshots, revert, auto checkpoint, ZIP export |
| Dashboard / multi-project | **Strong** | List, archive, delete, guest cap |
| Auth | **Good** | Cognito Hosted UI + PKCE (web); `aws-jwt-verify` (Lambda); API GW JWT authorizer in prod; dev tokens gated by `ALLOW_DEV_AUTH` |
| Generated-app backend | **Good** | DB provision, secrets vault, SQL/HTTP proxy |
| Deploy / export | **Good** | CodeBuild → S3 → CloudFront; `*.walkcroach.conquerorfoundation.com` |
| Billing | **Early** | Credit meter + ledger; Stripe not integrated |
| Visual editing | **Good** | Element picker, inline edit, scoped prompt |
| GitHub | **Good** | GitHub App OAuth + installation tokens; PAT fallback in dev |
| **Overall PRD** | **~70–80%** | Phase 4 + auth/billing hardening remain |

---

## 2. Research synthesis

### 2.1 Category patterns (Lovable, Bolt.new, v0, Replit Agent)

| Pattern | Why it matters | WalkCroach status |
|---------|----------------|-------------------|
| **Checkpoints on every AI edit** | #1 trust mechanism; revert without re-prompting | Missing — highest ROI gap |
| **Plan preview before multi-file edits** | Reduces unwanted changes; category standard | Plan mode exists; approval gate missing |
| **Visual / inline edit** | Closes "describe what you mean" gap; free micro-edits | Missing |
| **Generated-app backend** | WebContainer cannot store secrets or call arbitrary APIs safely | Missing — architectural |
| **Deploy + custom URL** | Toy → owned asset; judging criterion | Missing |
| **GitHub / ZIP export** | No lock-in trust signal | Missing |
| **Templates + example prompts** | Activation; blank box kills conversion | Single hardcoded template |
| **Credit metering** | Category monetization; usage transparency | Missing |
| **Cross-session memory** | Compounding value / retention | **Built** — but invisible |

WalkCroach's **differentiator** (CockroachDB memory across sessions) is ahead of the category technically but **behind on product surfacing**. Phase 1 explicitly fixes that.

### 2.2 WebContainer constraints ([StackBlitz docs](https://webcontainers.io/guides/configuring-headers))

| Constraint | Implication for plan |
|------------|---------------------|
| **COOP/COEP required** | Already in `infra-web` CloudFront + Vite dev headers — keep regression tests |
| **HTTPS in production** | Satisfied via CloudFront |
| **Chromium-first** | NFR-21/22: degrade gracefully on Firefox/Safari for builder; dashboard/billing work everywhere |
| **In-memory filesystem** | Tab close = file loss unless synced to CRDB/S3 — **Phase 1 checkpoint + file sync** |
| **No safe secret storage** | All generated-app credentials via **server-side proxy** (Phase 2) — never in WC env |
| **Single boot per page** | Refactor `previewStarted` global before multi-project |
| **`mount()` for fast boot** | Use for templates (FR-01) instead of agent-written scaffold |

### 2.3 AWS streaming agent pattern ([API Gateway docs](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html))

Current stack is correct:

- REST API `responseTransferMode: STREAM`
- URI: `.../2021-11-15/functions/{lambdaArn}/response-streaming-invocations`
- Lambda: `awslambda.streamifyResponse` + NDJSON events
- Client: `fetch` + `ReadableStream` line parser

**Extensions needed:**

- New event types: `plan_preview`, `checkpoint_created`, `usage_debited`
- Buffered JSON routes for dashboard, checkpoints, deploy status (non-streaming OK)
- API auth middleware before expanding surface area

### 2.4 Generated-app backend — recommended architecture

This is the PRD's largest new trust boundary (FR-18–21).

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (WebContainer preview)                                  │
│  - Generated app calls https://api.../proxy/{projectId}/...     │
│  - NEVER holds DB password or third-party API keys               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  WalkCroach API (Lambda)                                         │
│  - Secrets proxy: validates session, reads SM, forwards request  │
│  - DB provisioner: ccloud API / admin creds → per-project DB     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
   CockroachDB         AWS Secrets         S3 artefacts
   (memory schema)     Manager             (checkpoints, deploy)
   (app schema)        (per-project)       (ZIP export)
```

**Decision:** Per-project **database** on shared CockroachDB cluster (NFR-28), not per-project cluster. Credentials in Secrets Manager keyed `walkcroach/projects/{projectId}/app-db` and `.../user-secrets/{name}`.

---

## 3. Architecture evolution (without reopening plan1)

### 3.1 What stays the same

- Single Lambda router (`lambda-handler.ts`) for agent routes
- `agent-harness` package for Bedrock loop
- `packages/db` for CRDB client + migrations
- NDJSON streaming for `/prompt` and `/tool-result`
- WebContainer for all **edit/build** execution
- CockroachDB as WalkCroach system of record

### 3.2 What we add

| Layer | Addition | Phase |
|-------|----------|-------|
| **Web app structure** | React Router, layout shells, feature folders | 1 |
| **Auth** | Cognito User Pool (or Clerk if speed > AWS-native) | 1 (basic) / 3 (OAuth) |
| **File durability** | `project_files` snapshots + S3 blobs | 1 |
| **Checkpoints** | `checkpoints` table + revert API | 1 |
| **Secrets proxy** | New Lambda routes + IAM | 2 |
| **App DB provisioner** | Admin automation against Cockroach Cloud | 2 |
| **Deploy worker** | Lambda: zip WC tree → build → S3 → CF invalidation | 3 |
| **Billing** | Stripe + `usage_ledger` in CRDB | 3 |
| **GitHub App** | OAuth + push Lambda | 3–4 |

### 3.3 Recommended web app restructure (Phase 1, week 1)

```
web/src/
├── app/                    # Router + layouts
│   ├── LandingPage.tsx
│   ├── DashboardPage.tsx
│   └── BuilderPage.tsx
├── features/
│   ├── chat/
│   ├── preview/
│   ├── checkpoints/
│   ├── dashboard/
│   ├── activity/
│   └── onboarding/
├── hooks/                  # existing + new
├── api/                    # expand client.ts → modules
├── webcontainer/           # existing
└── components/ui/          # shared primitives
```

Refactor `App.tsx` early — every Phase 1 feature will fight the monolith otherwise.

### 3.4 Recommended backend module split (Phase 1–2)

```
infra-backend/modules/lambda-agent/codes/src/
├── handlers/
│   ├── agent/              # prompt, toolResult (existing)
│   ├── projects/           # CRUD, list, memory summary
│   ├── checkpoints/
│   ├── files/              # sync, export zip
│   ├── deploy/             # Phase 3
│   ├── secrets/            # Phase 2 proxy
│   └── billing/            # Phase 3
```

Consider **second Lambda** for long-running deploy builds if 15 min timeout becomes tight — start with one Lambda + async S3 status polling.

---

## 4. Data model additions

Migration `002_product.sql` (Phase 1) — extend, don't replace `001_initial.sql`:

```sql
-- Users (if not using Cognito sub only on projects.owner_id)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cognito_sub STRING UNIQUE,
  email STRING,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Checkpoints
CREATE TABLE checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  session_id UUID REFERENCES sessions(id),
  name STRING,                          -- null = auto-named
  summary STRING NOT NULL,
  storage_key STRING NOT NULL,          -- S3 key for file-tree snapshot
  parent_checkpoint_id UUID REFERENCES checkpoints(id),
  superseded_by UUID REFERENCES checkpoints(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project file index (latest known state; full blobs in S3)
CREATE TABLE project_files (
  project_id UUID NOT NULL REFERENCES projects(id),
  path STRING NOT NULL,
  content_hash STRING NOT NULL,
  storage_key STRING NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path)
);

-- Extend projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status STRING NOT NULL DEFAULT 'draft';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_id STRING;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS memory_summary STRING;  -- cached FR-32

-- Usage ledger (Phase 3)
CREATE TABLE usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id),
  action_type STRING NOT NULL,
  credits INT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generated-app resources (Phase 2)
CREATE TABLE project_app_resources (
  project_id UUID PRIMARY KEY REFERENCES projects(id),
  app_database_name STRING,
  secrets_prefix STRING,                -- SM path prefix
  provisioned_at TIMESTAMPTZ
);

CREATE VECTOR INDEX IF NOT EXISTS memory_entries_embedding_idx
  ON memory_entries (embedding);
```

**File snapshot strategy:** After each checkpoint-worthy turn, tar.gz WebContainer tree → `s3://walkcroach-artefacts-{env}/projects/{projectId}/checkpoints/{id}.tar.gz`. Revert = download + `wc.mount()` or per-file write. Async after `done` event (NFR-04).

---

## 5. API surface roadmap

### 5.1 Implemented (July 17, 2026)

| Method | Route | Status |
|--------|-------|--------|
| GET | `/health` | ✅ |
| GET/POST | `/projects`, `/projects/:id` | ✅ |
| POST | `/projects/:id/archive`, DELETE `/projects/:id` | ✅ |
| GET | `/projects/:id/sessions/latest` | ✅ |
| POST | `/sessions` | ✅ |
| GET | `/sessions/:id` | ✅ |
| POST | `/sessions/:id/prompt` | ✅ stream |
| POST | `/sessions/:id/tool-result` | ✅ stream |
| POST | `/sessions/:id/plan-decision` | ✅ stream |
| GET | `/sessions/:id/activity` | ✅ |
| GET/POST | `/projects/:id/checkpoints` | ✅ |
| POST | `/checkpoints/:id/revert` | ✅ |
| POST | `/projects/:id/files/sync` | ✅ |
| GET | `/projects/:id/export` | ✅ |
| GET | `/projects/:id/resources` | ✅ |
| GET/POST | `/projects/:id/secrets` | ✅ |
| POST | `/projects/:id/provision-database` | ✅ |
| POST | `/proxy/:projectId/sql`, `/http` | ✅ |
| GET/POST | `/projects/:id/inline-edit/*` | ✅ |
| POST | `/projects/:id/deploy` | ✅ |
| GET | `/projects/:id/deployments` | ✅ |
| GET/POST | `/projects/:id/github/*` | ✅ (PAT MVP) |
| GET | `/me/usage` | ✅ |
| POST | `/webhooks/stripe` | ⏳ not implemented |

### 5.2 Phase 1 additions

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/projects` | Dashboard list (owner scoped) |
| GET | `/projects/:id` | Project detail + memory summary |
| PATCH | `/projects/:id` | Rename, archive |
| DELETE | `/projects/:id` | Soft delete |
| GET | `/projects/:id/memory-summary` | FR-32 card text |
| GET | `/projects/:id/checkpoints` | Version history |
| POST | `/projects/:id/checkpoints` | Manual checkpoint |
| POST | `/checkpoints/:id/revert` | Restore file tree |
| GET | `/sessions/:id/activity` | `build_events` panel |
| POST | `/projects/:id/files/sync` | Client pushes WC tree hash/manifest |
| GET | `/projects/:id/export` | Presigned ZIP URL |

**Agent protocol extensions (NDJSON):**

```typescript
// New outbound events
{ type: 'plan_preview', files: [{ path, reason }], planId: string }
{ type: 'plan_awaiting_approval', planId: string }
{ type: 'checkpoint_created', checkpointId: string, summary: string }
```

**Plan approval flow (FR-06/07):**

1. Harness detects Build mode + estimated file count > 3 (or always in explicit Plan→Build transition).
2. Stream `plan_preview`; set session status `awaiting_plan_approval`.
3. Client shows Approve / Adjust / Cancel UI.
4. `POST /sessions/:id/plan-decision` with `{ planId, decision, adjustment? }` resumes loop.

### 5.3 Phase 2 additions

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/projects/:id/provision-database` | FR-18 |
| POST | `/projects/:id/secrets` | FR-21 write-only |
| GET | `/projects/:id/secrets` | Masked list only |
| POST | `/proxy/:projectId/*` | FR-20 secrets/DB proxy |

### 5.4 Phase 3 additions

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/projects/:id/deploy` | Trigger deploy |
| GET | `/projects/:id/deployments` | History |
| POST | `/projects/:id/github/connect` | OAuth handoff |
| POST | `/projects/:id/github/push` | FR-25 |
| GET | `/me/usage` | Credit balance |
| POST | `/webhooks/stripe` | Billing events |

---

## 6. Phase 1 — Foundation UX ✅ **IMPLEMENTED**

**Dates:** Jul 17 → Jul 27, 2026 (~10 days)  
**Status:** Code complete; migrations `002_product.sql`, `003_checkpoints.sql` applied locally. Pending prod GitOps deploy + exit-bar verification in prod.  
**Theme:** Make memory and trust **visible**; no new AWS services beyond S3 artefacts already provisioned.  
**PRD:** FR-01–03, FR-06–13, FR-24, FR-31–34, FR-39–40

### 6.1 Week breakdown

#### Days 1–2: Shell + routing + auth skeleton

| Task | Detail | Owner hint |
|------|--------|------------|
| P1.1 | Add React Router: `/`, `/dashboard`, `/project/:id` | Frontend |
| P1.2 | Extract `BuilderPage` from `App.tsx` | Frontend |
| P1.3 | Landing page (UJ-01): one-screen value prop + memory differentiator + CTA | Frontend |
| P1.4 | Cognito User Pool + hosted UI OR email magic-link MVP | Infra + FE |
| P1.5 | JWT authorizer on API Gateway (or Lambda middleware) | Backend |
| P1.6 | Replace `web-anonymous` with `sub` from token; migration for existing rows | Backend |

**Exit:** Signed-in user hits dashboard, not raw builder.

#### Days 3–4: Dashboard + multi-project

| Task | Detail |
|------|--------|
| P1.7 | `GET /projects` with `owner_id`, status, `updated_at` |
| P1.8 | Dashboard cards: name, status badge, last edited |
| P1.9 | FR-32: `memory_summary` job — top-3 `memory_entries` (preference/decision) → card blurb |
| P1.10 | Archive/delete (FR-33) soft-delete columns |
| P1.11 | Open project → pick latest session or create new → existing hydrate |

#### Days 5–6: Onboarding + templates

| Task | Detail |
|------|--------|
| P1.12 | Template gallery: 8 curated trees in `web/src/templates/` (not agent-generated) |
| P1.13 | `mount()` template on project create — target NFR-02 < 8s |
| P1.14 | Example prompt chips on blank start (FR-02) |
| P1.15 | First-run tour (FR-03) — driver.js or similar, 4 steps |
| P1.16 | Store `template_id` on project |

**Templates to ship (minimum 8):**

1. Landing page (waitlist)  
2. SaaS marketing  
3. Portfolio  
4. Internal dashboard  
5. Todo app (validates user journey)  
6. Blog  
7. Pricing + FAQ  
8. Admin table CRUD shell  

#### Days 7–8: Plan approval + activity panel

| Task | Detail |
|------|--------|
| P1.17 | Harness: `plan_preview` event before multi-file writes |
| P1.18 | Session status `awaiting_plan_approval` + resume endpoint |
| P1.19 | UI: PlanReviewCard with Approve/Adjust/Cancel |
| P1.20 | Threshold config (default 3 files); single-file bypass (FR-08) |
| P1.21 | Activity panel: `GET /sessions/:id/activity` from `build_events` |
| P1.22 | Fix `model_config.mode` persistence on tool-result resume |

#### Days 9–10: Checkpoints + export + file sync

| Task | Detail |
|------|--------|
| P1.23 | Migration `002_product.sql` |
| P1.24 | Post-turn async: snapshot WC files → S3 → `checkpoints` row |
| P1.25 | Version history panel + revert (FR-11/12) |
| P1.26 | Manual named checkpoint (FR-13) |
| P1.27 | ZIP export Lambda: stream S3 artefacts → presigned URL (FR-24) |
| P1.28 | Periodic `files/sync` from client (debounced manifest) for NFR-10 |
| P1.29 | Enable vector index on `memory_entries` |

### 6.2 Phase 1 infra / CI

- No new AWS services required.
- Extend CodeBuild tests: `web` component tests + API integration smoke.
- Add `GET /projects` etc. to backend IAM if new CRDB tables only.
- S3 artefacts bucket already exists — wire export/checkpoint prefixes.

### 6.3 Phase 1 exit bar (must all pass)

- [x] Template → working preview < 8s (NFR-02) — implemented; verify in prod
- [x] Plan approval blocks multi-file writes until approved
- [x] Checkpoint created after file-writing turn; revert restores preview
- [x] Dashboard shows ≥1 project with memory summary card
- [x] ZIP export downloads valid Vite project
- [x] Auth required for persistent projects; anonymous scratch capped (1 project, no dashboard bypass)
- [x] Cognito JWT authorizer on API Gateway (`enable_apigw_cognito_authorizer` in prod; dev tokens blocked when `ALLOW_DEV_AUTH=false`)

---

## 7. Phase 2 — Visual editing + generated-app backend ✅ **IMPLEMENTED**

**Dates:** Jul 28 → Aug 5, 2026 (~9 days)  
**Status:** Code complete; migration `004_phase2.sql` applied locally. Pending prod deploy.  
**Theme:** New trust boundary — project-scoped data and secrets.  
**PRD:** FR-14–16, FR-18–21

### 7.1 Security review (Days 1–2, before code)

Dedicated review against NFR-13/14:

- [x] Proxy cannot be abused cross-project (owner check on all proxy routes)
- [x] SM paths isolated per project (`walkcroach/{env}/projects/{id}/…`)
- [x] Generated-app DB credentials never in API responses
- [ ] WebContainer network allowlist for proxy host only (not enforced in WC)
- [x] NFR-13 CI grep gate for secret patterns in export bundle (P2.16)

### 7.2 Visual editing (Days 2–5)

| Task | Detail |
|------|--------|
| P2.1 | Preview overlay iframe messaging (same-origin via WC preview URL) |
| P2.2 | Element picker: `data-wc-id` injected in dev build OR babel plugin in template |
| P2.3 | Toolbar: Edit text / Ask about element |
| P2.4 | Inline edit → source file mapping (simple: text nodes in JSX; complex: agent fallback) |
| P2.5 | HMR path without agent turn (FR-15); track daily cap in `usage_ledger` stub |
| P2.6 | Scoped chat: pre-fill prompt with component path + snippet |

**Research note:** Lovable-style precise DOM→source mapping is hard. **MVP approach:** inline edit works for text in leaf elements with known `data-wc-path` attributes added to the starter template; everything else uses scoped agent chat (still valuable).

### 7.3 Generated-app database (Days 4–7)

| Task | Detail |
|------|--------|
| P2.7 | `project_app_resources` table + provision endpoint |
| P2.8 | Automation: Cockroach Cloud API or `ccloud` CLI in Lambda (privileged SM creds) |
| P2.9 | Create DB `wc_app_{projectId_short}` with limited user |
| P2.10 | Agent tool or UI affordance "Add a database" → runs provision + scaffolds `lib/db.ts` |
| P2.11 | Proxy route: `POST /proxy/:projectId/sql` (parameterized, read/write flags) OR use serverless driver pattern |

### 7.4 Secrets vault (Days 6–9)

| Task | Detail |
|------|--------|
| P2.12 | `POST /projects/:id/secrets` → SM `walkcroach/projects/{id}/secrets/{name}` |
| P2.13 | UI: masked list, write-only resubmit |
| P2.14 | Proxy: `POST /proxy/:projectId/http` forwards to third-party APIs with injected auth header |
| P2.15 | Generated app template uses `import.meta.env.VITE_PROXY_BASE` not raw keys |
| P2.16 | NFR-13 test: grep built client bundle for secret patterns — CI gate | ✅ `npm run scan:secrets` |

### 7.5 Phase 2 exit bar

- [x] Click element → toolbar → scoped prompt works
- [x] Inline text edit updates preview via HMR (no agent turn) for `data-wc-path` elements
- [x] "Add a database" provisions isolated DB; generated app reads/writes via proxy
- [x] User API key stored in secrets vault; not recoverable from browser
- [ ] Inline edit < 500ms measured in prod (NFR-03)
- [x] Proxy integration test in CI — `POST /proxy/:id/sql` cross-owner 404; secrets masked on GET

---

## 8. Phase 3 — Ownership, deploy, billing ✅ **IMPLEMENTED** (partial billing)

**Dates:** Aug 6 → Aug 12, 2026 (~7 days)  
**Status:** Code complete; migration `005_phase3.sql` applied locally. Infra module `apps-hosting` added to `infra-backend`. Pending prod Terraform apply (wildcard cert + CodeBuild).  
**Theme:** Ship it and meter it.  
**PRD:** FR-22, FR-25, FR-27–28, FR-35–36

**Domain decision (implemented):** Deployed user apps use `https://{slug}.walkcroach.conquerorfoundation.com` (wildcard `*.walkcroach.conquerorfoundation.com`), not `*.walkcroach.app`. Builder stays at `walkcroach.conquerorfoundation.com` on a separate CloudFront distribution (COOP/COEP for WebContainer).

### 8.1 Deploy pipeline (Days 1–4)

| Task | Detail | Status |
|------|--------|--------|
| P3.1 | `apps-hosting` module in `infra-backend`: wildcard cert `*.walkcroach.conquerorfoundation.com` | ✅ |
| P3.2 | Deploy Lambda: file snapshot → CodeBuild `npm ci && npm run build` | ✅ |
| P3.3 | Publish `dist/` to `s3://walkcroach-apps-{env}/{slug}/live/` | ✅ |
| P3.4 | Shared CloudFront + host-based routing (CloudFront Function) | ✅ |
| P3.5 | Blue/green: staging prefix → promote to `live/` only on success | ✅ |
| P3.6 | UI: Deploy button + progress states | ✅ |
| P3.7 | `deployments` table rows + history panel | ✅ |

**Research note:** Static Vite export is simplest path for FR-27. SSR/serverful generated apps are out of scope — document as limitation.

### 8.2 GitHub one-way push (Days 3–5)

| Task | Detail | Status |
|------|--------|--------|
| P3.8 | GitHub App registration | ✅ manual — SSM parameters |
| P3.9 | OAuth connect flow; store installation token in SM | ✅ installation_id in CRDB + short-lived tokens |
| P3.10 | Manual "Sync to GitHub" | ✅ |
| P3.11 | Commit message from checkpoint summary | ⏳ uses fixed "WalkCroach sync" |

### 8.3 Generated-app sign-in scaffold (Days 4–6)

| Task | Detail | Status |
|------|--------|--------|
| P3.12 | "Add sign-in" affordance → scaffolds email/password auth against project DB | ✅ |
| P3.13 | WalkCroach-hosted auth Lambda for generated apps | ⏳ scaffold only; no hosted auth Lambda |
| P3.14 | Session cookies via proxy domain | ⏳ not implemented |

### 8.4 Billing (Days 1–7, parallel)

**Decision needed in Phase 1 week:** Stripe Billing + Usage Records (category default).

| Task | Detail | Status |
|------|--------|--------|
| P3.15 | Stripe products: Free (N credits/mo), Pro ($25/mo) | ⏳ not implemented |
| P3.16 | `usage_ledger` + middleware: debit on agent turn, deploy, DB provision | ✅ |
| P3.17 | Always-visible meter in builder chrome (FR-35) | ✅ |
| P3.18 | Block or warn at 0 credits | ✅ (402 on deploy; agent turn blocked) |
| P3.19 | Stripe Customer Portal webhook (FR-38 lite) | ⏳ not implemented |

**Fallback if Stripe slips:** usage counter only, no payment — per PRD descope #5.

### 8.5 Phase 3 exit bar

- [ ] Deploy → public `https://{slug}.walkcroach.conquerorfoundation.com` loads built app (verify after prod apply)
- [x] Deployment history visible; failed deploy doesn't take down previous (`staging/` → `live/` promotion)
- [x] GitHub push updates repo with current files (PAT MVP)
- [x] Credit meter visible; free tier enforced (100 credits/mo default)
- [ ] Deploy p50 < 90s measured in prod (NFR-05)

---

## 9. Phase 4 — Breadth + submission polish ⏳ **NEXT**

**Dates:** Aug 13 → Aug 18, 2026 (~6 days)  
**Status:** Not started.  
**Theme:** Round out PRD breadth; protect hackathon submission.  
**PRD:** FR-04, FR-17, FR-23, FR-26, FR-29–30, FR-37–38, §4.10, plan1 §6

### 9.1 Priority order (if time slips, cut from bottom)

1. **Submission polish** (plan1 §6): demo video, architecture diagram, README CRDB/AWS statements, LICENSE  
2. **Share link** (view-only preview URL) — cheap, high demo value  
3. **Custom domain** (FR-29) — if deploy stable  
4. **Two-way GitHub** (FR-26) — complex; descope early if needed  
5. **Social auth** for WalkCroach accounts (NFR-16) + generated app Google (FR-23)  
6. **Freehand annotation** (FR-17)  
7. **Multi-user edit** (§4.10) — **cut first** per PRD §10.2  

### 9.2 Submission checklist (Aug 16–18 hard deadline)

- [ ] 3-minute demo video: Session 1 preference → Session 2 recall → deploy URL  
- [ ] Architecture diagram (plan1 §1–3 visualized)  
- [ ] README: CRDB features used (vector, JSONB, `AS OF SYSTEM TIME` example)  
- [ ] README: AWS services list  
- [ ] Synthetic smoke test in CI (NFR-26)  
- [ ] Prod E2E: template → prompt → preview → deploy  

---

## 10. Cross-cutting engineering work

### 10.1 Testing strategy

| Layer | Approach | When | Status |
|-------|----------|------|--------|
| Harness | Existing smoke scripts + plan approval unit tests | Phase 1 | Partial — `tools.test.ts`, `memory.test.ts`; smoke scripts manual |
| API | Supertest against `local-server.ts` | Phase 1 | ✅ `local-api.integration.test.ts` (auth gate); `local-api.db.integration.test.ts` (CRDB) |
| Web | Vitest + RTL for dashboard, plan approval | Phase 1 | Partial — `scaffold.test.ts`, secret-scan unit tests |
| E2E | Playwright against prod (scheduled) | Phase 3–4 | ⏳ deferred (`buildspec-e2e.yml` stub) |
| Security | Secret leak scan on export bundle | Phase 2 | ✅ `scan:secrets` + `secret-bundle-scan.test.mjs` |
| Auth | Vitest for `resolveAuth` / Cognito JWT | Hardening | ✅ `auth.test.ts` |

### 10.2 Observability (NFR-24–26)

- Structured JSON logs: `{ userId, projectId, sessionId, action, durationMs }`
- CloudWatch metrics: `PromptTTFB`, `CheckpointWriteMs`, `DeployDuration`
- Funnel events → CRDB `analytics_events` table OR CloudWatch EMF (keep Lambda-first)

### 10.3 Performance targets (from PRD §6)

| Metric | Target | How to hit |
|--------|--------|------------|
| TTFB token | p50 < 2.5s | Already streaming; add Bedrock retry (NFR-12) |
| Template preview | p50 < 8s | `mount()` not agent scaffold |
| Checkpoint write | async < 300ms perceived | S3 upload after `done` event |
| Deploy | p50 < 90s | CodeBuild parallel npm; small template scope |

### 10.4 Fix existing tech debt (schedule into Phase 1)

| Item | Fix | Status |
|------|-----|--------|
| Monolithic `App.tsx` | Router + feature folders (P1.1) | ✅ |
| `model_config.mode` not persisted | Write mode on prompt; read on resume | ✅ |
| `WALKCROACH_API_KEY` unused | Enforce in Lambda middleware | ⏳ |
| Vector index commented out | Enable in migration 003 | ✅ (may fail on some CRDB clusters) |
| DB connection per request | Consider `pg` pool singleton in Lambda | ⏳ |
| `previewStarted` global | Per-project WC instance map | ✅ (`mountProjectWorkspace` remount key) |
| Cognito / JWT auth | Replace dev tokens in prod | ✅ implemented; verify after prod deploy |

---

## 11. Team parallelization (two-person assumption)

| Track A (Frontend-heavy) | Track B (Backend/infra-heavy) |
|--------------------------|-------------------------------|
| Router, landing, dashboard | Auth, API middleware |
| Templates, tour, plan UI | Plan approval harness + endpoints |
| Checkpoints UI, activity panel | Checkpoint S3 pipeline |
| Visual editing overlay | Secrets proxy + DB provisioner |
| Deploy UI, billing meter | Deploy Lambda, GitHub App |
| Demo video, polish | Stripe, smoke tests, CI |

**Sync points:** End of each phase at PRD exit bar; daily 15-min standup against task IDs in this doc.

---

## 12. Risk register and descope

Inherited from PRD §10 — **do not cut unless a phase exit bar is missed:**

| Priority | Protect | Cut last |
|----------|---------|----------|
| 1 | Memory visibility + checkpoints | |
| 2 | Deploy (FR-27) | |
| 3 | Generated-app DB + secrets | Cut FR-22 (sign-in) first |
| 4 | Visual editing | |
| 5 | Billing (can ship counter-only) | |
| 6 | Phase 4 breadth items individually | |
| 7 | Multi-user collaboration | **Cut first** |

**Highest technical risk:** FR-18–21 secrets/DB proxy — allocate Phase 2 days 1–2 to design review before implementation.

**Schedule risk:** Phase 1 slip propagates to all later phases. Hold Jul 27 exit bar review before starting visual editing.

---

## 13. Success metrics (instrument from Phase 1 ship)

| Metric | Target | Instrument |
|--------|--------|------------|
| Activation: first preview | > 70% of signups | `project.created` → `preview.ready` |
| Memory visible | FR-32 shown on dashboard load | Analytics event |
| Memory working | Return session without re-stating preference | Compare prompt text to memory_entries |
| Trust | ≥ 20% sessions use revert | `checkpoint.revert` events |
| Ownership | ≥ 30% projects deploy or export | `deploy.completed` / `export.downloaded` |
| Paid conversion | TBD post-Stripe | Stripe dashboard |

---

## 14. Immediate next actions (post Phase 3)

### A. Ship Phases 1–3 + Cognito to production (do first)

1. **Commit + push** `infra-backend/**` and `web/**` through GitOps pipelines.
2. **Run migrations `002`–`005`** against prod CRDB if not already applied there.
3. **Terraform apply** `infra-backend` prod — creates Cognito User Pool, `apps-hosting`, API GW JWT authorizer + `{proxy+}` catch-all. Allow 5–15 min for cert validation.
4. **Verify in prod:**
   - Sign up / sign in via Cognito Hosted UI → dashboard → builder
   - API calls succeed with Cognito access token (no `dev:*` tokens)
   - Template → preview → Deploy → `https://{slug}.walkcroach.conquerorfoundation.com`
   - Credit meter decrements on agent turn / deploy
   - GitHub sync with PAT

### B. Phase 4 — submission polish (Aug 13–18)

1. **Demo video** (3 min): preference → recall → deploy URL  
2. **Architecture diagram** + README (CRDB features, AWS services list)  
3. **Prod E2E smoke test** in CI (template → prompt → preview → deploy)  
4. **Share link** (view-only preview URL) — high demo value, low effort  
5. **Custom domain** on deployed project (FR-29) — if deploy stable  

### C. Hardening (parallel or post-hackathon)

| Item | Priority |
|------|----------|
| Cognito prod verification (first user sign-up, token refresh, sign-out) | High — code done |
| Stripe billing (P3.15, P3.19) | Medium — counter-only works for demo |
| GitHub App OAuth (replace PAT) | Medium |
| NFR-13 secret leak scan in CI | Medium | ✅ wired in `web/buildspec-test.yml` |
| Session cookies via proxy domain (P3.14) | Low |
| Two-way GitHub sync (FR-26) | Low — descope if time slips |

---

## 14.1 Completed work log (July 17, 2026)

| Phase | Migrations | Key deliverables |
|-------|------------|------------------|
| **1** | `002_product.sql`, `003_checkpoints.sql` | Router, dashboard, 8 templates, plan approval, checkpoints, ZIP export, file sync |
| **2** | `004_phase2.sql` | Visual editor, secrets vault, DB provision, SQL/HTTP proxy, `wc-bridge` |
| **3** | `005_phase3.sql` | `apps-hosting` infra, CodeBuild deploy, GitHub PAT push, usage meter, sign-in scaffold |
| **Auth** | — | Cognito User Pool + SPA client, SSM params, Lambda `aws-jwt-verify`, API GW JWT authorizer, web PKCE + `/auth/callback`, buildspec env wiring |
| **Security** | — | NFR-13 generated-app bundle secret-leak scan (`scan:secrets` in unit-test CI) |
| **Tests** | — | Vitest: 41 tests (auth, API supertest, secrets/proxy, harness, scaffold, NFR-13) |

**Migrations applied locally:** 001–005. **Not committed** unless user requests git commit.

---

## 15. References

- [walkcroach-web-prd.md](./walkcroach-web-prd.md) — full FR/NFR catalog  
- [plan1.md](./plan1.md) — locked architecture, Phases 0–4 hackathon baseline  
- [WebContainer headers guide](https://webcontainers.io/guides/configuring-headers)  
- [API Gateway Lambda response streaming](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode-lambda.html)  
- [AWS Compute Blog: response streaming](https://aws.amazon.com/blogs/compute/building-responsive-apis-with-amazon-api-gateway-response-streaming/)  
- RevenueCat State of Subscription Apps 2026 (cited in PRD §1.2) — AI app retention benchmark  

---

*This plan is the engineering execution companion to the PRD. Update task checkboxes in PR/issue tracker; keep this document as the phase-level source of truth.*
