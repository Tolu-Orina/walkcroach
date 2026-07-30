# WalkCroach Web Modules — Evolution Implementation Plan

**Date:** July 2026  
**Surface:** WalkCroach Web (`apps`/`web/` + `infra-backend` `lambda-agent` / `agent-harness`)  
**Supersedes for Web scope:** master plan Part 1 §§1–4 (that document remains historical context; **this plan is the implementation authority** for Web Modules evolution).  
**Companion docs:** `walkcroach-master-doc.md` (audit), `walkcroach-master-imp-plan.md` (ecosystem), `walkcroach-chrome-imp-plan.md` (Chrome), `skills/web/*` (WalkCroach Agent Skills).  
**Locked product decisions (not re-litigated):**

| Decision | Detail |
|---|---|
| No Canva | Enterprise-only Autofill; not viable for self-serve SME |
| Native models only | **Amazon Nova 2 Lite** (default), **Nova Pro** (paid orchestrator), **Nova Canvas** (images), **Nova Reel** (video) — no third-party LLM vendors for these pipelines |
| Image hard cap | **Max 3 images / owner / rolling 24 hours** (paid) |
| Video hard cap | **Max 1 × ≤30s video / owner / rolling 72 hours** (paid) |
| Free tier | Lite chat/builder only — **no** Pro orchestration, Canvas, or Reel |
| Trust | Propose → confirm → execute for every paid/creative/connector-write |
| Data | CockroachDB sole system of record; never-delete / `superseded_by` |

---

## How to read this document

This plan is deliberately **more extensive** than master plan §§1–4. It covers:

0. Thesis & current-state deep dive  
1. Skills system (Anthropic skills reviewed → WalkCroach adaptations)  
2. Model routing (Lite / Pro / Canvas / Reel)  
3. Creative Studio (slides & flyers)  
4. Video Studio  
5. Workflow connectors  
6. Pricing, entitlements, hard quotas, billing portal  
7. Chat/Builder UX modules that must change  
8. Data model, infra, security, observability  
9. Phased implementation (A→H) with dependencies  
10. Judging criteria, risks, open decisions, research appendix  

Every major workstream states **current state**, **research-backed change**, **architecture**, **skill hooks**, **phases**, and **criteria impact**.

---

## 0. Product thesis

WalkCroach Web today is a working **Builder + General Chat** product with real credits, plan approval, memory, and deploy — but Chat cannot yet produce the artefacts SMEs actually ship weekly (decks, flyers, short video) or act in the real world (email, calendar, Stripe).

**Evolution goal:** make Personal Chat a **memory-aware SME operations and creative studio** on native AWS models, while Builder remains the app-construction path. One identity, one credit ledger, one skill catalog, two modes.

**What “modules” means here**

| Module | User-facing | Backend |
|---|---|---|
| **Chat core** | General + project chat | Existing agent loop + Lite/Pro routing |
| **Creative Studio** | Slides, flyers, stills | Skills + Canvas + render Lambdas |
| **Video Studio** | ≤30s teaser/ad | Pro → Canvas → Reel → Polly → ffmpeg |
| **Connectors** | Gmail, Calendar, Sheets, Slack, Stripe… | MCP + OAuth proxy + ConfirmCard |
| **Billing & quotas** | Meter, upgrade, hard caps | Extended `credit_balances` / ledger + quota tables |
| **Skills runtime** | Invisible; powers quality | `skills/web` progressive load |

---

## 1. Current state (audit-grounded, Web-only)

### 1.1 What already ships

- Template gallery, coach tour, Builder + Chat modes (`mode: 'chat' | 'builder'`)
- Plan preview / approve gate (`PlanReviewCard`) — trust pattern to extend
- Agent-harness Bedrock loop; default model **`global.amazon.nova-2-lite-v1:0`**
- Credits: `CREDIT_COSTS` = `agent_turn:1`, `deploy:5`, `db_provision:10`, `inline_edit:0`; atomic debit; monthly free grant
- Inline edit daily cap pattern (`INLINE_EDIT_DAILY_CAP`) — **template for image/video hard caps**
- Memory: `memory_entries`, project documents/RAG, checkpoints
- Secrets never to client (NFR scan); Guardrails PROMPT_ATTACK provisioned
- `shared_skills` table + IDE skill loader — Web Chat does **not** yet expose the same creative skill catalog

