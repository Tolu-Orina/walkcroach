# WalkCroach Master Doc — Implementation Status Across the Ecosystem

**Compiled:** 2026-07-29 · **Refreshed:** 2026-07-31  
**Method:** From-scratch code review of the monorepo (`walkcroach/`). Historical PRDs and deleted implementation plans are **not** sources of truth; when they conflict with this doc, prefer the code. Companion index: [`docs/README.md`](./README.md).

**Scope:** Four shipped surfaces sharing one CockroachDB memory layer — **Web**, **Chrome**, **IDE**, **CLI** — plus shared **agent-engine** (IDE/CLI), **agent-harness** (Lambda / Web+Chrome), and backend infra. **Desktop** (sibling `walkcroach-desktop/`) remains postponed scaffolding, not a fifth shipped surface.

---

## 0. Executive Summary

### 0.1 Status at a glance

| Surface | Maturity | One-line verdict |
|---|---|---|
| **Web** | **Substantially complete + Web Modules landed** | Builder/chat/deploy/RAG as before, plus creatives (Canvas/Reel/flyers/Office), connectors package, Stripe Checkout/Portal handlers, Bedrock guardrails, creative observability. Hard quotas and propose→confirm→execute are real. |
| **Chrome** | **Functional; CWS submit packet current at v0.5.3** | Side-panel copilot, linking, auth upgrade, selection capture, site profiles, connectors code (inert until OAuth secrets). Store checklist supersedes the old 0.1.4 packet — submission still the open ops gate. |
| **IDE extension** | **Complete, real product** | Chat, checkpoints, attachments, semantic search, HTTP MCP, shared skills, private VSIX (`ide/walkcroach-ide.vsix`). Open VSX publish workflow present. Stdio MCP **deferred**. |
| **CLI** | **Functional; packaging ready, not on npm yet** | Same engine as IDE. v0.2.0, browser **loopback** auth (RFC 8252; `--token` for CI), `bin` + `publishConfig` + `.github/workflows/publish-cli.yml` (OIDC). PKCE still a recommended follow-up. |
| **Shared agent-engine** | **Most mature module** | gather→act→verify, hard verify, adversarial review, checkpoints, hooks, tool-loop-guard. Has dedicated `loop.test.ts`. |
| **agent-harness** | **Mature, creative-heavy** | Web/Chrome Lambda loop (~2.9k lines `loop.ts`); creatives, connectors, guardrails, EMF metrics. **Still no dedicated `loop.test.ts`**. |
| **Desktop IDE** | **Postponed / scaffold only** | Sibling repo; docs archived under `docs/archive/`. Do not describe as shipped. |
| **Backend infra** | **Real; expanded Jul 30–31** | **25** CockroachDB migrations; Terraform modules include creative Lambda, video SFN (optional), guardrails, creative budget/dashboard. Soft spots remain (empty video worker ARN, pipeline IAM asymmetry, likely-orphaned `agent_locks`). |

### 0.2 What changed since the 2026-07-29 audit

| Area | Then | Now |
|---|---|---|
| Migrations | 19 (through `019_shared_skills`) | **25** (`020`–`025`: connectors, entitlements/quotas, creative assets, video jobs, creative memory/a11y, workflow runs + vector idx) |
| Terraform modules | ~8 | **+** `bedrock-guardrails`, `lambda-creative`, `stepfunctions-video`, `observability-creative` |
| Monitoring | Claimed “zero alarms/budgets” | **Creative** CloudWatch dashboard + Bedrock AWS Budget + SNS (`modules/observability-creative`) — still not full product-wide SLOs |
| Billing | “Portal deferred” UI copy | **Stripe Checkout + Customer Portal + webhooks** implemented (`handlers/stripeBilling.ts`); needs live secret keys |
| Creatives | Not in audit | Skills + harness tools + `lambda-creative` + quotas + moderation/guardrail |
| Chrome version | ~0.1.5 | **0.5.3** with refreshed store kit |
| CLI | No packaging story | Pack + `publish-cli.yml` (npm OIDC on `cli-v*` tags); **not necessarily published yet** |
| Docs | PRDs + many imp-plans + missing `plan1.md` | Living index in `docs/README.md`; PRDs/Desktop plan in `archive/`; finished imp-plans **removed**; entrypoints point here |

### 0.3 Cross-cutting truths (still accurate)

