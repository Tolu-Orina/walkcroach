# WalkCroach Phased Implementation Plan — Part 1 of 2
## Web Chat Module Expansion, Workflow Connectors, and Cross-Surface Pricing

**Date:** July 2026
**Grounding:** This plan is written against `walkcroach-master-doc.md` — a from-scratch, file:line-cited audit of the actual codebase (not prior PRDs) — plus dedicated 2026 research into AI creative/video generation, SME workflow connectors, and multi-surface monetization. Where this plan references "current state," it means what the audit found in the repository as of 2026-07-29, not what any earlier PRD proposed.
**Part 2** (companion document) covers WalkCroach Chrome, CLI, IDE extension, Desktop, and the Platform Operations Portal.
**Decisions locked before this plan was written** (stated by the team, not re-litigated here): no Canva integration (not commercially acceptable at this stage); video capped at 30 seconds maximum, driven by cost; image generation is a direct Amazon Nova Canvas call (no template-autofill intermediary).

---

## How to read this document

Every workstream below follows the same structure: **current state** (grounded in the audit), **what changes and why** (grounded in research), **architecture**, **phased build plan**, and **how it advances the five hackathon judging criteria** — Agentic Memory Design, Technical Implementation, Real-World Impact, Production Readiness, and Creativity & Originality. Those five criteria are not a section you can skip to; they are the lens this entire plan was designed through, which is why each workstream states explicitly which criteria it moves the needle on rather than treating them as a checklist appended at the end.

---

## 0. Cross-Cutting Principles Carried Into This Plan

Three principles established elsewhere in the WalkCroach ecosystem apply directly to everything in this document, and are restated here because they shape every architecture decision below:

1. **CockroachDB is the sole system of record; nothing new gets its own database.** Every new feature in this plan — creative generation jobs, video jobs, connector credentials, workflow runs, credit ledgers — is a CockroachDB table, not a new external store.
2. **Never delete, mark superseded.** Every new write path reuses the `superseded_by`/soft-delete provenance pattern already proven across `memory_entries`, checkpoints, and project artifacts.
3. **Propose, then confirm, then execute.** Every action that spends money, calls a third-party API on a user's behalf, or generates content that will be shown to *that user's own customers* goes through a visible proposal step before it executes — the same trust-first pattern already governing Web's plan-approval gate, Chrome's click-to-accept model, and the IDE's diff/command preview.

---

## 1. Web Chat Module — Creative Studio (Slides & Flyers)

### 1.1 Current state
The audit found no creative-generation capability anywhere in Web today. The Chat module (§1.1 of the audit, "Personal Chat workspace") is a general-purpose, project-less chat surface layered on top of the same agent loop as the Builder — a real, already-shipped foundation to extend, not a new subsystem to build from scratch.

### 1.2 What changes, and why (research-grounded)
**No Canva.** This was evaluated and correctly rejected: Canva's Connect Autofill and Brand Template APIs — the only endpoints capable of programmatically populating a designed template — require both WalkCroach and every end user's organization to be on **Canva Enterprise**. That is not a fit for a self-serve SME product today. The research's own comparison flagged this as the load-bearing constraint against the Canva route, so this decision is the correct one, not a compromise.

**The replacement architecture** is the one the research identified as the credible fallback: **Nova Pro for copy and structure, Nova Canvas called directly for imagery (no template-autofill step), and `python-pptx` for slide assembly / a headless-Chromium HTML-to-PDF pipeline for flyers.** This is not a downgrade — it is *more* controllable than the Canva route: WalkCroach owns the full design system (brand templates, typography, layout logic) rather than depending on a third party's enterprise tier, and there is no per-export API latency or rate limit (Canva's Export API throttles at 75 exports/5 min per user) to design around.