### 1.2 Gaps this plan closes

| Gap | Evidence |
|---|---|
| No creative generation | Audit: zero slide/flyer/image/video tools |
| MCP stub | `agent-harness/src/mcp.ts` ~15-line stub; IDE has working client |
| No Pro routing | Single Nova 2 Lite ID in Terraform/`bedrock.ts` |
| No Canvas/Reel | Not wired |
| Billing portal deferred | UI copy: Stripe Customer Portal “coming soon” |
| Credits unaware of creatives | No weights for image/deck/video/connectors |
| No hard creative quotas | Only inline-edit daily cap exists as precedent |
| Chat UX not studio-shaped | No job cards, quota meter for images/video, ConfirmCard for creatives |
| Skills for creatives missing | Bundled skills are CockroachDB + coding; no pptx/flyer/video skills |

### 1.3 Cost reality (why caps exist)

| Component | Approx. unit cost | Implication |
|---|---|---|
| Nova 2 Lite | ~$0.30 / $2.50 per 1M in/out (global) | Fine for free chat |
| Nova 2 Pro | ~$1.25–1.375 / $10–11 per 1M (preview/geo-dependent) | Paid orchestrator only |
| Nova Canvas | ~$0.04–0.08 / image | **3/day** ≈ $0.12–0.24/day worst case stills |
| Nova Reel | **$0.08 / second** → 30s = **$2.40** + stills/Polly ≈ **$2.65–2.75** | **1 / 3 days** caps platform burn |
| Slide/flyer render | Lambda + storage cents | Dominated by images |

Without hard caps, a single power user can burn tens of dollars/day on Reel alone. Credits (270/video) are necessary but not sufficient — **hard caps are the production-readiness control**.

---

## 2. Skills system — maximize utilities (instructions + assets + scripts)

### 2.0 Why scripts are load-bearing (research)

Anthropic’s engineering post on Agent Skills ([Equipping agents for the real world](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)) defines a skill as a **folder**: `SKILL.md` + optional linked files + **optional code the agent executes**. The PDF example is the proof: Claude already “knows” PDFs, but form extraction is done by a **pre-written Python script** because:

1. **Determinism** — OOXML/PDF validation must not depend on token sampling.  
2. **Context efficiency** — run the script without stuffing the file or script source into the window.  
3. **Repeatability** — CI and Lambda get the same exit codes every time.

Progressive disclosure has three levels: (1) name/description always loaded, (2) `SKILL.md` body on match, (3) references/assets/scripts discovered only as needed. **Level 3 scripts are not optional polish** for Creative Studio — they are how production document agents avoid shipping corrupt decks.

WalkCroach’s agent-engine already mirrors levels 1–2 (`load_skill`, `references/`). It **skips `scripts/` when indexing markdown** (correct). Web Modules must add the missing half: **mount and execute** those scripts inside `lambda-creative`.

### 2.1 License reality (maximize without stealing)

| Anthropic package | License | WalkCroach action |
|---|---|---|
| `canvas-design`, `theme-factory`, `brand-guidelines`, `frontend-design`, `slack-gif-creator`, `internal-comms` | **Apache-2.0** | **Fully vendored** → `skills/web/vendor/apache/` + promoted assets/fonts/themes/GIF `core/` |
| `pptx`, `pdf`, `docx`, `xlsx` | **Proprietary** (no extract/copy/derive/distribute outside Anthropic Services) | **Reference only** in `docs/research/`; **WalkCroach-owned scripts** implement the same *capability surface* (validate, thumbnail, pdf→images, HD fit) |

Shipping Anthropic’s proprietary `scripts/office/validate.py` (etc.) into WalkCroach Lambda would violate their LICENSE. Shipping **our** `validate_pptx.py` / `thumbnail_pptx.py` that achieve the same pipeline gates is the correct maximize move.

Details: `skills/web/NOTICE.md`.