1. **One Cognito pool/client** and **one CockroachDB memory layer** across Web/Chrome/IDE/CLI — `source_surface`-tagged, cross-surface recall is real.
2. **Client-resume vs server-side tools** is locked: sandbox/local tools resume via `POST .../tool-result`; memory/search/etc. run in Lambda/harness.
3. **Web sandbox:** **E2B primary**, WebContainer fallback (needs COOP/COEP from `infra-web`).
4. **Test pattern:** client/engine coverage is stronger than Lambda BFF business-handler coverage; harness `loop.ts` still lacks a dedicated unit suite.
5. **Marketing claims** must lag secrets/wiring — see [`web-claims-audit.md`](./web-claims-audit.md) and Chrome store claim gating.

---

## 1. Web (`web/` + `lambda-agent` + `agent-harness` + `infra-web`)

### 1.1 Core product (unchanged in shape)

Onboarding templates, chat + builder modes, plan approve gate, checkpoints, visual edit, per-project DB + secrets proxy, GitHub push/pull, one-click deploy (CodeBuild), dashboard, RAG documents/chunks, code library / apps hub, personal chat (`kind='general'`). Credit ledger with atomic debits remains the metering backbone.

### 1.2 Web Modules (landed after Jul 29)

- **Agent Skills** — 17 skills under `skills/web/walkcroach-*` (image-gen, video-studio, flyer, pptx/docx/pdf/xlsx, connectors, quotas, brand, a11y, theme-factory, etc.). Loaded progressively via harness `load_skill`.
- **Creatives** — Nova Canvas / Reel / Pro paths; hard quotas (images ≤3/24h, video ≤1×≤30s/72h on paid); propose→confirm→execute; creative memory recall/save; marketing moderation (`creative-moderation.ts`) + optional creative Bedrock guardrail.
- **Connectors** — `@walkcroach/connectors` + migration `020`. Providers: `google_calendar`, `gmail`, `google_sheets`, `slack`, `stripe` (Connect read-only), `hubspot`. Tokens in Secrets Manager `walkcroach/{env}/connectors/*`. Stay inert until OAuth client secrets exist (same pattern as Chrome).
- **Billing** — `stripeBilling.ts`: Checkout, Customer Portal (`POST /billing/portal`), webhooks. **Do not confuse** platform Billing keys (`stripe_secret_key` / `stripe_price_id_paid`) with Connect OAuth keys (`stripe_oauth_client_*`). Catalogue: [`runtime-secrets-and-ssm.md`](./runtime-secrets-and-ssm.md).
- **Guardrails** — Chat PROMPT_ATTACK + creative topic/content (`modules/bedrock-guardrails`), wired into `lambda-agent`. Creative ApplyGuardrail path is effective when `CREATIVE_GUARDRAIL_ID` is set (Terraform sets it from the module).
- **Creative infra** — `lambda-creative` is **conditional** (`count = image_uri != "" ? 1 : 0`). Optional Step Functions video poller (**`video_worker_lambda_arn = ""` today** → SFN skipped; stub/inline/`VIDEO_STUDIO_STUB` path).
- **Observability** — EMF namespace `WalkCroach/Creative`; budget + dashboard module.

### 1.3 Architecture

```
Web SPA → API Gateway REST → lambda-agent → agent-harness (Bedrock + tools)
  → CockroachDB + S3 + Secrets Manager
  → lambda-creative (compose) / optional video SFN
```

### 1.4 Tests (approx., Jul 31)

| Area | ~`*.test.*` |
|---|---|
| `web/` | ~25 |
| `agent-harness/` | ~14 (creatives/connectors/guardrails/metrics; **no `loop.test.ts`**) |
| `lambda-agent` | ~11 |
| `lambda-creative` | ~2 (pytest) |

Large SPA pages and highest-stakes billing/deploy/video handlers remain thinner than engine coverage.

### 1.5 Gaps

- Wire video worker ARN + drop reliance on `VIDEO_STUDIO_STUB` for production video; set `creative_lambda_image_uri` so creative Lambda `count` is 1
- Claims/privacy sign-off table in `web-claims-audit.md` still open
- Generated-app end-user auth / custom domains still out of scope
- Full product monitoring beyond creative budget/dashboard (no Lambda error/latency alarms)
- Prefer `VITE_SANDBOX_RUNTIME=e2b` (default) over forcing WebContainer unless debugging isolation

---

## 2. Chrome (`chrome/` + `lambda-chrome`) — v0.5.3

### 2.1 Shipped