**A working proof of concept for the slide half already exists** (delivered alongside this plan): `walkcroach_pptx_poc.py` demonstrates the exact technique this feature is built on — a **pixel-perfect coordinate system** (a 1920×1080 canvas maps to PowerPoint's native 12,192,000×6,858,000 EMU slide size at an *exact* 6,350 EMU-per-pixel ratio, with zero rounding drift) and an **HD-enforcement helper** (`add_hd_image`) that refuses to place any image at a size larger than its native resolution, so nothing is ever silently upscaled and blurred. The POC also applies the design-quality rules that separate a professional deck from a visibly AI-generated one: no accent stripes or underline-bars beneath titles, contrast handled by baking a soft scrim into the background asset rather than laying a translucent shape over text, generous margins, and real bullet formatting (not literal `•` characters). This is the direct blueprint for the production `render_pptx` tool below.

**SME-specific industry best practice, applied concretely:** brand-color enforcement via Nova Canvas's native color-guided generation mode (1–10 hex codes accepted per call — feed it WalkCroach's own or the customer's brand palette directly); every auto-generated marketing creative passes through the Bedrock Guardrails `PROMPT_ATTACK` filter already provisioned in `infra-backend` (per the audit, §5.4) before being shown to the user, extended with a content-moderation pass tuned for marketing copy (no unverifiable claims, no protected-category targeting language); accessibility handled at generation time (alt text authored by Nova Pro alongside the image prompt, contrast-checked text placement, caption defaults on any exported video — see §2).

### 1.3 Architecture
```
Chat message ("make me a flyer for our summer sale")
   -> agent loop (existing agent-harness / lambda-agent, per audit §1.2)
   -> new server-side tool: generate_creative_brief   (Nova Pro: copy + structured field map)
   -> new server-side tool: generate_image             (Nova Canvas, direct call, color-guided)
   -> new server-side tool: render_pptx | render_flyer (python-pptx | headless Chromium)
   -> S3 (artefact) + CockroachDB (creative_assets row, embedding for recall)
   -> presigned URL returned to Chat UI
```

These are **new server-side tools**, not client-resume tools — consistent with the existing, audit-confirmed split (`write_file`/`edit_file`/`run_terminal` are client-resume; `web_search`/`recall_project_memory` execute entirely server-side, per audit §1.2). Creative generation needs Bedrock access, Pillow/python-pptx, and a headless-Chromium binary — none of which belong in the browser or a WebContainer session, so this is an unambiguous fit for the server-side category. `render_flyer` runs in a Lambda container image (Chromium + Node/Puppeteer or `playwright-python`) rather than the standard Lambda runtime, following the same container-image pattern the video pipeline in §2 already requires — one container-image build process serves both features.

**Data model addition:**
```sql
CREATE TABLE creative_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),      -- nullable: Chat-only "General" sessions allowed, per audit §1.1
  owner_id STRING NOT NULL,
  kind STRING NOT NULL,                          -- 'slide_deck' | 'flyer' | 'image'
  brief JSONB NOT NULL,                          -- the Nova Pro structured output that drove generation
  s3_key STRING NOT NULL,
  embedding VECTOR(1024),                        -- Titan embedding of brief+prompt, for style/brand recall
  credits_charged INT NOT NULL,
  status STRING NOT NULL,                        -- 'generating' | 'ready' | 'failed'
  superseded_by UUID REFERENCES creative_assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
The `embedding` column is not decorative: it is what turns "generate a flyer" into a **memory-aware** action rather than a one-off API call. A second request in a later session — "make another flyer like the one we did for the sale" — becomes a `recall_project_memory`-style vector search over `creative_assets`, surfacing the prior brief and brand choices before Nova Pro drafts the new one. This is the concrete mechanism that makes Creative Studio contribute to the **Agentic Memory Design** criterion rather than sitting beside it as an unrelated feature: every generated asset becomes queryable, cross-session context for the next one.

### 1.4 Phased build plan
| Phase | Scope | Depends on |
|---|---|---|
| **1A — Slide rendering core** | Ship `render_pptx` as a production Lambda tool using the pixel-perfect/HD-enforcement pattern already proven in `walkcroach_pptx_poc.py`; wire `generate_creative_brief` (Nova Pro) and `generate_image` (Nova Canvas, direct, color-guided); `creative_assets` migration | Existing agent-harness tool-registration pattern |
| **1B — Flyer rendering** | HTML/CSS template system + headless-Chromium Lambda container for `render_flyer`; brand-template library (a small, curated set analogous to Web's existing template gallery, §1.1 of the original Web PRD) | 1A's brief/image tools (shared) |
| **1C — Memory-aware recall** | Vector index on `creative_assets.embedding`; wire "make another one like X" recall into the chat agent's tool-selection prompt | 1A, 1B |
| **1D — Guardrails & QA** | Content-moderation pass on generated marketing copy; automated visual QA (schema validation + a headless render-to-image smoke test in CI, mirroring the pptx skill's own QA discipline) | 1A, 1B |

### 1.5 Judging-criteria contribution
- **Real-World Impact:** this is the single feature in the whole plan most directly aimed at a non-technical SME's actual weekly task list — a usable flyer or slide deck in minutes, not a coding artifact.
- **Creativity & Originality:** a memory-aware creative tool — one that recalls and reuses a brand's prior design choices — is a genuinely different category of product than a stateless "AI slide generator," and it is only possible because the memory layer already exists.
- **Agentic Memory Design:** `creative_assets` is a new, real class of embedded, recallable state, not a toy table.

---

## 2. Web Chat Module — Video Studio (Async, 30-Second Cap)

### 2.1 An architectural simplification the 30-second decision unlocks — stated plainly
The original brief assumed a 3-minute video generated in 90-second batches and stitched together via a Lambda+ffmpeg composition step, because Amazon Nova Reel's per-job cap (2 minutes, in 6-second increments, via its native Multishot mode) is shorter than 3 minutes. **At a 30-second cap, that constraint no longer applies: 30 seconds fits entirely inside a single Nova Reel Multishot job.** The batch-and-stitch pipeline that was necessary at 3 minutes is not necessary at 30 seconds — a single async `StartAsyncInvoke` call produces the whole video. This plan says so explicitly rather than building unneeded stitching complexity to match the original brief's shape after the underlying constraint changed.

**The Lambda+ffmpeg container is still genuinely useful, just for a different job than originally framed:** Nova Reel's output is silent — it does not generate audio — so ffmpeg's real work here is **muxing a generated voiceover track onto the video, burning in a branded outro card, and packaging the final delivery format**, not concatenating segments. This plan adds **Amazon Polly** (AWS-native neural text-to-speech) as the voiceover source, which the original brief did not name but which the research made clear is required — Nova Reel simply has no audio path.

### 2.2 What changes, and why (research-grounded)
Confirmed cap: Nova Reel 1.1 generates in 6-second increments up to 2 minutes at 1280×720/24fps, English-only, async-only, US East (N. Virginia) only, at **~$0.08 per second of output**. A 30-second video is therefore **$2.40 in Nova Reel charges** — a deliberate, order-of-magnitude cost reduction from the ~$14.50–16 a 3-minute video would have cost, and the direct payoff of the cost-driven 30-second decision, worth stating in dollar terms since it validates the call.

The research also corrects the working assumption that "up to 3 minutes is best practice" for this content category: Wistia's 2025 State of Video Report (14M videos, 100,000+ businesses) found engagement of 50% for videos under 1 minute, 46% for 1–3 minutes, and 45% for 3–5 minutes — engagement declines with length across the board, and overall video engagement hit a four-year low with the steepest drop in the 3–5 minute band. A 30-second cap is not just cheaper — it is closer to the length band with the *highest* measured engagement for SME marketing/social content than the original 3-minute target was.

**Multi-shot consistency, still relevant at 30 seconds:** Nova Reel Multishot Manual accepts up to 20 shots of 6 seconds each with a per-shot reference image; a 30-second video is 5 shots. Feeding each shot a Nova Canvas-generated reference still (same brand-color-guided generation used in Creative Studio) keeps character/style/product consistent across the 5 shots within the one job — this technique is retained even though the *reason* it was originally needed (bridging across separate Nova Reel jobs) no longer applies; it now serves within-job consistency instead.

### 2.3 Architecture
```
Chat message ("make a 30-second product teaser")
   -> generate_creative_brief (Nova Pro: shot list, 5 x 6s shots, + voiceover script)
   -> generate_image x5 (Nova Canvas: one reference still per shot, direct, color-guided)
   -> Step Functions state machine:
        1. StartAsyncInvoke (Nova Reel, Multishot Manual, 5 shots + reference stills)
        2. poll GetAsyncInvoke until complete -> video lands in S3 (silent, 720p)
        3. Polly (neural TTS) renders the voiceover script -> S3 (audio)
        4. compose Lambda (Python container, ffmpeg installed):
             - mux video + voiceover
             - overlay a branded outro card (last ~2s)
             - transcode to the final delivery format (web-optimized MP4;
               optionally a vertical 9:16 crop for social use)
        5. write video_jobs row (status='ready', s3_key, duration_sec, credits_charged)
   -> Chat UI polls job status, shows the finished video with a download/share link
```
Step Functions orchestrates this even though only one Nova Reel job is involved, because the pipeline is still genuinely multi-stage and asynchronous end-to-end (generate → wait → voiceover → compose → notify) — exactly the shape Step Functions exists for, and it gives free retry/backoff semantics on the async-poll step without hand-rolled polling logic in a Lambda.

**Data model addition:**
```sql
CREATE TABLE video_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  owner_id STRING NOT NULL,
  shot_list JSONB NOT NULL,
  voiceover_script STRING,
  duration_sec INT NOT NULL CHECK (duration_sec <= 30),
  status STRING NOT NULL,                 -- 'queued'|'generating'|'composing'|'ready'|'failed'
  s3_key STRING,
  credits_charged INT NOT NULL,
  superseded_by UUID REFERENCES video_jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
The `duration_sec <= 30` check constraint enforces the cost decision at the database layer, not only in application code — a cheap, real safeguard against a future code path accidentally requesting a longer, more expensive job.

### 2.4 Cost model at the locked 30-second cap
| Component | Cost |
|---|---|
| Nova Reel (30s @ $0.08/s) | $2.40 |
| Nova Canvas (5 reference stills @ ~$0.04–0.06) | ~$0.20–0.30 |
| Nova Pro (shot list + script) | ~$0.01 |
| Polly (voiceover, ~75 words) | negligible (<$0.01 at standard neural rates) |
| Lambda compose (well under 1 min compute) | ~$0.01 |
| S3 storage/transfer | ~$0.01 |
| **Total per video** | **≈ $2.65–2.75** |

This number should drive the credit price set in §4.

### 2.5 Phased build plan
| Phase | Scope | Depends on |
|---|---|---|
| **2A — Single-job pipeline** | `generate_creative_brief` (video mode), Nova Reel Multishot Manual invocation, async poll, `video_jobs` table | 1A's brief/image tools (shared) |
| **2B — Audio & composition** | Polly voiceover integration; compose Lambda container (ffmpeg + branding overlay + transcode) | 2A |
| **2C — Orchestration & resilience** | Step Functions state machine wrapping 2A+2B with retry/backoff on the poll step; failure-path handling (partial-failure video_jobs rows, user-visible retry) | 2A, 2B |
| **2D — Delivery formats** | Vertical 9:16 crop for social; download/share link UX in Chat | 2C |

### 2.6 Judging-criteria contribution
- **Production Readiness:** the `duration_sec` check constraint, explicit failure-state modeling in `video_jobs`, and Step Functions' built-in retry semantics are concrete "what happens when things go wrong" answers, not an afterthought.
- **Technical Implementation:** correctly using Nova Reel's native multi-shot capability instead of building unnecessary segment-stitching machinery is itself a signal of engineering judgment, not just feature completion.
- **Real-World Impact:** a 30-second video, priced under $3 to generate, is a plausible thing an SME actually uses weekly (a product teaser, a social ad) — a 3-minute video at $15 a generation is not.

---

## 3. Workflow Connectors (Real-World Impact, Built Into Chat)

### 3.1 Current state
No connector/integration capability exists in Web today per the audit. `agent-harness/src/mcp.ts` is an explicit 15-line stub — "*Optional CockroachDB Managed MCP client stub. Wire service-account auth in Phase 1 when enabling agent MCP tools*" — real config plumbing, no live client. The IDE extension, by contrast, already has a genuinely working MCP integration (audit §3.1: `mcp.ts` connects directly to the CockroachDB Managed MCP Server, no proxy) — **this is the reference implementation to port into Web's agent-harness**, not new ground to break.

### 3.2 What changes, and why (research-grounded)
The Model Context Protocol has become the de facto 2026 standard for exactly this kind of connector: official MCP servers now exist from Stripe (`mcp.stripe.com`), Shopify (four official servers), PayPal, Salesforce, Google, and GitHub — meaning WalkCroach does not need to build and maintain bespoke API clients for the highest-value SME integrations; it needs an MCP client and an OAuth-handling layer, both largely proven already in the IDE surface.

**Connector priority, ranked by documented SME workflow impact:**
| Tier | Connectors | Why this tier |
|---|---|---|
| 1 | Google Calendar, Gmail, Google Sheets, Slack | Daily-operational software every SME already uses; official or well-maintained MCP servers exist; lowest OAuth-scope sensitivity |
| 2 | Stripe, a CRM-lite (HubSpot) | Official MCP servers exist (Stripe); direct revenue/pipeline visibility is a documented high-value use case (e.g., the research's CFO margin-analysis example) |
| 3 | QuickBooks/Xero, Shopify | Higher integration complexity/regulatory sensitivity (accounting data); Shopify has official MCP servers but e-commerce is a narrower slice of the SME base than Tier 1/2 |

**UX pattern:** in-chat, not a separate visual automation canvas — matching what the research found as the emerging 2026 norm (Zapier's own AI Copilot builds automations from natural language rather than requiring the canvas first; MCP Apps now return rich interactive widgets directly in a conversation). Every connector action that writes data (send an email, create a calendar event, issue a refund) follows the **propose → confirm → execute** pattern already established as a cross-cutting principle (§0.3) — the agent states exactly what it's about to do, the user clicks confirm, the action executes and is logged.

### 3.3 Architecture
```sql
CREATE TABLE connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id STRING NOT NULL,
  provider STRING NOT NULL,               -- 'google_calendar' | 'gmail' | 'slack' | 'stripe' | ...
  status STRING NOT NULL,                 -- 'connected' | 'revoked' | 'error'
  scopes STRING[] NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- OAuth tokens NEVER stored in this table: same Secrets-Manager-backed proxy
-- pattern already proven for generated-app secrets in Web's Phase2 handlers
-- (audit §1.1: "real credentials never reach the client").

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  connector_id UUID REFERENCES connectors(id),
  proposed_action JSONB NOT NULL,         -- what the agent proposed
  confirmed BOOLEAN NOT NULL DEFAULT false,
  result JSONB,
  status STRING NOT NULL,                 -- 'proposed' | 'confirmed' | 'executed' | 'failed' | 'declined'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Each connected account's OAuth credentials live in Secrets Manager, referenced by ID from `connectors`, and are only ever resolved server-side inside the tool-execution Lambda — the same "credentials never reach the client" guarantee already automated-tested for generated-app secrets (`web/scripts/nfr13-secret-leak-scan.mjs`, per audit §1.1) extends naturally to connector credentials; this plan reuses that existing test rather than inventing a parallel security story.

### 3.4 Phased build plan
| Phase | Scope | Depends on |
|---|---|---|
| **3A — MCP client, real (not stub)** | Port the IDE's working `mcp.ts` pattern into `agent-harness`, closing the audit-flagged stub gap; wire the CockroachDB Managed MCP Server connection Web already needs anyway | IDE's existing `mcp.ts` as reference |
| **3B — Tier 1 connectors** | Google Calendar, Gmail, Sheets, Slack — OAuth flow, `connectors` table, propose→confirm→execute UX in Chat | 3A |
| **3C — Tier 2 connectors** | Stripe, HubSpot | 3B's OAuth/UX pattern proven |
| **3D — Workflow memory** | `workflow_runs` history becomes recallable ("what did we send last week") via the same vector-recall pattern as §1.3 | 3B |

### 3.5 Judging-criteria contribution
This section exists specifically because of, and is scored directly against, the **Real-World Impact** criterion as stated by the team: *"How big of an impact could the project have on real users or workflows? Is the use case meaningful, not just technically impressive?"* A chat agent that can check a calendar, draft and send a real email, or look up a Stripe balance is a materially different claim on real-world usefulness than a chat agent that only talks about a user's business — this is the single highest-leverage addition in this plan against that specific criterion. It also closes a genuine, previously-flagged architecture gap (the MCP stub) rather than adding scope on top of unfinished foundations.

---

## 4. Pricing and Plans

### 4.1 Current state
Per the audit: Web already has a real, working credit system — always-visible meter, free tier + metered costs, **atomic conditional-`UPDATE` credit debits** specifically engineered to prevent concurrent overspend races (audit §1.1), and a full `usage_ledger` audit trail. What's explicitly deferred, confirmed in shipped UI copy: *"Billing portal coming soon... Stripe Customer Portal is deferred."* Chrome already has real three-tier auth (device token / Cognito JWT / dev bypass) — sign-in is not new work for Chrome, it already exists. The IDE currently has no BYOK path at all; its Bedrock calls are presumed platform-hosted (the audit's recent-activity note on "Bedrock auth/region hardening" describes hardening an existing platform-side integration, not a user-supplied-credential path) — **this matters commercially**: if unchanged, WalkCroach is paying for every IDE user's inference today, which is not compatible with "the IDE extension is free."

### 4.2 What changes, and why (research-grounded)
**IDE and CLI: free, BYOK, zero markup — matching the Cline/Continue.dev precedent directly.** Cline (Apache-2.0, 5M+ installs) takes no markup on inference; the user pays their own model provider directly. This is the correct model for WalkCroach's IDE/CLI given the stated decision, and it requires **real engineering, not just a pricing-page change**: a credential-configuration flow (VS Code `SecretStorage` / CLI local config) that lets the extension and CLI call Bedrock **directly from the user's machine with the user's own AWS credentials**, while still routing CockroachDB memory sync, MCP, ccloud, and shared-skills traffic through WalkCroach's authenticated backend (those features need the shared platform, inference does not). This is the one architectural split this whole pricing section hinges on: **inference is BYOK and direct; memory and platform features are Cognito-authed and centralized.**

**Chrome: sign-in required — already true, needs a tier definition, not new auth engineering.** The research's Perplexity Comet and ChatGPT Atlas comparisons validate requiring an account even on a free tier for credit metering, abuse prevention, and cross-device personalization — exactly the justification for Chrome's existing model.

**A unified, weighted credit ledger across all metered surfaces — the dominant 2026 pattern (Adobe, Runway, Gamma).** Adobe's own published rates make the weighting explicit: standard generations cost 1 credit, image generation costs 10–20 credits, and video costs roughly 100× a standard action (their 1080p video rate is 100 credits/second). This plan adopts the same shape, calibrated to WalkCroach's actual Bedrock costs from §1 and §2 rather than copying Adobe's numbers directly.

### 4.3 Proposed credit weights (calibrated to this plan's own cost figures)
| Action | Underlying cost | Credit weight (1 credit ≈ $0.01 of underlying cost) |
|---|---|---|
| Chat message / text generation (Nova Pro) | ~$0.001–0.01 | 1 |
| Nova Canvas image (1024×1024, standard) | $0.04 | 4 |
| Slide deck (brief + ~4 images + render) | ~$0.15–0.25 | 20 |
| Flyer (brief + 1–2 images + render) | ~$0.08–0.12 | 10 |
| 30-second video (§2.4 total) | ~$2.70 | 270 |
| Connector action (calendar/email/Slack) | negligible compute, real third-party call | 2 |

### 4.4 Tier structure
| Tier | Price | Includes |
|---|---|---|
| **Web — Free** | $0 | Monthly credit grant sized to complete one small project + a handful of creative generations (no video by default) |
| **Web — Paid** | ~$20/mo (matches the 2026 category ceiling identified in research) | Larger monthly credit grant including several videos/month; overage priced per credit |
| **Chrome — Free (signed in)** | $0 | Modest monthly credit grant for page actions/captures |
| **Chrome — Paid** | Bundled with Web paid tier | Shared credit pool (§4.5) |
| **IDE / CLI** | **Free, BYOK** | No credits consumed for inference (user's own Bedrock cost); a small platform credit grant covers memory-sync/MCP/skills usage only |

### 4.5 Ledger architecture
A single append-only, block-based credit ledger (extending the existing `usage_ledger`/`credit_balances` tables rather than replacing them) spans Web and Chrome; each credit grant is its own row with an expiry and a priority order for consumption, giving a full audit trail by construction — the pattern the research found common to Metronome, Orb, and Stigg's own architecture guidance. IDE/CLI usage against the *platform* (memory sync, MCP calls, skills) draws from the same ledger at a much lower weight than Web/Chrome, since the expensive part (inference) is BYOK and off-ledger entirely.

### 4.6 Phased build plan
| Phase | Scope | Depends on |
|---|---|---|
| **4A — BYOK inference path (IDE + CLI)** | Credential-configuration UX; direct client-side Bedrock invocation; platform calls (memory/MCP/ccloud/skills) remain Cognito-authed and unchanged | IDE/CLI's existing Cognito auth (kept, not replaced) |
| **4B — Credit-weight rollout for new features** | Wire §1/§2/§3's new actions into `usage_ledger` at the weights in §4.3 | 1A, 2A, 3B |
| **4C — Billing portal** | Close the already-flagged "coming soon" gap: real Stripe Customer Portal integration for self-serve plan management | 4B |
| **4D — Tier enforcement & upgrade prompts** | Free-tier credit-exhaustion UX, upgrade flow, Chrome/Web shared-pool visibility | 4C |

### 4.7 Judging-criteria contribution
- **Production Readiness:** BYOK for IDE/CLI is not just a pricing decision — it removes WalkCroach's own unbounded inference-cost exposure on its fastest-growing, most feature-dense surface, which is a real operational risk the audit implicitly surfaces (no current BYOK path) and this plan explicitly closes.
- **Technical Implementation:** extending the already-proven atomic-debit ledger pattern rather than inventing a second billing mechanism is the correct, lower-risk engineering choice.

---

## Summary: Part 1 Sequencing

```
Phase 1A/1B (Creative Studio core) ──┐
                                      ├──> 1C (memory recall) ──> 1D (guardrails/QA)
Phase 2A (Video single-job) ─────────┤
                                      └──> 2B (audio/compose) ──> 2C (orchestration) ──> 2D (delivery formats)

Phase 3A (real MCP client) ──> 3B (Tier 1 connectors) ──> 3C (Tier 2) ──> 3D (workflow memory)

Phase 4A (BYOK, IDE/CLI) ──> 4B (credit weights for 1/2/3's new actions) ──> 4C (billing portal) ──> 4D (tier enforcement)
```
4B has a hard dependency on 1A, 2A, and 3B having shipped — credit metering needs real actions to meter. 4A (BYOK) has no dependency on the rest of this document and can start immediately; it is arguably the most time-sensitive item in Part 1 given the unbounded-cost-exposure risk it closes.

See **Part 2** for WalkCroach Chrome, CLI, IDE extension hardening, Desktop's paused status, and the Platform Operations Portal that gives this entire plan (and the rest of the ecosystem) the monitoring the audit found completely absent.

# WalkCroach Phased Implementation Plan — Part 2 of 2
## Chrome Reimagined, CLI Build-Out, IDE Extension Hardening, Desktop Status, and the Platform Operations Portal

**Date:** July 2026
**Grounding:** Continues from **Part 1** — same audit (`walkcroach-master-doc.md`), same research base, same cross-cutting principles (§0 of Part 1: CockroachDB as sole system of record, never-delete/superseded_by provenance, propose→confirm→execute).
**Read Part 1 first** for the shared architectural context (the credit ledger, the BYOK decision, and the connector/MCP work this part's IDE and Chrome sections both touch).

---

## 5. WalkCroach Chrome — Reimagined

### 5.1 Current state, including two reproducible bugs
The audit's verdict is blunt and accurate: *"Functional, store-readiness incomplete."* What's real and working: the side-panel copilot (Page/Recall/Workspaces/Trust tabs), workspace linking to Web projects with backfill, anonymous-to-authenticated device-session upgrade with real edge-case handling, and three-tier auth (device token / Cognito JWT / dev bypass). Two things are not working, confirmed by screenshots taken directly against the running extension:

**Bug 1 — "no active tab" error, reproducible on an ordinary page.** The panel's own copy says *"click the WalkCroach toolbar icon on the page first"* — meaning the code already knows the fix, but the condition is triggering when it shouldn't. Per the audit's architecture notes (§2.2), extraction runs via `chrome.scripting.executeScript`, gated on the `activeTab` permission being present — and `activeTab` is only granted by a *qualifying user gesture* (a direct click on the extension's toolbar action). The most likely root cause: the side panel is being opened through a path that Chrome does not count as that qualifying gesture (e.g., a previously-pinned panel reopening automatically, or `chrome.sidePanel.open()` being called from a context one step removed from the raw click handler), so `activeTab` is never actually granted even though the panel is visibly open. **Fix approach:** audit every code path that can result in the side panel being open, and ensure the extraction call only ever fires in direct, synchronous response to the toolbar-icon click handler — never on panel-reopen, tab-switch, or any programmatic trigger; where extraction is attempted outside that direct gesture, show an explicit "click the toolbar icon to grant this page" affordance rather than a generic error, since the current message already gestures at this but the UX doesn't make the actual required action obvious enough for the error to be self-resolving.

**Bug 2 — sign-in blocked (`chrome-extension://invalid`, `ERR_BLOCKED_BY_CLIENT`).** An extension ID resolving to the literal string `"invalid"` in a navigated URL is a specific, well-known symptom: either a hardcoded production extension ID is being used to construct the OAuth redirect/landing-page URL while running in a dev/unpacked context (which gets a different, non-deterministic ID on every load unless pinned), or a call like `chrome.identity.getRedirectURL()` / `chrome.runtime.getURL()` is returning empty/undefined and getting string-concatenated into a URL anyway rather than being checked first. `ERR_BLOCKED_BY_CLIENT` is Chrome's signature for "an extension or policy blocked this specific request" — consistent with Chrome itself refusing to route a malformed `chrome-extension://invalid/...` URL. **Fix approach:** pin a stable extension ID via the `key` field in `manifest.json` for every environment (dev, test, prod) so the ID is deterministic and known ahead of publication; add a defensive check before any navigation that constructs a `chrome-extension://` URL, so a missing/invalid ID fails loudly with a real, actionable error instead of silently producing a URL Chrome then blocks; test the complete sign-in flow against a **packed** build, not only dev-unpacked, before further UI work continues on top of it, since packed vs. unpacked ID behavior is exactly where this class of bug hides.

Both bugs are placed first in this section, ahead of any redesign work, because per the audit's own findings, `chrome/lib/permissions.ts` is **self-documented dead code** (`ensureOriginPermission` always returns `true`, `hasOriginPermission` always `false`) after a move to `activeTab`-only — meaning the Trust tab's entire premise (a visible per-site revoke UI, PRD requirement FR-C15) is currently showing a UI for a permission model that no longer exists. Fixing Bug 1 and retiring or honestly rebuilding the Trust tab are the same piece of work.

### 5.2 What "reimagined" means here — and what it deliberately doesn't mean
The audit found that Chrome shipped a **side panel instead of the originally-specified floating action button (FAB)**, and noted this might genuinely be the better call: zero page-host permissions, nothing to grant or revoke, a materially more trustworthy default than a FAB that must inject into every page. **This plan does not revert that decision.** "Reimagined" here means: fix the two bugs above, wire the better page extractor that already exists but sits unused (`chrome/lib/extract.ts`'s Mozilla-Readability-based implementation vs. the cruder heuristic actually shipped in `background.ts` — audit §2.4, a real, minor, already-diagnosed inconsistency), close the Chrome Web Store submission gap (the checklist has 4 of 9 items unchecked, most critically "Upload to CWS" — there is no evidence the extension has ever actually been submitted), and visually/behaviorally align Chrome with the rest of the WalkCroach product family, which today it does not (the team's own words: "not proud about this — needs UI/UX redesign to be more engaging").

**Concrete alignment work:**
- Adopt the same navy/teal/amber palette and typography already established across Web and the wider WalkCroach brand — currently Chrome has its own, unaligned visual language.
- Extend the propose→confirm→execute pattern (Part 1, §0.3) to Chrome's own actions (summarize, draft, save), so the interaction model *feels* like the same product as Web's plan-approval gate and the connectors work in Part 1 §3, not a separately-designed tool that happens to share a backend.
- Bring the sector-aware quick-action set closer to parity with what price-tracking already proves works (audit §2.1 confirms price-history capture and mirroring into project memory is the single most complete Chrome feature) — extend the same pattern to at least one more high-Real-World-Impact sector (candidate/lead extraction is the natural next one, given Part 1 §3's connector work already touches CRM-adjacent territory).

### 5.3 Phased build plan
| Phase | Scope | Depends on |
|---|---|---|
| **5A — Bug fixes (blocking)** | Fix Bug 1 (activeTab gesture handling) and Bug 2 (extension-ID pinning + defensive URL construction); test both against a packed build | Nothing — highest priority in this entire document given both are user-blocking today |
| **5B — Dead-code retirement** | Wire the real Readability extractor into the shipped path; retire or honestly rebuild the Trust tab's permission-revoke UI to match the actual `activeTab`-only model; remove the now-unreachable telemetry allowlist entries | 5A |
| **5C — Visual/brand alignment** | Navy/teal/amber palette, typography, propose→confirm→execute interaction pattern applied to existing actions | Independent of 5A/5B, can run in parallel |
| **5D — Sector quick-action expansion** | Extend beyond price-tracking to at least one more sector pattern (candidate/lead extraction), reusing Part 1 §3's connector/OAuth plumbing where the target (e.g., a CRM) overlaps | Part 1 §3B |
| **5E — Store submission** | Bring `SUBMISSION_CHECKLIST.md` current to the actually-shipped version; complete and confirm the Chrome Web Store submission; update the stale post-submit monitoring doc (it still references the now-defunct permission-grant/revoke events as its primary trust metric — audit §2.7) | 5A, 5B |
| **5F — Test coverage** | `entrypoints/background.ts` and the ~1,100-line `sidepanel/App.tsx` currently have zero unit coverage (audit §2.3) despite being the two largest, most stateful files in the surface | Can run alongside 5B–5E |

### 5.4 Judging-criteria contribution
- **Production Readiness:** two live, user-blocking bugs and an apparently-unsubmitted store listing are the most concrete "what happens when things go wrong" gaps in the entire Chrome surface — fixing them is not polish, it's the difference between a demoable product and one that fails in the first sixty seconds of a judge's own use.
- **Real-World Impact:** sector quick-action expansion (5D) is the same lever as Part 1 §3, applied to Chrome's own surface.

---

## 6. WalkCroach CLI — Build-Out

### 6.1 Current state
Genuinely good news, understated in the original ask: per the audit, the CLI **already has** the Ink-based TUI the team wanted, and shares the exact same `runAgentLoop` engine as the IDE extension — meaning chat, project awareness, and local code generation already work with real feature parity at the engine level, not a reimplementation. What's missing is entirely in **ergonomics and distribution**: no browser-based PKCE sign-in (manual token paste only), no command to set MCP/ccloud secrets (hand-edit a JSON file), no `revert` command despite the underlying engine fully supporting it, no shared-skills/project-memory listing commands, and — the most consequential gap — **no packaging or CI pipeline exists for the CLI at all**; distribution today is `npm link` from a local clone.

### 6.2 What's newly requested, and how it fits what's already there
The team's ask — a wrapper around WalkCroach with ccloud CLI capabilities, a TUI, and the ability to scaffold a project and open it in VS Code, Cursor, or (eventually) WalkCroach Desktop — is **already mostly true today** for the chat/TUI/ccloud parts. The genuinely new piece is **project scaffolding with editor handoff**, which does not exist in any form yet.

### 6.3 Architecture for the new scaffold-and-open command
```
walkcroach create <name> [--template <slug>] [--open vscode|cursor|walkcroach]
   -> reuses Web's existing template gallery definitions (web/src/templates/index.ts)
      so a project scaffolded from the CLI starts from the exact same, already-
      curated set a Web user picks from — one template source of truth, not two
   -> writes the template's files to a local directory
   -> git init + initial commit
   -> writes a WALKCROACH.md seeded from the template's known conventions
      (mirrors the IDE's own local-memory-file pattern)
   -> registers the project in CockroachDB (`projects` row, source_surface='cli')
      so it's immediately visible in Web's dashboard and linkable from the IDE,
      not a CLI-only artifact
   -> shells out: `code .` | `cursor .` | (Desktop's own protocol handler, once it exists)
```
Reusing Web's own template definitions rather than maintaining a second copy in the CLI is a small decision with a real payoff: templates only need updating in one place, and a project started from the CLI looks identical, on day one, to one started in the browser.

### 6.4 Phased build plan
| Phase | Scope | Depends on |
|---|---|---|
| **6A — Ergonomic parity with the IDE** | Browser-based PKCE sign-in (port the IDE's existing flow); `walkcroach secrets set` for MCP/ccloud; `walkcroach revert`; `walkcroach memory list` / `walkcroach skills list` | IDE's existing PKCE and revert implementations as direct reference |
| **6B — Packaging & CI** | `cli/buildspec.yml`; real `publishConfig`; npm publish pipeline with semver, matching the discipline already proven in `chrome/VERSIONING.md`/`CHANGELOG.md` | None — independent, should not wait on 6A |
| **6C — Project scaffold + editor handoff** | `walkcroach create` per §6.3 | Web's template definitions (read-only dependency, no changes needed to Web) |
| **6D — BYOK inference** | Same credential-configuration work as the IDE (Part 1 §4.6, Phase 4A) — the CLI shares the IDE's engine, so this should ship as one piece of work across both surfaces, not two | Part 1 §4A |

### 6.5 Judging-criteria contribution
- **Technical Implementation:** reusing the shared engine and Web's template definitions rather than building parallel implementations is exactly the kind of engineering discipline this criterion rewards — the CLI's genuine parity with the IDE "at the engine level" (audit §3.3) is a real asset to build on, not a gap to paper over.
- **Production Readiness:** shipping an actual CI/publish pipeline (6B) closes the single largest ops-maturity gap identified anywhere in the audit's five-surface comparison — the CLI is explicitly named as "the clear ops laggard among these three" (audit §3.7).

---

## 7. WalkCroach IDE Extension — Improvements

### 7.1 Current state
The audit's assessment is the strongest in the whole ecosystem: *"The single most feature-dense surface... Scope has grown well beyond its PRD."* Checkpoints/revert, attachments, local semantic search, a bidirectional shared-skills library, interactive PTY terminal sessions, hard-verify gates, and an adversarial "verify-review" sub-agent are all real, tested, and — critically — **none of this was in the original PRD**. This is the surface with the least foundational work left and the most room for targeted hardening.

### 7.2 What changes, and why
Four specific, audit-identified gaps, none of which require new product scope — all close existing, known weak points:

1. **Test coverage is misleadingly reported.** The `ide` package's 40%-statement coverage gate is computed over only 3 files, **excluding `App.tsx` (1,244 lines) and `webviewProvider.ts` (1,353 lines) entirely** — the two largest, most business-critical files in the package. The reported number is not representative of real risk.
2. **`loop.ts` (1,099 lines), the agent loop itself, has no dedicated test file anywhere** — its only coverage is indirect, through Lambda integration tests. This file is shared with Web (Part 1's entire Creative Studio and Video Studio pipelines run through it), so a regression here has the widest blast radius of any file in the ecosystem.
3. **Latency budgets (NFR-D01/02/03 from the original IDE PRD) are unmeasured and unenforced anywhere in code** — a real, if soft, production-readiness gap: nobody would currently know if the extension quietly regressed on responsiveness.
4. **Public Open VSX publishing is pre-written but never executed** — distribution today is a private VSIX pipeline only, with a documented, ready path to public listing sitting unused. This is close to a free win: the work is largely done, it just hasn't shipped.

A fifth item is a **deliberate, considered non-change**: the original PRD described sub-agents that could *write* files in parallel (one renaming an API, one updating tests); what's built restricts sub-agents to read-only investigation, with the parent turn performing all mutation. The audit correctly frames this as "a real narrowing," but it's also the safer default, and nothing about the current product roadmap requires reopening it yet — this plan leaves it as a Phase 3 (creativity/stretch) item rather than a hardening priority.

### 7.3 Phased build plan
| Phase | Scope | Depends on |
|---|---|---|
| **7A — `loop.ts` test suite** | Direct unit coverage for the shared agent loop, prioritized above all other IDE work given its blast radius across both Web and the IDE | None |
| **7B — Coverage-gate correction** | Bring `App.tsx` and `webviewProvider.ts` into the `ide` package's actual coverage gate; backfill tests to a real 40%, not a number computed over an unrepresentative 3-file subset | 7A's testing patterns as a template |
| **7C — BYOK inference** | Shared work item with the CLI (§6.4, Phase 6D / Part 1 §4A) | Part 1 §4A |
| **7D — Public Open VSX publish** | Execute the already-written, not-yet-run publishing path | None — genuinely low-effort given the audit's own characterization |
| **7E — Latency instrumentation** | Add real measurement against NFR-D01/02/03's original budgets; alert on regression once the Platform Ops Portal (§9) exists to receive it | §9 (for alerting; measurement itself can start earlier) |
| **7F — Stdio MCP security review (stretch)** | The audit confirms this was a deliberate, documented deferral ("a real security surface deserving its own review") — schedule the review rather than let the deferral become permanent by default | 7A–7D |

### 7.4 Judging-criteria contribution
- **Technical Implementation:** the loop.ts test gap (7A) is the single most consequential quality-engineering fix available anywhere in this two-part plan, given how many other surfaces (Web's entire Part-1 buildout, the IDE, the CLI) depend on this one file behaving correctly.
- **Production Readiness:** an honest coverage number (7B) and real latency instrumentation (7E) are exactly what this criterion asks for — evidence the team knows what "when things go wrong" looks like on its most mature surface, not just its newest ones.

---

## 8. WalkCroach Desktop — Status and Recommendation (Postponed)

### 8.1 Current state, stated plainly
Per the audit: a **structurally complete, functionally shallow scaffold**. Every phase is marked "✅" in its own docs, almost always qualified "✅ Structural." The full VS Code fork **has never been compiled**. The flagship justification for forking at all — native, deeply-integrated AI UI, per the original Desktop PRD's own stated rationale — **does not exist as working code anywhere in the tree**; the renderer simulates a streamed agent response rather than calling the real, already-implemented `desktop-agent` package sitting one unbuilt IPC bridge away. Git history is two commits, both from the same evening, contradicting the multi-week phased narrative the docs describe.

None of this means the work was low-quality — the opposite is true in places that matter: the decision log (no Marketplace proxy, ever; Open VSX-only from day one, citing Cursor's own 2025 enforcement precedent) is genuinely well-reasoned, and `desktop-agent`'s `desktopHostAdapter.ts` and `session.ts` are real, working, unit-tested code — they are simply never invoked by the actual Electron application today.

### 8.2 Recommendation
**Postponed until funded, as decided.** Two low-cost, non-negotiable actions regardless of the pause:
1. **Do not describe Desktop as a working fifth surface in any external-facing material** — demo videos, pitch decks, the hackathon submission itself — until the electron-main bridge exists and the fork actually compiles. This costs nothing and directly protects the team's credibility on the **Production Readiness** and **Real-World Impact** criteria, both of which would be actively undermined by an inaccurate claim if a judge or user tried it.
2. **Preserve, don't discard, the scaffolding quality already there** — the decision log and the isolation discipline (`scripts/audit-surface-area.mjs` enforcing a committed allowlist of exactly what fork-specific code is allowed to touch) are exactly the kind of engineering artifact that makes resuming this work cheap later. Nothing here needs active investment while paused; it needs to not be quietly lost or contradicted by unrelated changes to the sibling `walkcroach` repo it depends on via a `file:` reference.

No phased plan is written for Desktop in this document — there is nothing to phase until funding changes the constraint.

---

## 9. Platform Operations Portal (`admin.walkcroach.conquerorfoundation.com`)

### 9.1 Current state — the gap this section exists to close
This is the direct fix for the single largest cross-cutting gap the audit identified: *"No monitoring/alerting exists anywhere. A grep across all of `infra-backend/**/*.tf` for `aws_cloudwatch_metric_alarm`, `aws_sns_topic`, `aws_budgets_budget` returned zero matches. No scheduled synthetic smoke test against production either, despite the [Web] PRD's own NFR-26 calling for one."* Every surface's Lambda BFF business-logic handlers are also the thinnest-tested part of that surface (audit finding #4, repeated identically across `lambda-agent`, `lambda-chrome`, and `lambda-ide`) — this portal is where that risk becomes *visible* in production even before it's fully closed in code, which is the realistic order of operations: you cannot fix what you cannot see happening.

### 9.2 What changes, and why (research-grounded)
**Bedrock cost attribution has a purpose-built, low-effort answer as of 2026: use it, don't build a substitute.** AWS now offers **granular cost attribution**, which automatically attributes Bedrock inference cost to the calling IAM principal with no code changes and no resources to manage, plus **application inference profiles**, which let every on-demand model invocation be tagged (tenant ID, surface, feature) and surface as aggregated, dollar-denominated data directly in Cost Explorer and Cost and Usage Reports. This is turned on, not built — the highest-leverage, lowest-effort item in this entire plan.

**A genuinely CockroachDB-idiomatic technical decision, worth stating as a deliberate choice:** the research's generic guidance calls for "a read replica or separate reporting queries against the primary database to avoid impacting production load" — the RDS-world pattern. CockroachDB does not need a separate read-replica database to get this property: **its own follower reads / `AS OF SYSTEM TIME` historical-read capability** lets the admin portal's dashboards query slightly-stale, non-contending data directly against the same cluster, without provisioning, syncing, or paying for a second database. This is not a compromise version of the research's recommendation — it's a better-fitted one, and it is exactly the kind of tool-native insight the **Creativity & Originality** criterion asks for ("does it demonstrate insight into what makes agentic systems different... and, here, what makes CockroachDB different from a conventional RDBMS").

**Per-tenant token-level detail**, beyond what dollar-level Cost Explorer attribution gives: the Bedrock Converse API's `requestMetadata` parameter, captured in model invocation logs and ETL'd (AWS Glue) into a queryable form, gives the finer-grained "which customer, which feature, how many tokens" view the research identifies as the standard pattern — feeding either QuickSight or, more consistently with this plan's own architecture, a CockroachDB reporting table read via the same follower-reads approach.

### 9.3 Architecture
```
admin.walkcroach.conquerorfoundation.com (new S3+CloudFront frontend,
  same hosting pattern already proven for Web in infra-web)
   -> new lambda-admin (Cognito-authed, DISTINCT admin user group/role —
      never the same permission scope as the public user pool client)
   -> reads via CockroachDB follower reads / AS OF SYSTEM TIME
      (no new database, no read-replica provisioning)
   -> Bedrock granular cost attribution + application inference profiles
      -> Cost Explorer / CUR (dollar-level, per-tenant, zero extra code)
   -> Converse API requestMetadata -> model invocation logs -> Glue ETL
      -> token-level detail table (CockroachDB, follower-read queryable)
   -> CloudWatch composite alarms + AWS Budgets (genuinely new Terraform,
      the audit's #1 gap, closed directly here)
   -> OpenTelemetry, tenant-tagged, across the Lambda BFFs
      (a natural place to also finally add the Lambda-handler test coverage
      the audit flags as thin on every single surface — the portal gives
      that work somewhere to report its findings)
```

### 9.4 Dashboards (the essential set, per research)
| Dashboard | Data source |
|---|---|
| Per-customer usage across all four active surfaces | `usage_ledger` (Part 1 §4.5) via follower reads |
| Per-surface API health (latency, error rate) | CloudWatch metrics per Lambda BFF |
| AWS infra cost, attributed per customer/feature | Bedrock granular cost attribution + application inference profiles + CUR |
| LLM token spend per customer | Converse `requestMetadata` + Glue ETL |
| Anomaly/abuse detection | CloudWatch composite alarms + AWS Budgets thresholds |
| Cross-surface memory-graph health | `memory_entries`/`shared_skills` row counts, vector-index query latency (both already real tables per audit §5.2) |

### 9.5 Bundled hardening (same workstream, same Terraform surface area)
Because this phase is already touching `infra-backend`'s Terraform end-to-end, it is the natural, low-incremental-cost moment to also close four small, already-identified gaps rather than opening a second infra workstream later:
- **IAM-hardening asymmetry** — the backend pipeline's broadly-scoped `Resource: '*'` role should receive the same per-environment hardening already applied to the web pipeline (audit §5.5).
- **`agent_locks` orphaned table** — confirm zero references (the audit already found none) and drop it, or document why it's retained.
- **`build_events`/`tool_invocations` duplication** — this plan's new observability work is the right moment to decide the consolidation the audit flagged as an open, growing maintenance surface (§5.2), rather than adding a third overlapping table later.
- **`docs/plan1.md`** — cited four times by `CLAUDE.md` as the architecture authority, confirmed by the audit to not exist. The audit's own recommendation — extract what's already been independently re-verified as accurate into that file, rather than writing it from scratch — is cheap and removes a real onboarding hazard.

### 9.6 Phased build plan
| Phase | Scope | Depends on |
|---|---|---|
| **9A — Cost attribution (near-zero-code)** | Turn on Bedrock granular cost attribution; add application inference profiles tagged by tenant/surface/feature | None — highest-leverage, lowest-effort phase in this document |
| **9B — CloudWatch alarms & budgets** | Composite alarms per Lambda BFF; AWS Budgets thresholds; closes the audit's #1 gap directly | None |
| **9C — Admin frontend + RBAC backend** | `admin.walkcroach.conquerorfoundation.com`, `lambda-admin`, distinct Cognito admin group | 9A, 9B (so there's real data to display on day one) |
| **9D — Follower-read dashboards** | Per-customer, per-surface, per-feature views using `AS OF SYSTEM TIME` queries | 9C |
| **9E — Token-level detail** | Converse `requestMetadata` + Glue ETL pipeline | 9A |
| **9F — OpenTelemetry rollout** | Tenant-tagged tracing across `lambda-agent`/`lambda-chrome`/`lambda-ide`/new `lambda-admin` | 9C |
| **9G — Bundled hardening** | IAM asymmetry fix, `agent_locks` resolution, `build_events`/`tool_invocations` consolidation decision, `docs/plan1.md` reconstruction | Can run in parallel with 9A–9F; same Terraform surface area |

### 9.7 Judging-criteria contribution
- **Production Readiness:** this section is a direct, one-to-one response to the criterion's own stated question — *"Is the design secure, observable, and scalable? ...what happens when things go wrong?"* — against an audit that today answers "not yet, in any of these dimensions."
- **Technical Implementation:** the follower-reads decision (§9.2) is a concrete example of using a CockroachDB-specific capability correctly rather than reaching for a generic pattern that happens to also work.
- **Creativity & Originality:** same follower-reads decision, viewed from the other criterion — it demonstrates the kind of "insight into what makes [the underlying technology] different" the criterion explicitly asks for.

---

## 10. Consolidated Sequencing Across Part 2

```
Chrome:   5A (bugs, blocking) ──> 5B (dead code) ──> 5E (store submission)
                              └──> 5C (brand) ──┐
                                   5D (sectors) ─┴─> depends on Part 1 §3B
                              └──> 5F (tests, parallel)

CLI:      6B (packaging) ── independent, start anytime
          6A (ergonomic parity) ── independent
          6C (scaffold+open) ── depends on Web's template definitions (read-only)
          6D (BYOK) ── shared work item with IDE 7C / Part 1 §4A

IDE:      7A (loop.ts tests) ── highest priority, no dependencies, widest blast radius
          7B (coverage gate) ── follows 7A's patterns
          7C (BYOK) ── shared with CLI 6D
          7D (Open VSX publish) ── independent, low effort
          7E (latency instrumentation) ── benefits from §9's alerting once live
          7F (stdio MCP review) ── stretch, schedule don't skip

Desktop:  no active phases — correct external claims only (§8.2, item 1)

Ops:      9A + 9B (near-zero-code, start immediately) ──> 9C ──> 9D, 9F
                                                       9A ──> 9E
                                                       9G runs in parallel throughout
```

### Cross-part priority call-outs
Two items in this two-part plan are flagged as genuinely time-sensitive above the rest, for different reasons:
1. **Part 1 §4A (BYOK for IDE/CLI)** — every day this doesn't ship, WalkCroach is paying for inference on its most feature-dense, fastest-growing surface, on a product the team has already decided should be free.
2. **§5A here (Chrome's two bugs)** — both are currently blocking real usage of a shipped, public-facing surface; nothing else in Chrome should be prioritized ahead of them.

Everything else in this document sequences behind those two without material risk to the rest of the plan.

---

## Final Judging-Criteria Cross-Reference (Both Parts)

| Criterion | Where this plan answers it most directly |
|---|---|
| **Agentic Memory Design** | Part 1 §1.3 (`creative_assets` embeddings), §2 (`video_jobs`), §3.3 (`workflow_runs`) — all new, real, embedded, recallable state extending the same memory graph, not toy tables |
| **Technical Implementation** | Part 1 §3.1 (closing the MCP stub using the IDE's own proven pattern); Part 2 §9.2 (CockroachDB follower reads instead of a generic read-replica); Part 2 §6.3 (CLI reusing Web's template definitions) |
| **Real-World Impact** | Part 1 §1 (Creative Studio), §2 (Video Studio), §3 (connectors) — all aimed squarely at what an SME actually does weekly, not a coding demo |
| **Production Readiness** | Part 2 §9 in full (the direct fix for the audit's largest gap); Part 2 §5.1 (two blocking bugs fixed before anything else); Part 1 §2.3 (explicit failure-state modeling in `video_jobs`) |
| **Creativity & Originality** | Part 1 §1.3 (a memory-aware creative tool, not a stateless generator); Part 2 §9.2 (CockroachDB-native follower reads as the admin-portal read strategy) |