### 2.2 What is on disk now

| Path | Contents |
|---|---|
| `skills/web/walkcroach-pptx/scripts/` | `validate_pptx.py`, `thumbnail_pptx.py`, `add_hd_image.py` |
| `skills/web/walkcroach-pdf/scripts/` | `pdf_to_images.py` |
| `skills/web/walkcroach-flyer/scripts/` | `check_flyer_pdf.py` |
| `skills/web/walkcroach-image-gen/scripts/` | `check_image_asset.py` |
| `skills/web/walkcroach-video-studio/scripts/` | `assert_reel_still.py` |
| `skills/web/walkcroach-creative-philosophy/assets/fonts/` | 50+ OFL TTFs (Apache canvas-fonts) |
| `skills/web/walkcroach-theme-factory/assets/` | themes + showcase PDF |
| `skills/web/walkcroach-slack-gif/` | Full Apache GIF toolkit (`core/*.py`) |
| `skills/web/walkcroach-internal-comms/` | Apache examples progressive pack |
| `skills/web/vendor/apache/` | Attributable full mirrors |
| `skills/web/requirements-creative.txt` | pip/system deps for lambda-creative |

Also: `walkcroach-docx`, `walkcroach-xlsx`, `walkcroach-pdf` skill stubs for document surface expansion (scripts grow in later phases).

### 2.3 Catalog (Nova-oriented)

| Skill | Role | Executable? |
|---|---|---|
| `walkcroach-model-routing` | Lite / Pro / Canvas / Reel gates | — |
| `walkcroach-quota-and-credits` | Caps + credits | — |
| `walkcroach-brand-guidelines` | Graphite Lumen | — |
| `walkcroach-theme-factory` | Themes | assets |
| `walkcroach-creative-philosophy` | Flyer philosophy | **fonts assets** |
| `walkcroach-image-gen` | Canvas discipline | **check_image_asset** |
| `walkcroach-pptx` | Slides | **validate / thumbnail / HD** |
| `walkcroach-flyer` | Flyers | **check_flyer_pdf** + pdf_to_images |
| `walkcroach-pdf` | PDF rasterize | **pdf_to_images** |
| `walkcroach-video-studio` | 30s video | **assert_reel_still** |
| `walkcroach-docx` / `xlsx` | Docs/sheets (phased) | scripts TBD |
| `walkcroach-connectors` | MCP propose→confirm | — |
| `walkcroach-frontend-design` | Builder UI | — |
| `walkcroach-slack-gif` | Slack GIFs | **core/ Python** |
| `walkcroach-internal-comms` | Comms formats | examples/ |

### 2.4 Runtime integration (markdown + code)

```
User: "Make a 5-slide pitch for our bakery"
  → load_skill(walkcroach-pptx, quota, routing)
  → ConfirmCard
  → Nova Pro brief + Canvas images
  → render_pptx
  → run_skill_script(validate_pptx)     # fail closed
  → run_skill_script(thumbnail_pptx)    # grid to S3 / Pro critique
  → creative_assets ready
```

Phase A engineering must add:

1. Bundle `skills/web` into **lambda-creative** image (scripts + fonts + themes).  
2. Allowlisted tool `run_skill_script` (or fold validate/thumbnail into `render_pptx` post-steps — still invoke the same files).  
3. Register skill metadata with agent-harness for Web Chat (same progressive loader as IDE).  
4. CI job: generate a fixture deck → `validate_pptx.py` must exit 0; thumbnail must produce a JPEG.

### 2.5 Why this beats prompt-only *and* “markdown-only skills”

| Approach | Failure mode |
|---|---|
| System prompt design tips | Drift; no enforcement |
| SKILL.md without scripts | Agent “forgets” QA; corrupt pptx ships |
| **SKILL.md + scripts in Lambda** | Exit codes gate delivery; thumbnails enable visual self-critique without OOXML in context |

This is the same reason Anthropic’s production document skills ship validators and thumbnail grids — WalkCroach matches that architecture with **legal** code ownership.

---

## 3. Model routing architecture

### 3.1 Roles