Side panel (not FAB), page/selection capture, summarize/ask/draft/save, recall, price track, workspaces, Cognito PKCE, anonymous device upgrade, Open in Web Chat handoff, site profiles (remote signing optional), store kit under `chrome/store/` (checklist **v0.5.3**), enterprise README.

### 2.2 Claim gating (store checklist)

Do **not** market until secrets/signing exist: Connectors (need Google OAuth secrets), remote site profiles (need public key + signed bundle), screenshot presigned PUT (needs bucket CORS for CWS ID).

### 2.3 Tests

~24 client/store-adjacent tests (permissions, extract, profiles, auth, etc.). Background + large sidepanel UI still light; `lambda-chrome` ~12 tests (uneven vs handler count).

### 2.4 Gaps

- Confirm CWS upload/review status; extension ID still “assigned on first upload”
- Keep listing claims behind the gating table
- Threat model: [`walkcroach-chrome-threat-model.md`](./walkcroach-chrome-threat-model.md)

---

## 3. IDE + CLI + agent-engine

### 3.1 agent-engine

Host-agnostic loop (`packages/agent-engine`). Phases A/B/C tools, HTTP MCP only, bundled + shared skills, checkpoints, attachments, local semantic index, BYOK helpers. **`loop.test.ts` + `loop.guardrails.test.ts` exist.** Stdio MCP: deferred — see [`walkcroach-stdio-mcp-security-review.md`](./walkcroach-stdio-mcp-security-review.md).

### 3.2 IDE (`ide/` v0.1.0)

Thin VS Code shell + webview; PKCE via Web `/connect/ide`; VSIX via `npm run package:vsix` (`ide/INSTALL.md`). Checked-in `ide/walkcroach-ide.vsix` (~1.4 MB). Publish: `.github/workflows/publish-ide.yml` → Open VSX. ~8 unit tests; coverage config still excludes largest UI files.

### 3.3 CLI (`cli/` v0.2.0)

Same engine; TUI / pipe / `--json`; approvals; BYOK; doctor. **Auth:** browser loopback listener (`cli/src/auth/loopback.ts`) binds the port before opening the browser; `--token` for CI. **PKCE** is explicitly the recommended follow-up (not implemented). Packaging: `test-packaged.mjs`, `publishConfig.access: public`, `.github/workflows/publish-cli.yml` (OIDC). `VERSIONING.md` / `POST_RELEASE.md` / `CHANGELOG.md`.

---

## 4. Desktop IDE (postponed)

Sibling `walkcroach-desktop/` exists beside this monorepo. Plans/PRDs live in [`docs/archive/`](./archive/). Core native agent / full fork compile were not a shipped product as of the Jul 29 audit; treat as **out of monorepo delivery scope** until revived.

---

## 5. Shared backend infrastructure

### 5.1 Documentation

This file + [`docs/README.md`](./README.md) replace the missing historical `plan1.md`. Locked architecture facts: CockroachDB as system of record; client-resume vs server-side tools; E2B-primary sandbox; single Cognito client.

### 5.2 Schema — 25 migrations

Applied via `@walkcroach/db` migrate. Newest:

| # | File | Theme |
|---|---|---|
| 020 | `connectors.sql` | Connector accounts / grants |
| 021 | `creative_entitlements_quotas.sql` | Paid entitlements + hard quotas |
| 022 | `creative_assets.sql` | Creative artefact metadata |
| 023 | `video_jobs.sql` | Nova Reel / compose job tracking |
| 024 | `creative_memory_a11y.sql` | Creative memory + a11y-related |
| 025 | `workflow_runs_vector_idx.sql` | Workflow runs + vector index work |

Earlier highlights (still true): RAG chunks (`016`), dual-write `build_events`/`tool_invocations` (`013`), shared skills (`019`), nullable `sessions.project_id` for general chat (`010`).

**Likely orphan:** `agent_locks` from `001` — no application writers found under infra-backend src in prior audit.

**Vector indexes:** present on core memory/document tables; confirm `025` covers remaining gaps (`page_captures` / `shared_skills` historically lagged).

### 5.3 Terraform modules (`infra-backend/modules/`)

`secrets`, `ssm`, `artefacts`, `apps-hosting`, `cognito`, `bedrock-guardrails`, `lambda-agent`, `lambda-chrome`, `lambda-ide`, `lambda-creative`, `stepfunctions-video`, `apigw-rest`, `observability-creative` (**13**).