| Model | When | Who pays |
|---|---|---|
| **Nova 2 Lite** | Default Chat/Builder; intent classification; free tier; connector reads | Platform (metered credits) |
| **Nova Pro** | Paid creative orchestration: briefs, shot lists, critique, complex paid planning | Platform; paid entitlement |
| **Nova Canvas** | Images / reference stills | Platform; paid + **3/day** |
| **Nova Reel** | Video | Platform; paid + **1/72h** + ≤30s |
| **Polly** | Video voiceover | Platform (negligible) |
| **Titan Embed v2** | Memory / creative_assets embeddings | Platform |

### 3.2 Implementation sketch

```ts
// agent-harness / lambda-agent
type ModelLane = 'lite' | 'pro' | 'canvas' | 'reel';

function resolveLane(ctx: TurnContext, toolName?: string): ModelLane {
  if (toolName === 'generate_image') return 'canvas';
  if (toolName === 'start_video_job') return 'reel';
  if (CREATIVE_ORCHESTRATION_TOOLS.has(toolName) || ctx.forcePro) {
    assertPaid(ctx.owner);
    return 'pro';
  }
  return 'lite';
}
```

Terraform adds:

- `nova_pro_model_id` (e. andg. `amazon.nova-2-pro-v1:0` or geo/global inference profile when GA)
- `nova_canvas_model_id` = `amazon.nova-canvas-v1:0`
- `nova_reel_model_id` = `amazon.nova-reel-v1:1`
- IAM: `bedrock:InvokeModel`, `bedrock:StartAsyncInvoke`, `bedrock:GetAsyncInvoke` on those ARNs
- Optional: Reel often requires **us-east-1** async — either run creative Lambdas in that region or use cross-region invoke with an S3 bucket in the allowed region

### 3.3 Entitlement claim

Prefer Cognito group or custom attribute `plan=paid` mirrored into API authorizer context. Free users hitting Pro/Canvas/Reel get `402/403` with `{ code: 'PAID_REQUIRED' }` — Chat renders upgrade.

---

## 4. Creative Studio — Slides & Flyers

### 4.1 Research grounding

- **Gamma** (~$10–20/mo): credits for decks/images; Pro ~$20 ceiling matches our paid tier research.
- **Adobe Firefly**: standard stills vs premium video credit split — validates **separate hard caps** for video.
- **No Canva Enterprise** — own design system + python-pptx / HTML-PDF.
- Anthropic pptx skill QA: no accent bars, real bullets, validate after write — encoded in `walkcroach-pptx`.

### 4.2 Architecture

```
Chat
 → ConfirmCard(brief)
 → generate_creative_brief (Nova Pro, server tool)
 → generate_image × N (Nova Canvas, COLOR_GUIDED_GENERATION)
 → render_pptx | render_flyer (container Lambda)
 → S3 + creative_assets + embedding
 → Chat artefact card (preview + download)
```

Server-side tools only (Bedrock + Chromium + Pillow do not belong in WebContainer).

### 4.3 Data model

```sql
CREATE TABLE creative_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),  -- nullable for General Chat
  owner_id STRING NOT NULL,
  kind STRING NOT NULL,  -- 'slide_deck' | 'flyer' | 'image'
  brief JSONB NOT NULL,
  s3_key STRING NOT NULL,
  preview_s3_key STRING,
  embedding VECTOR(1024),
  credits_charged INT NOT NULL,
  images_consumed INT NOT NULL DEFAULT 0,
  status STRING NOT NULL,  -- generating|ready|failed
  superseded_by UUID REFERENCES creative_assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX creative_assets_owner_created_idx
  ON creative_assets (owner_id, created_at DESC);

-- Vector index (C-SPANN) once cluster confirms — same pattern as memory_entries
```

### 4.4 Image quota enforcement

Reuse inline-edit pattern:

```sql
CREATE TABLE usage_counters (
  owner_id STRING NOT NULL,
  counter_key STRING NOT NULL,  -- 'image_gen_daily' | 'video_gen_3day'
  window_start TIMESTAMPTZ NOT NULL,
  count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, counter_key)
);
```

Logic:

- `image_gen_daily`: if `now() - window_start >= 24h` → reset; else require `count + n <= 3`; increment atomically with debit.
- Slide/flyer/video stills all call the same counter.

### 4.5 Render implementation notes

**Slides**

- Port POC patterns (1920×1080 → EMU @ 6350; HD-enforcement) into `infra-backend/modules/lambda-creative/` (new) or extend lambda-agent container.
- Prefer pptxgenjs **or** python-pptx consistently; run `validate` smoke in CI (schema + “no placeholder lorem”).
- Thumbnail grid optional for Pro self-critique loop (LiteOffice/Chromium screenshot).

**Flyers**

- HTML templates + Playwright in **same** container image family as video compose (one Chromium build).
- Output PDF + PNG preview.

### 4.6 Chat UX

- Studio entry: prompts / chips — “Slides”, “Flyer”, “Image”, “Video”
- ConfirmCard shows: slide count, estimated images, credits, remaining image quota
- Result: inline preview + Download .pptx/.pdf + “Save to project memory”
- Recall: “like the bakery deck” → vector search `creative_assets`

### 4.7 Phased Creative Studio

| Phase | Scope |
|---|---|
| **CS-A** | Skills wired; `creative_assets` + `usage_counters`; `generate_image` + daily cap; ConfirmCard |
| **CS-B** | `generate_creative_brief` + `render_pptx` |
| **CS-C** | `render_flyer` + template library |
| **CS-D** | Memory recall + Guardrails marketing pass + CI visual smoke |

---

## 5. Video Studio

### 5.1 Why 30s + 1/72h

- Reel: $0.08/s → 30s = $2.40 before stills/Polly  
- Wistia engagement data favors sub-1-minute content for SME social  
- **1 per 3 days** ≈ 10 videos/month upper bound ≈ ~$27 infra if always maxed — acceptable for paid SKU; uncapped is not  

### 5.2 Architecture

```
ConfirmCard
 → debit 270 credits + assert video counter < 1 in 72h
 → assert image quota ≥ shots (default 5)
 → Pro: shot list + script
 → Canvas ×5 (1280×720)
 → StartAsyncInvoke MULTI_SHOT_MANUAL (nova-reel-v1:1)
 → Step Functions: poll → Polly → ffmpeg compose → video_jobs.ready
 → Chat job card polls GET /video-jobs/:id
```

```sql
CREATE TABLE video_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  owner_id STRING NOT NULL,
  shot_list JSONB NOT NULL,
  voiceover_script STRING,
  duration_sec INT NOT NULL CHECK (duration_sec <= 30),
  invocation_arn STRING,
  status STRING NOT NULL, -- queued|generating|composing|ready|failed
  s3_key STRING,
  preview_s3_key STRING,
  credits_charged INT NOT NULL,
  images_consumed INT NOT NULL DEFAULT 0,
  error JSONB,
  superseded_by UUID REFERENCES video_jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Cap rule:** count rows with `status IN ('queued','generating','composing','ready')` and `created_at > now() - 72h`. Failed jobs do not consume the cap (allow retry).

### 5.3 Step Functions vs Lambda poll

Prefer Step Functions for backoff/retry and clear failure events; emit EventBridge → optional user email; always reflect status in CockroachDB.

### 5.4 Phased Video

| Phase | Scope |
|---|---|
| **VS-A** | `video_jobs` + counter; single MULTI_SHOT_MANUAL; poll; no audio |
| **VS-B** | Polly + ffmpeg compose + outro |
| **VS-C** | Step Functions + failure UX + 9:16 crop |
| **VS-D** | Memory + share links + Guardrails on script |

---

## 6. Workflow connectors

### 6.1 Research grounding

- MCP is the 2026 integration standard (Stripe, Google, Shopify official servers).
- Zapier Copilot / MCP Apps: **in-chat** automation, not canvas-first — matches SME skills-gap data from Chrome PRD.
- Real-World Impact criterion text literally names calendar / email / Stripe.

### 6.2 Architecture

```sql
CREATE TABLE connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  provider STRING NOT NULL,
  status STRING NOT NULL, -- connected|revoked|error
  scopes STRING[] NOT NULL,
  secret_ref STRING NOT NULL,  -- Secrets Manager ARN/name
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider)
);

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  connector_id UUID REFERENCES connectors(id),
  proposed_action JSONB NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  result JSONB,
  status STRING NOT NULL, -- proposed|confirmed|executed|failed|declined
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 6.3 Implementation sequence