Root `main.tf` wires creative guardrail IDs and `creative_lambda_*` into `lambda_agent`; video SFN ARN is empty until a worker is published. `lambda-creative` only provisions when `creative_lambda_image_uri` is non-empty.

### 5.4 Packages

`db`, `agent-harness` (~2,909-line `loop.ts`), `connectors`, `ledger`, `storage`. Creative container under `modules/lambda-creative`.

### 5.5 CI/CD + web hosting

`ci-cd/` CodePipeline stacks; `infra-web` depends on backend SSM API URL; COOP/COEP for WebContainer. Backend pipeline IAM still broader than web’s per-env hardening. **Also:** `lambda-agent` IAM still uses `resources = ["*"]` for some CodeBuild `StartBuild`/`BatchGetBuilds` calls — should scope to the apps-hosting project ARN. GitHub Actions: `publish-cli.yml`, `publish-ide.yml` (separate from CodePipeline).

### 5.6 Ops runbooks

- [`runtime-secrets-and-ssm.md`](./runtime-secrets-and-ssm.md)  
- [`smoke-and-redirects.md`](./smoke-and-redirects.md) — apply migrations **through 025** before prod creative/connector claims  

---

## 6. Skills (`skills/web/`)

Seventeen `walkcroach-*` skill directories + `NOTICE.md` (Apache vs proprietary). Research vendor clone removed; see [`research/README.md`](./research/README.md).

---

## 7. Risk / gap register (2026-07-31)

| # | Gap | Why it matters |
|---|---|---|
| 1 | Desktop not a shipped surface | Don’t market a fifth surface |
| 2 | `agent-harness` `loop.ts` (~2.9k lines) lacks dedicated unit tests | Widest blast radius for Web/Chrome |
| 3 | Lambda BFF handler tests still thin vs client/engine; no Lambda error/latency alarms | Money, merge, deploy, video + ops |
| 4 | Video SFN worker ARN empty / stub path; creative Lambda needs image URI | Production video/creative orchestration incomplete |
| 5 | Connectors/creatives “code complete” ≠ “user-reachable” without secrets | Claims must lag wiring |
| 6 | Dual Stripe config footgun (Connect OAuth vs platform Billing keys) | Wrong secret → silent inert Connect or broken Checkout |
| 7 | Chrome CWS submission / extension ID | Store packet ready; live listing not confirmed in-repo |
| 8 | CLI not confirmed published; PKCE still open | Workflow exists; loopback residual port-race risk without PKCE |
| 9 | Stdio MCP deferred | Correct security posture; don’t silently enable |
| 10 | `agent_locks` likely orphaned; `build_events`/`tool_invocations` dual-write | Schema hygiene |
| 11 | Backend pipeline IAM + CodeBuild `resources=["*"]` | Blast-radius inconsistency |
| 12 | Product-wide alarms/synthetics still thin | Creative budget ≠ full ops |
| 13 | Claims audit / privacy checkboxes unsigned | Release gate |

**Resolved vs Jul 29 doc:** missing `plan1.md` citations (entrypoints → this file / `docs/README.md`); “zero monitoring” (creative observability exists); “billing portal deferred” (handlers exist); “CLI paste-only auth / no publish pipeline” (loopback + `publish-cli.yml`); Desktop plan archived under `docs/archive/`.

---

## 8. Recommendations

1. Treat **this doc + package READMEs + store/ops runbooks** as the only living docs; keep `archive/` historical.
2. Before hackathon demo claims: finish secrets checklist, migrate **025**, smoke [`smoke-and-redirects.md`](./smoke-and-redirects.md), sign [`web-claims-audit.md`](./web-claims-audit.md).
3. Prioritize **harness `loop.ts` tests** and video worker wiring over new surface scope.
4. Publish CLI when `POST_RELEASE` gate is green; submit Chrome with claim gating respected.
5. Keep Desktop archived until electron-main/agent is real.

---

## 9. Doc map

| Living | Purpose |
|---|---|
| [`README.md`](./README.md) | Index |
| This file | Ecosystem status |
| `runtime-secrets-and-ssm.md`, `smoke-and-redirects.md` | Ops |
| `web-claims-audit.md`, `walkcroach-chrome-threat-model.md`, `walkcroach-stdio-mcp-security-review.md` | Security / claims |
| `color-system-research.md` | Design tokens |
| `archive/*` | Historical PRDs + Desktop plan |