| Phase | Scope |
|---|---|
| **CX-A** | Real MCP client in agent-harness (IDE port) + CockroachDB Managed MCP |
| **CX-B** | OAuth for Google (Calendar, Gmail, Sheets) + Slack; Settings → Connections UI |
| **CX-C** | Chat ConfirmCard + execute + credits |
| **CX-D** | Stripe + HubSpot |
| **CX-E** | workflow_runs recall |

### 6.4 Security

- Tokens only in Secrets Manager  
- Extend `nfr13-secret-leak-scan.mjs`  
- ConfirmCard is the human gate against prompt injection from pasted content  
- Scope minimization per provider  

---

## 7. Pricing, entitlements, billing portal

### 7.1 Tier matrix (updated with hard caps)

| | Free | Paid (~$20/mo) |
|---|---|---|
| Nova 2 Lite chat/builder | Yes (monthly credits) | Yes (larger grant) |
| Nova Pro creative orchestration | No | Yes |
| Images (Canvas) | No | **≤3 / 24h** |
| Video (30s) | No | **≤1 / 72h** |
| Slides / flyers | No | Yes (within image cap) |
| Connectors write | Limited / upgrade | Yes |
| Chrome | Separate free grant; paid = shared pool | Shared credits + same creative caps by owner |

### 7.2 Credit weights

| Action | Credits |
|---|---|
| agent_turn | 1 |
| generate_image | 4 |
| render_flyer | 10 |
| render_pptx | 20 |
| start_video_job | 270 |
| connector_write | 2 |
| deploy | 5 (existing) |
| db_provision | 10 (existing) |

### 7.3 Billing portal

Close the deferred Stripe Customer Portal:

- Checkout for Paid  
- Customer Portal for cancel/payment method  
- Webhook → Cognito group / `entitlements` table  
- Meter + quota remaining in Chat header  

### 7.4 IDE/CLI BYOK (from master §4 — keep, out of Web UI critical path)

Web Modules plan **depends** on not subsidizing IDE inference forever, but BYOK implementation lives primarily in IDE/CLI tracks. Web plan only requires: platform credits remain for Web/Chrome creatives.

---

## 8. Chat & Builder UX changes

### 8.1 Chat

- **Studio rail / chips:** Slides · Flyer · Image · Video · Connect  
- **Quota pills:** `Images 1/3 today` · `Video available` / `Video in 2d 4h`  
- **ConfirmCard** variants: creative brief, connector action, video job  
- **JobCard** for async video  
- **Artefact shelf:** recent creatives from `creative_assets`  
- Upgrade modals for free→paid  

### 8.2 Builder

- Unchanged core loop; optionally suggest “export pitch deck from this app brief” via handoff to Chat creative tools  
- `walkcroach-frontend-design` skill available to Builder via same skill loader  

### 8.3 Settings

- Plan & billing (Portal)  
- Connections (OAuth)  
- Brand kit (optional saved palette → memory)  

---

## 9. Infra, security, observability

### 9.1 New modules (suggested layout per AWS skill)

```
infra-backend/modules/lambda-creative/   # container: pptx, flyer, ffmpeg, playwright
infra-backend/modules/stepfunctions-video/
skills/web/                              # already created
ci-cd path filters include modules/lambda-creative + skills/web
```

Keep low-budget defaults: no VPC/NAT unless required; S3 artefacts bucket; Bedrock IAM on Lambda roles.

### 9.2 Security checklist

- [ ] Guardrails on all Pro/Canvas prompts  
- [ ] Marketing-claim moderation for flyer/slide copy  
- [ ] Secret leak scan includes connector paths  
- [ ] Quota/credit atomicity under concurrency  
- [ ] Presigned URLs short-lived  
- [ ] Content credentials / provenance optional later  

### 9.3 Observability

- CloudWatch metrics: `ImageGenCount`, `VideoJobSuccess/Fail`, `CreativeQuotaDenied`, `ProInvokeCount`  
- Cost Explorer: Bedrock application inference profiles tagged `feature=creative|video|chat`, `tier=free|paid`  
- Feeds Platform Ops Portal (master Part 2 §9) when live  

---

## 10. Phased implementation plan (canonical)

### Phase A — Foundations (skills, entitlements, quotas, image tool, **script runtime**)

**Goal:** Paid users can generate ≤3 images/day with ConfirmCard; free users see upgrade; skills load in Web agent; **lambda-creative can execute skill scripts**.

| ID | Work |
|---|---|
| A1 | Register `skills/web` in agent-harness progressive loader (metadata + body + references/assets paths) |
| A2 | `entitlements` / Cognito paid group; authorizer context |
| A3 | `usage_counters` migration + atomic helpers (mirror inline-edit) |
| A4 | Extend `CREDIT_COSTS` + debit for `generate_image` |
| A5 | `generate_image` tool (Nova Canvas + color-guided) → ends with `check_image_asset.py` |
| A6 | Chat ConfirmCard + image quota UX |
| A7 | **Bake `skills/web/**/scripts` + fonts/themes into lambda-creative image**; allowlisted `run_skill_script` |
| A8 | Tests: quota race, paid gate, skill load, **script exit-code gating** |

**Exit:** Demo “generate a brand-colored product still” on paid account; 4th image denied.

### Phase B — Creative Studio slides

| ID | Work |
|---|---|
| B1 | `creative_assets` migration + S3 layout |
| B2 | `generate_creative_brief` (Nova Pro) |
| B3 | `render_pptx` container tool + HD/EMU rules (`add_hd_image.py`) |
| B4 | **Post-render gate:** `validate_pptx.py` exit 0 required; `thumbnail_pptx.py` → preview_s3_key |
| B5 | Chat artefact preview/download (use thumbnail grid) |
| B6 | CI: fixture deck → validate + thumbnail smoke |

**Exit:** 5-slide deck downloadable; images counted against daily cap.

### Phase C — Flyers

| ID | Work |
|---|---|
| C1 | HTML template pack + `render_flyer` |
| C2 | `walkcroach-creative-philosophy` hooked in brief |
| C3 | PDF+PNG preview in Chat |

**Exit:** One-pager flyer for a sale event.

### Phase D — Video Studio

| ID | Work |
|---|---|
| D1 | `video_jobs` + 72h counter |
| D2 | Reel MULTI_SHOT_MANUAL + poll |
| D3 | Polly + ffmpeg compose |
| D4 | Step Functions + JobCard UX |
| D5 | 9:16 optional  

**Exit:** One 30s video / 3 days on paid; free blocked; second request denied with reset time.

### Phase E — Memory & guardrails for creatives

| ID | Work |
|---|---|
| E1 | Vector index + “like last time” recall |
| E2 | Marketing moderation pass |
| E3 | Alt text + basic a11y checks |

### Phase F — Connectors

| ID | Work |
|---|---|
| F1 | MCP client real |
| F2 | Google + Slack OAuth |
| F3 | ConfirmCard execute + credits |
| F4 | Stripe (+ HubSpot) |
| F5 | workflow_runs recall |

### Phase G — Billing portal & tier polish

| ID | Work |
|---|---|
| G1 | Stripe Checkout + Customer Portal |
| G2 | Webhooks → entitlements |
| G3 | Shared Web/Chrome credit pool visibility |
| G4 | Upgrade prompts everywhere caps hit |

### Phase H — Hardening

| ID | Work |
|---|---|
| H1 | Load tests on quota/debit |
| H2 | Chaos: Reel fail, Polly fail, partial compose |
| H3 | Privacy copy + CWS/Web claims audit |
| H4 | Cost dashboards / budgets for Bedrock creative  

### Sequencing diagram

```
A (skills, entitlements, image+quota)
 ├─► B (pptx) ─► C (flyer) ─► E (memory/guardrails)
 ├─► D (video; needs A image quota)
 ├─► F (connectors; MCP can start after A1)
 └─► G (billing; can parallel after A2)
H throughout after each feature ships
```

**Critical path for hackathon demo:** A → B → D (short) → F Tier-1 (Gmail or Calendar) → G minimal upgrade path.

---

## 11. Judging-criteria map

| Criterion | How Web Modules answer |
|---|---|
| **Agentic Memory Design** | `creative_assets` + `workflow_runs` embeddings; brand/palette recall; cross-session “make another like X” |
| **Technical Implementation** | Native Nova Lite/Pro/Canvas/Reel routing; skills progressive load; atomic quotas; Step Functions video; MCP stub closed |
| **Real-World Impact** | Decks, flyers, 30s ads, email/calendar/Stripe from Chat |
| **Production Readiness** | Hard caps, paid gates, failure states, secret proxy, Guardrails, billing portal |
| **Creativity & Originality** | Memory-aware studio + WalkCroach skills adapted for Nova — not a thin Canva/GPT wrapper |

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Nova Pro preview / ID drift | Abstract behind `NOVA_PRO_MODEL_ID`; Lite fallback for non-creative |
| Reel region lock (us-east-1) | Creative async stack in us-east-1; artefacts replicated or presigned cross-region |
| Image cap blocks video (5 stills) | UX: show combined quota math; allow MULTI_SHOT_AUTOMATED with 0–1 still as degraded path (feature flag) |
| Cost overrun despite caps | AWS Budgets + per-feature inference profiles |
| Anthropic proprietary skill misuse | NOTICE.md; original WalkCroach pptx/flyer skills only |
| Scope explosion | Phases A–B–D demo path first; CX Tier-3 deferred |

---

## 13. Open decisions

1. **Degraded video without 5 stills** when image quota low — allow or hard-fail? (Recommend hard-fail with clear copy for v1.)  
2. **Pro for non-creative paid chat** — always Lite unless creative tools? (Recommend Lite default; Pro only for creative orchestration tools.)  
3. **Brand kit Settings UI** in G or E?  
4. **lambda-creative** separate module vs fat lambda-agent container? (Recommend separate for image size / IAM clarity.)  

---

## 14. Research appendix (selected)

- Amazon Nova pricing / Bedrock: https://aws.amazon.com/nova/pricing/ , https://aws.amazon.com/bedrock/pricing/  
- Nova 2 Lite model card: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html  
- Nova Canvas tasks (incl. `COLOR_GUIDED_GENERATION`): https://docs.aws.amazon.com/nova/latest/userguide/image-gen-access.html  
- Nova Reel async + MULTI_SHOT_MANUAL: https://docs.aws.amazon.com/nova/latest/userguide/video-gen-access.html  
- Anthropic Agent Skills: https://github.com/anthropics/skills  
- Gamma credits: https://help.gamma.app/en/articles/7834324-how-do-credits-work-in-gamma  
- Adobe Firefly credit/video economics (2026 comparisons) — premium video vs standard stills split  
- Internal: `docs/walkcroach-master-doc.md`, `docs/walkcroach-master-imp-plan.md` §§1–4, `skills/web/NOTICE.md`

---

## 15. Deliverables checklist

- [x] WalkCroach skills under `skills/web/` (+ NOTICE)  
- [x] This implementation plan  
- [ ] Phase A engineering (entitlements, counters, Canvas tool, skill loader)  
- [ ] Phases B–H per §10  

---

## 16. One-page summary

WalkCroach Web evolves from Builder+Chat into a **Nova-native SME studio**: **Lite** for everyday chat, **Pro** for paid creative orchestration, **Canvas** (≤3 images/day) and **Reel** (≤1×30s / 3 days) for artefacts, plus **MCP connectors** for calendar/email/Stripe. Anthropic’s public skills were reviewed; Apache ones adapted to Graphite Lumen; proprietary document skills informed original WalkCroach pptx/flyer skills without vendoring restricted materials. Ship foundations and image quotas first, then slides, flyers, video, connectors, and Stripe billing — always propose→confirm→execute, always CockroachDB, always hard caps in front of expensive models.
