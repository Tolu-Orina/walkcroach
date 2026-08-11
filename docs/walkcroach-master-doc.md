# WalkCroach Master Doc — Ecosystem Status Across Six Surfaces

**Compiled:** 2026-08-07  
**Method:** From-scratch code review of `walkcroach/` and sibling `walkcroach-desktop/`. Package versions, Lambdas, Terraform, migrations, tests, and product overlays are the authority. Historical PRDs, archived plans, and older status markers are **not** sources of truth when they conflict with this doc.

**Epistemic labels used below:**
- **Verified** — observed in source, config, or package metadata in this review
- **Inferred** — reasoned from structure or comments; not directly proven live in prod
- **Assumed** — filled to keep the narrative coherent; call out before one-way decisions

**Companion (PM / BA / QA):** [`walkcroach-product-master-doc.md`](./walkcroach-product-master-doc.md) — same truth, product altitude.  
**Companion index:** [`docs/README.md`](./README.md) · Desktop detail: [`walkcroach-desktop.md`](./walkcroach-desktop.md) + `walkcroach-desktop/docs/{ARCHITECTURE,STATUS,SHIPPING}.md` · Living architecture constraints: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · ADRs under [`adr/`](./adr/)

---

## 0. Executive summary

WalkCroach is a multi-surface agentic platform whose differentiator is **one CockroachDB memory graph** shared across clients, not a single agent binary. Six product surfaces exist today. Two agent loops run them: a **cloud harness** (Web + Chrome + content workers) and a **host-local engine** (IDE + CLI + Desktop + sdk-host). The public SDK is a typed HTTP client for memory/content/keys — not a hosted coding agent.

| Surface | Repo path | Agent runtime | Package version (verified) | Maturity verdict |
|---|---|---|---|---|
| **Web** (App Builder + developer portal) | `walkcroach/web` | **agent-harness** via `lambda-agent` | `@walkcroach/web` **0.1.0** (private) | **Substantially complete** — richest product surface |
| **Browser Extension** (Chrome) | `walkcroach/chrome` | **agent-harness** via `lambda-chrome` | `@walkcroach/chrome` **0.6.1** | **Shipped** — store kit aligned to 0.6.1; CWS listing is an ops fact outside this tree |
| **IDE Extension** | `walkcroach/ide` | **agent-engine** + `/ide/v1` BFF | `walkcroach-ide` **0.2.0** | **Published path** — Open VSX workflow; VS Marketplace still commented out |
| **CLI** | `walkcroach/cli` | **agent-engine** | `@walkcroach/cli` **0.3.0** | **Published path** — npm OIDC publish workflow |
| **SDK** | `packages/sdk` (+ `sdk-mcp`, `sdk-host`) | No loop in SDK; content runs use **sdk-host → agent-engine** | sdk **0.2.0**, sdk-mcp **0.2.0**, sdk-host **0.1.0** | **Built and first-party-wired**; publish workflow for sdk + sdk-mcp; **sdk-host unpublished** |
| **Desktop IDE** | `walkcroach-desktop/` (sibling) | **agent-engine** via `desktop-agent` + Agent Host | Desktop parent **0.1.0**; upstream pin **1.131.0** | **Production-grade** (parity with IDE/CLI); **unsigned preview** distribution only |

**Shared modules (not surfaces):** `@walkcroach/agent-engine` (private), `@walkcroach/agent-harness` (under `infra-backend/packages/`), `@walkcroach/db` (37 migrations), `@walkcroach/connectors`, `@walkcroach/ledger`, `@walkcroach/storage`, `@walkcroach/memory-contracts`, `@walkcroach/templates`, `@walkcroach/agent-protocol`.

### 0.1 What this doc overturns from earlier audits

| Older claim | Code reality (2026-08-07) |
|---|---|
| Migrations stop at 032 | **037** — API keys, retention TTL, image budget, agent runs, memory governance |
| First-party surfaces do not import `@walkcroach/sdk` | **They do** — web/chrome `WalkCroach` client; ide/cli/desktop `createHostMemoryBridge` |
| SDK agent path “never executed” / no publish story | Content/runs handlers + `sdk-host` exist; **publish-sdk.yml** tags `sdk-v*` / `sdk-mcp-v*`. Live-prod golden remains **env-gated** |
| No developer portal | Web routes `/app/developer/*` (overview, keys, ops, governance, docs) |
| Chrome ~0.5.x / “submission gate” as primary story | Package + store kit **0.6.1**; treat CWS live status as ops, not code |
| Desktop “scaffold / never compiled” | Native Agent Host + Path B fleet + live CRDB/MCP when configured; **production-grade**; unsigned preview packaging |
| agent-engine MCP is HTTP-only / stdio forever deferred | Engine supports **HTTP + host-gated stdio**; harness and sdk-mcp remain HTTP-only |
| Empty monitoring | **observability-memory** + **observability-creative** modules exist; platform-wide Lambda SLOs still incomplete |

### 0.2 Cross-cutting truths (still locked)

1. **One Cognito pool/client family** and **one CockroachDB memory layer** across surfaces — writes carry `source_surface` (`web` \| `chrome` \| `ide` \| `cli` \| `sdk` \| `desktop`).
2. **Two agent loops on purpose** — do not merge harness and engine without hitting the quantified revisit trigger in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
3. **Propose → confirm → execute** for mutate / spend / third-party (and for production-touching platform changes).
4. **Never delete memory rows for belief change** — mark `superseded_by`; governance erase uses **tombstones** (ADR-0002).
5. **Client-resume vs server-side tools** on the cloud path: sandbox/local tools resume via tool-result; memory/search/creatives/connectors run in Lambda/harness.
6. **Web sandbox:** E2B primary; WebContainer remains a client fallback (needs COOP/COEP from `infra-web`).
7. **Desktop:** Open VSX only — **never** proxy the Microsoft Marketplace.
8. **Public API hostname (prod):** `api.walkcroach.rinegansolutions.com` — do not invent `*.walkcroach.dev` as owned API (see `ARCHITECTURE.md`).

### 0.3 Assumptions this audit was written against

- Nested `walkcroach-desktop/vscode/` may be present on a local build machine but is **gitignored by the parent** — Desktop completeness is judged from contrib/packages/product + STATUS, not from whether a zip exists in this workspace.
- Whether creative ECR/`latest` and CWS listing are live in production **right now** is **inferred** from `prod.tfvars` / store kit, not from a live AWS/CWS probe in this pass.
- npm registry “currently published” versions were **not** re-queried remotely; maturity for CLI/IDE/SDK uses **in-repo version + publish workflow** as the packaging signal.

---

## 1. System topology

### 1.1 C4-style context (question: what talks to what?)

```text
                    ┌─────────────────────────────────────────┐
                    │         Cognito (shared pool)            │
                    └───────────────┬─────────────────────────┘
                                    │ JWT / device / PKCE / API keys
     ┌──────────┐  ┌──────────┐  ┌──▼───────┐  ┌─────┐  ┌────────┐
     │   Web    │  │  Chrome  │  │ IDE / CLI │  │ SDK │  │Desktop │
     │ SPA+portal│ │  MV3     │  │ extension │  │npm  │  │ Code OSS│
     └────┬─────┘  └────┬─────┘  └─────┬─────┘  └──┬──┘  └───┬────┘
          │             │              │            │         │
          ▼             ▼              ▼            ▼         ▼
     lambda-agent  lambda-chrome   lambda-ide ◄────┘    /ide + engine
          │             │              │                  (local loop)
          └──────┬──────┘              │
                 ▼                     ▼
          agent-harness          /v1 memory|content|keys|runs
                 │                     │
                 └──────────┬──────────┘
                            ▼
                 CockroachDB (memory + product schema)
                            │
              Bedrock · S3 · Secrets · E2B · Stripe · connectors
```

### 1.2 Dual agent loops (verified)

| Loop | Package | Used by | Character |
|---|---|---|---|
| **Cloud / creative** | `@walkcroach/agent-harness` (`infra-backend/packages/agent-harness`) | Web, Chrome, content-publish workers | Multi-tenant Bedrock, CRDB-native memory, creatives, E2B, connectors; `loop.ts` ~**2,915** lines; modes `plan` \| `build` \| `chat` \| `project_chat` |
| **Coding / host-local** | `@walkcroach/agent-engine` (`packages/agent-engine`, **private**) | IDE, CLI, Desktop (`desktop-agent`), `sdk-host` | `HostAdapter` + `runAgentLoop`; phases gather→act→verify; BYOK Bedrock; worktrees; checkpoints; HTTP MCP + **host-gated stdio MCP** |

**Do not** describe WalkCroach as having one agent runtime. Empty `packages/agent-harness/` at repo root is a **dead placeholder** — ignore it.

Convergence is via **contracts**, not one binary:

| Contract | Owns |
|---|---|
| `@walkcroach/memory-contracts` | Memory kinds, export envelope, supersede / remember result shapes |
| `@walkcroach/sdk` + OpenAPI `/v1` | Public HTTP memory/content/keys |
| `@walkcroach/agent-protocol` | Desktop agent-ui ↔ workbench protocol (`PROTOCOL_VERSION`; ADR-0003 targets v3) |

### 1.3 Repo layout (verified)

**Monorepo `walkcroach/` — no root npm workspace.** Surfaces install separately; `infra-backend/` uses its own workspaces.

| Path | Role |
|---|---|
| `web/` | App Builder SPA + developer portal |
| `chrome/` | MV3 extension (WXT) |
| `ide/` | VS Code / Open VSX extension |
| `cli/` | npm CLI |
| `packages/` | sdk, sdk-mcp, sdk-host, agent-engine, memory-contracts, templates, agent-protocol |
| `infra-backend/` | Terraform, Lambdas, db/harness/connectors/ledger/storage |
| `infra-web/` | S3/CloudFront web hosting + `desktop-releases` |
| `ci-cd/` | CodePipeline stacks |
| `skills/` | Runtime web skills + EA / agentic-ide skill trees |
| `tests/` | Cross-surface integration + Playwright |
| `.github/workflows/` | **Publish only** (`publish-cli`, `publish-ide`, `publish-chrome`, `publish-sdk`) |

**Sibling `walkcroach-desktop/`** — Code OSS fork overlay, packages, packaging scripts; nested `vscode/` gitignored by parent.

---

## 2. Shared memory & data plane

### 2.1 CockroachDB as system of record

- Migrations live in `infra-backend/packages/db/migrations/` — **001–037** (verified).
- Vector recall uses **tenant-prefixed**, **cosine** (`<=>` / `vector_cosine_ops`) indexes rebuilt across migrations **026–032** after earlier unprefixed/L2 indexes proved unusable for filtered queries.
- Writes supersede near-duplicate same-kind entries (`MEMORY_SUPERSEDE_THRESHOLD`); recall overfetches then filters (`RECALL_OVERFETCH`).
- TLS verification is on by default in the DB client; `CRDB_SSL_INSECURE` is an explicit loud opt-out. SQLSTATE **40001** retries with full-jitter backoff on `query` / `withTransaction`.

### 2.2 Migrations since the Jul 31 doc (033–037)

| # | File | Theme |
|---|---|---|
| 033 | `033_api_keys.sql` | API keys — prefix + scrypt hash/salt, scopes, revoke (no raw secret stored) |
| 034 | `034_memory_retention.sql` | `memory_entries` zone `gc.ttlseconds = 90000` (~**25h** MVCC asOf window) |
| 035 | `035_api_key_image_budget.sql` | Per-key image daily limit + usage table |
| 036 | `036_agent_runs.sql` | Async `agent_runs` for content.publish / agent.run (idempotency, lease) |
| 037 | `037_memory_governance.sql` | Actor columns, erase tombstones, `memory_audit` |

Earlier still load-bearing: connectors (020), creative quotas/assets/video (021–023), shared skills (019), RAG chunks (016), dual-write tool invocations (013), nullable `sessions.project_id` for general chat (010), PKCE on auth codes (030).

**Likely orphan (still):** `agent_locks` from `001` — no application writers found under infra-backend src in prior audits (**inferred** still true unless a new writer appeared; re-grep before dropping).

### 2.3 Retention honesty (ADR-0001)

Point-in-time `asOf` / `diff` is **MVCC**, bounded by ~25h GC TTL. Enterprise governance (audit + erase) is **application-level**, not multi-year asOf. **Do not market multi-year time travel** until a bi-temporal ADR lands. Health (`/v1/sdk-health`) must advertise the window honestly.

### 2.4 Public `/v1` API (lambda-ide)

Verified routes in `handlers/sdk.ts` / contract:

| Area | Capabilities |
|---|---|
| Health | `GET /health`, `GET /sdk-health` (unauthenticated) |
| Memory | remember/list/recall/asOf/diff/export/import/erase/audit |
| Content | `POST /content/publish` → run handle |
| Runs | get / resume / cancel |
| Keys | create / list / revoke / usage (user JWT only; API keys cannot mint keys) |

Auth: Cognito Bearer **or** `wc_live_…` API keys with scopes.

---

## 3. Surface: Web (`web/` + `lambda-agent` + harness)

### 3.1 Purpose

Hosted App Builder and primary account surface: projects, chat, builder sandbox, creatives, connectors, billing, GitHub, deploy, and the **in-app developer portal**.

### 3.2 Implemented (verified)

- **Auth:** Cognito `USER_PASSWORD_AUTH`; anonymous try path; `/connect/{ide,cli,chrome}` handoffs with PKCE.
- **Product:** onboarding/templates, chat + builder, plan approve gate, checkpoints, visual edit, per-project secrets proxy, GitHub push/pull, CodeBuild deploy, RAG documents, apps/code library, personal chat (`kind='general'`).
- **Creatives:** Nova image / PPTX / flyer / video paths via harness + optional `lambda-creative`; hard quotas (images ≤3/24h, video ≤1×≤30s/72h on paid patterns); propose→confirm→execute; creative memory; moderation + Bedrock guardrails when wired.
- **Connectors:** `@walkcroach/connectors` — Google Calendar/Gmail/Sheets, Slack, Stripe Connect (read-only), HubSpot (still marked coming soon in places). Tokens in Secrets Manager; **inert until OAuth client secrets exist**.
- **Billing:** Stripe Checkout, Customer Portal, webhooks (`stripeBilling.ts`); credit ledger (`@walkcroach/ledger`) with transactional debits.
- **Sandbox:** prefer E2B; WebContainer fallback in client.
- **Developer portal:** `/app/developer` — overview, keys, ops, governance, docs (quickstart uses `@walkcroach/sdk`).
- **SDK client:** `web/src/api/sdkClient.ts` imports `WalkCroach`.

Routes of record: `web/src/app/AppRoutes.tsx`.

### 3.3 Infra notes

- `prod.tfvars`: `creative_lambda_enabled = true`, `creative_lambda_image_tag = "latest"` — **wiring intent verified**; live ECR image presence **inferred**.
- Creative Lambda historically needed a **two-pass** Terraform bootstrap when renaming ECR repos (documented in tfvars).
- Video Step Functions still depends on creative worker ARN being real; stub/inline/`VIDEO_STUDIO_STUB` paths remain in code for unset wiring (**verified** in module/handler comments).

### 3.4 Tests

~**25** web test files. Stronger on auth/templates/sdk client than on large SPA pages and highest-stakes billing/deploy handlers.

### 3.5 Gaps

- Plugins / Apps Hub still “coming soon” in UI.
- Some connectors UI gated as coming soon; HubSpot incomplete.
- Claims/privacy sign-off in `web-claims-audit.md` still an ops gate.
- Generated-app end-user auth / custom domains still out of product scope.
- Full product Lambda error/latency alarms beyond memory/creative modules.

---

## 4. Surface: Browser Extension (`chrome/` + `lambda-chrome`)

### 4.1 Purpose

Manifest V3 side-panel SME copilot: page/selection capture, summarize/ask/draft/save, recall into shared memory, workspaces, price track, connectors, credits, handoff to Web.

### 4.2 Version & shipping

- Package + store kit: **0.6.1** (aligned — verified).
- Publish workflow: `.github/workflows/publish-chrome.yml` (`chrome-v*` tags).
- CWS “approved/live” is an **external** fact; do not treat git as proof of store state.

### 4.3 Implemented (verified)

- Side panel (not FAB), extractors, background messaging, selection capture.
- Auth: device-token try-first → Cognito upgrade; PKCE via `launchWebAuthFlow` / web handoff.
- Streaming to **lambda-chrome** (harness-backed recall/propose/LLM streams).
- SDK client for memory (`chrome/lib/sdkClient.ts`).
- Site profiles (remote signing optional), store kit under `chrome/store/`, enterprise policy docs under `chrome/enterprise/`.

### 4.4 Claim gating (still true)

Do **not** market until secrets/signing exist: Connectors (Google OAuth secrets), remote site profiles (public key + signed bundle), screenshot presigned PUT (bucket CORS for CWS ID).

### 4.5 Tests

~**26** client/store-adjacent tests; `lambda-chrome` ~**12** handler/integration tests. Background + largest sidepanel surfaces remain thinner than lib coverage.

### 4.6 Gaps

- Keep listing claims behind the gating table.
- Threat model: [`walkcroach-chrome-threat-model.md`](./walkcroach-chrome-threat-model.md).
- Enterprise folder is policy documentation, not a separate runtime product.

---

## 5. Surface: IDE Extension (`ide/`)

### 5.1 Purpose

VS Code / Cursor-compatible extension: local **agent-engine** coding loop in a webview shell, with cloud project link and memory via **lambda-ide** (`/ide/v1` + SDK bridge).

### 5.2 Version & shipping

- `walkcroach-ide` **0.2.0**.
- Publish: `.github/workflows/publish-ide.yml` → **Open VSX**; `vsce` / VS Marketplace step remains **commented out**.
- Packaging: `npm run package:vsix` / `ide/INSTALL.md`.

### 5.3 Implemented (verified)

- Sign-in: Cognito Hosted UI + PKCE; paste-token fallback.
- `VsCodeHostAdapter` — FS/terminal/approvals/session; BYOK Bedrock.
- Memory via `createHostMemoryBridge` from `@walkcroach/sdk`.
- Checkpoints, attachments, skills, HTTP Cockroach MCP config, latency helpers.

### 5.4 Tests

~**8** unit tests — thinnest of the four published/publishable client surfaces. Coverage historically excludes largest UI files.

### 5.5 Gaps

- Marketplace publish still not enabled in workflow.
- Capability drift risk vs Desktop’s `DesktopHostAdapter` (parallel hosts, not shared import).
- Stdio MCP remains **host-gated / security-sensitive** — see [`walkcroach-stdio-mcp-security-review.md`](./walkcroach-stdio-mcp-security-review.md); do not silently broaden.

---

## 6. Surface: CLI (`cli/`)

### 6.1 Purpose

Same local engine as IDE; Ink TUI / pipe / `--json`; approvals; BYOK; doctor; memory/skills/mcp/secrets commands for terminal-native workflows.

### 6.2 Version & shipping

- `@walkcroach/cli` **0.3.0**, `publishConfig.access: public`.
- Publish: `.github/workflows/publish-cli.yml` (OIDC on `cli-v*` tags).
- Packaging/version docs: `VERSIONING.md`, `POST_RELEASE.md`, `CHANGELOG.md` (package-local).

### 6.3 Implemented (verified)

- Auth: browser **loopback** (RFC 8252) binds port before open; PKCE S256 verifier in memory; `--token` for CI.
- Commands: `run`, `auth`, `link`, `create`, `revert`, `memory`, `skills`, `mcp`, `secrets`.
- Bundles agent-engine + sdk bridge + templates at build.
- Surface/packaging contract tests.

### 6.4 Tests

~**21** test files — strong for a 0.3 CLI (auth, approvals, packaging, surface contract).

### 6.5 Gaps

- Some cloud diagnostics couple to IDE BFF health (**inferred** from doctor/health helpers).
- Production secret profile should fail closed without OS keychain when ADR-0003 bar is enforced end-to-end — verify host wiring before claiming.

---

## 7. Surface: SDK (`packages/sdk*`)

### 7.1 What the SDK is (and is not)

| Package | Version | Public publish? | Role |
|---|---|---|---|
| `@walkcroach/sdk` | 0.2.0 | **Yes** (`sdk-v*`) | Typed client: `memory`, `content`, `keys`, `health` |
| `@walkcroach/sdk-mcp` | 0.2.0 | **Yes** (`sdk-mcp-v*`) | MCP HTTP server over SDK — memory tools only |
| `@walkcroach/sdk-host` | 0.1.0 | **No** | `SandboxHostAdapter` + `runProgrammatic` → **private agent-engine** |
| `@walkcroach/memory-contracts` | 0.1.0 | **No** (vendored into SDK build) | Shared kinds / export / supersede |

**The SDK is not an agent loop.** Coding agents for third parties, if ever productised, should be a separate deliberate package — not a re-export of every `agent-engine` symbol ([`ARCHITECTURE.md`](./ARCHITECTURE.md), sdk-platform guidance).

### 7.2 Memory API (verified)

`remember`, `recall`, `list`, `asOf`, `diff`, `export`, `import`, `erase`, `audit` — plus `createHostMemoryBridge` for first-party hosts.

### 7.3 Content / runs (verified)

`content.publish` → `RunHandle` with `poll` / `wait` / `resume` / `cancel`. Interrupt kinds live in `packages/sdk/src/interrupt.ts`. Durable runs table: migration **036**.

### 7.4 First-party adoption (verified — major change vs older docs)

| Surface | Import |
|---|---|
| Web | `WalkCroach` via `sdkClient.ts` |
| Chrome | `WalkCroach` via `sdkClient.ts` |
| IDE | `createHostMemoryBridge` via `ideClient.ts` |
| CLI | `createHostMemoryBridge` via `lib/api.ts` |
| Desktop | `createHostMemoryBridge` via `desktop-agent` `ideClient.ts` |

Agent **turns** on Web/Chrome still stream through harness; capture→project mirror remains server-side in lambda-chrome where applicable.

### 7.5 Proof level (honest)

| Layer | Status |
|---|---|
| Unit tests | Mock `fetch` — not live |
| lambda-ide contracts | In-process + CRDB suites that **skip** without `CRDB_CONNECTION_STRING` |
| Deployed golden | `tests/integration/cross-surface-golden.integration.test.ts` — live only when `WALKCROACH_API_URL` + `ALLOW_DEV_AUTH` |

Do **not** claim continuous live-prod proof without env evidence. Do claim: the seams are implemented, first-party-wired, and contract-tested.

### 7.6 Gaps

- `sdk-host` unpublished (depends on private engine).
- External developer GTM still thin vs in-app portal (usage metering UX, Stripe Meters for API keys — extend ledger when opening fully).
- sdk-mcp: memory tools only; no agent-run MCP tools.

---

## 8. Surface: Desktop IDE (`walkcroach-desktop/`)

Living truth in the Desktop repo: `docs/STATUS.md`, `ARCHITECTURE.md`, `SHIPPING.md`. Monorepo pointer: [`walkcroach-desktop.md`](./walkcroach-desktop.md).

### 8.1 What it is

A **Code OSS / VS Code fork**, not an Electron shell around the IDE extension.

| Field | Value (verified in `product/product.walkcroach.json`) |
|---|---|
| Upstream tag | **1.131.0** @ `3a03d6f72d628a7741c29f456b4ddbb5ae68502c` |
| Electron | **42.7.0** |
| Node (build) | **24.18.0** |
| Quality | `insider` |
| Phase marker | `D6` |
| Gallery | Open VSX only; `marketplaceProxy: false`; telemetry off |
| Crash endpoint | `""` (empty) |
| Interim distribution | unsigned Windows portable / Setup.exe |

### 8.2 Architecture (Path B)

```text
agent-ui / settings-ui (webview IIFEs)
  → WalkCroachAgentService / AgentBridge (contrib)
  → Agent Host Protocol
  → WalkCroachAgent (platform/agentHost/node/walkcroach)
  → @walkcroach/desktop-agent (dist/ or engine-bundle.cjs)
  → DesktopHostAdapter + @walkcroach/agent-engine
```

- **Path B:** custom Agents Window + fleet (soft cap **6** + force). Microsoft Agents Window / stock Chat stay suppressed (`chat.agent.enabled: false`).
- Fork edits deny-by-default via `product/surface-area-allowlist.txt` + `scripts/audit-surface-area.mjs`.
- Renderer never imports agent-engine; Agent Host provider never imports `workbench/`.

### 8.3 Implemented vs demo (ruthless)

| Area | State |
|---|---|
| Chat / Plan / Agent → Bedrock | **Works** when Bedrock key present |
| Approvals / ask-user | **Works** (see fleet fan-out risk) |
| Fleet tabs/grid ≤6 + force | **Works** |
| Worktree isolation via engine tools | **Works** when model invokes tools |
| Settings editor | **Works** |
| Online project memory (`source_surface=desktop`) | **Works** when Cognito + project linked |
| Theme / branding / Open VSX audits | **Works** |
| Unsigned Windows zip + SFX scripts | **Tooling exists** |
| CRDB Schema / Query / ccloud panels | **Demo fixtures** |
| Skills aux | **Demo** |
| Durable offline memory buffer | **Code present, unwired** |
| Secrets on disk | **Plaintext JSON** in practice (encrypt hooks unused) |
| Diff commentary UI | **Stub** |
| PKCE Hosted UI completion | **Paste-token** paths remain |
| Auto-update / code signing | **Deferred** (`signed-release` CI `if: false`) |
| Full gulp package in GitHub Actions | **Does not** — nested `vscode/` absent from parent git |

### 8.4 Risks (code-backed)

1. Approval resolve can fan out across engine sessions in the Agent Host path (STATUS) — ADR-0003 demands session-scoped routing; treat Desktop as **not fully caught up** until verified fixed.
2. Protocol drift: contrib still hand-mirrors types; `agent-ui` now re-exports `@walkcroach/agent-protocol`.
3. Upstream sync workflow historically clones an older tag than the product pin (**1.129.0** vs **1.131.0**) — re-verify workflow before relying on CI sync.
4. Nested `vscode/` untracked by parent — reproducibility / Release hygiene risk.
5. Double `onEvent` callback pattern into session start paths.

### 8.5 External language

Use **“production-grade WalkCroach Desktop IDE on an unsigned preview channel”** — not “dogfood,” not “incomplete relative to IDE/CLI,” not “signed,” not “auto-updating.”

---

## 9. Shared agent-engine & agent-harness

### 9.1 agent-engine (most mature coding module)

- Phases: **gather → act → verify**; hard verify; adversarial review; checkpoints; hooks; tool-loop-guard.
- Tool bands: Phase A (FS/search/terminal/worktree/verify/todos/ask_user/…), Phase B (`cockroach_mcp`, `mcp_call`, `load_skill`, `ccloud`), Phase C (project memory recall/mirror + shared skills).
- ~**36** test files including `loop.test.ts`, `loop.guardrails.test.ts`, security evals.
- ADR-0003 production bar: uniform dispatch, session-scoped approvals API, telemetry sink, refuse-plaintext in production profiles, sdk-host budgets.

### 9.2 agent-harness (cloud)

- Modes and client-resume vs server tools; creatives; connectors; E2B sandbox; memory metrics EMF (`WalkCroach/Memory`).
- ~**24** harness test files including dedicated `loop.test.ts`.
- MCP: Streamable HTTP to Cockroach Managed MCP only (no stdio).

### 9.3 Revisit trigger — merge loops? (from ARCHITECTURE.md)

Revisit engine↔harness merge only if, in a single quarter:

- **≥3** dual-fix defects on the same memory/tool semantic, or
- **≥500** net LOC changed in both loops for the same semantic change set.

Until measured and recorded: **forever-dual with contracts**.

---

## 10. Backend infrastructure

### 10.1 Lambdas (verified)

| Lambda | Role |
|---|---|
| `lambda-agent` | Web BFF — projects/sessions/memory/billing/creative/video/connectors/github/sandbox/deploy/apps/streaming prompt |
| `lambda-chrome` | Extension BFF — device auth, streams, workspaces, captures, screenshot, price-track, connectors, credits, handoff, site profiles |
| `lambda-ide` | IDE/CLI/Desktop BFF **and** public `/v1` SDK API |
| `lambda-creative` | Python container — PPTX/flyer/video compose / skill scripts (gated by image enablement) |

Shared API Gateway: `modules/apigw-rest`. Cognito authorizer on in prod (`allow_dev_auth = false`).

### 10.2 Terraform modules

**infra-backend:** secrets, artefacts, apps-hosting, cognito, bedrock-guardrails, lambda-agent, lambda-chrome, lambda-ide, lambda-creative, stepfunctions-video, apigw-rest, ssm, observability-creative, observability-memory.

**infra-web:** s3, acm (optional), cloudfront, dns (optional), **desktop-releases**.

### 10.3 Observability (verified)

| Module | What exists |
|---|---|
| `observability-memory` | EMF `WalkCroach/Memory`; alarms EmbedFailure / sustained RecallEmpty / p95 RecallLatency; dashboard; SNS |
| `observability-creative` | EMF `WalkCroach/Creative`; Bedrock AWS Budget; dashboard; SNS — fewer metric alarms than memory |

**Still missing:** platform-wide Lambda error/latency alarms and synthetics across all BFFs.

### 10.4 Packages under infra-backend

| Package | Notes |
|---|---|
| `db` | Migrations + client |
| `agent-harness` | Cloud loop |
| `connectors` | OAuth + execute |
| `ledger` | Credits / Stripe meter helpers |
| `storage` | S3 helpers — **no tests** observed |

### 10.5 CI/CD

- Day-to-day: CodePipeline via `ci-cd/` + per-package `buildspec.yml`.
- GitHub Actions: publish workflows only (cli, ide, chrome, sdk).
- Soft spots: backend pipeline IAM historically broader than web; some CodeBuild `resources = ["*"]` on agent Lambda — re-check current TF before claiming fixed.

### 10.6 Ops runbooks

- [`runtime-secrets-and-ssm.md`](./runtime-secrets-and-ssm.md)
- [`smoke-and-redirects.md`](./smoke-and-redirects.md) — apply migrations **through 037** before claiming API-key / governance / retention behaviour. Vector index rebuild pairs (`026`–`032`) must not stop mid-pair.

---

## 11. Skills

### 11.1 Runtime (`skills/web/`)

Agent skills loaded progressively via harness `load_skill`. Includes creative (image, video, flyer, pptx, a11y, philosophy), quota/credits, connectors, model-routing, docx/xlsx/pdf, theme-factory, brand, frontend-design suite (+ extras mirrors), and vendor Apache-licensed adaptations. See `skills/web/NOTICE.md`.

### 11.2 Meta skill trees

- `skills/EA/` — enterprise architecture references (platform context, SDK packaging, agentic systems).
- `skills/agentic-ide/` — Desktop/IDE fork design references.

These are authoring/ops skills for the team, not end-user product features.

---

## 12. Auth matrix

| Surface | Primary mechanism |
|---|---|
| Web | Cognito USER_PASSWORD_AUTH; anonymous try; mints PKCE handoffs |
| Chrome | Device token → Cognito upgrade; PKCE web auth flow |
| IDE | Cognito Hosted UI + PKCE; paste-token fallback |
| CLI | Web handoff + PKCE loopback; refresh tokens |
| Desktop | Paste-token / Hosted UI incomplete; AHP Cognito protected-resources path disabled |
| SDK / automation | `wc_live_…` API keys (scrypt-hashed server-side) **or** access token; keys cannot mint keys |

---

## 13. Billing & entitlements

- **End-user credits:** `@walkcroach/ledger` + Stripe Checkout/Portal/webhooks on lambda-agent.
- **Hard quotas:** separate from credits (creative image/video windows).
- **API-key image budget:** migration 035 — safety rail, not full developer metering product.
- **Footgun:** platform Billing keys (`stripe_secret_key` / price IDs) ≠ Connect OAuth keys (`stripe_oauth_client_*`). Wrong secret → silent inert Connect or broken Checkout.

---

## 14. Test coverage signals (file counts, not %)

Approximate `*.test.ts(x)` inventories from this review:

| Area | ~Test files |
|---|---|
| web | 25 |
| chrome | 26 |
| cli | 21 |
| ide | 8 |
| agent-engine | 36 |
| agent-harness | 24 |
| sdk (+ related) | 6+ in sdk alone |
| lambda-agent | 11 |
| lambda-chrome | 12 |
| lambda-ide | 9 |
| storage | **0** |
| Desktop agent-ui | **0** unit tests |
| Desktop desktop-agent | Vitest suites present (adapter/durable/fleet logic) |

**Pattern:** engine/harness/CLI/Chrome lib coverage is strongest; IDE UI, storage, creative Python, and Desktop webview tests are thinnest. Highest-stakes money/deploy handlers still lag engine maturity.

---

## 15. Risk / gap register (2026-08-07)

| # | Gap | Why it matters | Status |
|---|---|---|---|
| 1 | Desktop unsigned preview ≠ signed installer | SmartScreen, trust, auto-update | Open — product-grade; signing deferred |
| 2 | Desktop skills aux still demo content | Easy to overclaim skills UI | Open (CRDB panels are live when configured) |
| 3 | Desktop approval / secrets hardening debt | Fleet safety + credential risk | Track vs ADR-0003 bar |
| 4 | Live SDK/agent golden env-gated | “Works in prod” needs evidence | Open as continuous proof |
| 5 | Connectors/creatives code-complete ≠ user-reachable without secrets | Marketing must lag wiring | Open |
| 6 | Dual Stripe config footgun | Silent breakage | Open (docs + discipline) |
| 7 | Video SFN / stub paths if worker unset | Production video reliability | Re-verify ARN wiring |
| 8 | Stdio MCP security surface | Host compromise class | Deferred / gated — correct posture |
| 9 | `agent_locks` likely orphan; dual-write hygiene | Schema noise | Open |
| 10 | Backend IAM / CodeBuild `*` resources | Blast radius | Re-verify TF |
| 11 | Lambda error/latency alarms incomplete | Ops blind spots | Partial (memory/creative only) |
| 12 | Claims audit / privacy checkboxes | Release gate | Open |
| 13 | `MEMORY_SUPERSEDE_THRESHOLD` judgement | Lexically distant contradictions accumulate | Needs eval data to widen |
| 14 | Empty root `packages/agent-harness/` | Confuses layout docs | Cosmetic debt |
| 15 | Upstream Desktop sync CI pin skew | Fork maintenance | Open |
| 16 | IDE Marketplace publish commented out | Distribution reach | Intentional so far |
| 17 | `@walkcroach/storage` untested | Regressions silent | Open |

### Closed relative to Jul 29–31 master doc

| Was | Now |
|---|---|
| Unusable vector indexes (no tenant prefix + L2 vs cosine) | Rebuilt 026–032; cosine + filter-aware |
| Unverified TLS / no 40001 retry / non-atomic debit & upgrade | Fixed in db client + ledger/upgrade paths |
| `superseded_by` read-only | Write path retires near duplicates |
| Zero memory observability | EMF + alarms + dashboard |
| No harness `loop.ts` tests | `loop.test.ts` landed |
| CLI no publish / paste-only auth | Loopback + PKCE + publish-cli |
| Chrome pre-store chaos | 0.6.x store kit + publish-chrome |
| SDK “strategy only” / no first-party imports | First-party imports + developer portal + publish-sdk |
| No API keys / governance schema | Migrations 033–037 + ADRs 0001–0003 |

---

## 16. Locked decisions & superseded notes

### Locked (do not silently reopen)

| Decision | Breaks if ignored |
|---|---|
| CockroachDB sole system of record | Local-only durable state per surface |
| Never delete for belief change — supersede (+ tombstone erase) | Provenance / legal story |
| Propose → confirm → execute | Trust / spend / third-party |
| Dual loops; converge on contracts | Forced merge under schedule pressure |
| Web apps: opinionated React/TS/Vite/Tailwind | Generation variance |
| Secrets never plaintext in WebContainer/client | Tenant compromise |
| Desktop: Open VSX only, no Marketplace proxy | Cursor Apr 2025 class of failure |
| IDE/CLI/Desktop inference: BYOK for coding loop | Unbounded platform cost |
| Public API keys server-side only (`allowBrowserApiKey` opt-in) | Browser secret exfil |
| Do not publish `agent-engine` without an explicit product decision | Support + stability trap |

### Superseded (keep for trail)

| Was | Now |
|---|---|
| Desktop UI must be native ViewPane only (React “reverted”) | Product agent/settings UI is **React webview**; core chrome still binds `--vscode-*` |
| Desktop scaffold / never compiled | Preview path works; unsigned packaging tooling exists |
| CLI no packaging/CI | Published path + workflow |
| First-party surfaces do not use SDK | They import SDK / memory bridge |
| asOf as enterprise multi-year archive | ADR-0001 hybrid: short MVCC + app governance |

---

## 17. Recommendations (priority-ordered)

1. **Treat this doc + package READMEs + Desktop STATUS/SHIPPING + ops runbooks as living truth**; keep `docs/archive/` historical.
2. **Before marketing claims:** secrets checklist, migrations through **037**, smoke [`smoke-and-redirects.md`](./smoke-and-redirects.md), sign [`web-claims-audit.md`](./web-claims-audit.md), and respect Chrome claim gating.
3. **Close Desktop production gaps before “shipped Desktop” language:** session-scoped approvals end-to-end, encrypt secrets, wire or remove durable buffer, replace CRDB demo panes or label them demo in UI, fix sync CI pin, produce one operator Release with SHA512SUMS.
4. **Keep dual-loop discipline** — share memory contracts and OpenAPI; do not merge harness/engine casually.
5. **Prefer Lambda BFF + storage + creative pytest depth** over new surface scope.
6. **SDK GTM:** portal keys/docs exist — finish usage/billing story before heavy external SDK marketing; keep `sdk-host` / engine private until a named product decision.
7. **Observability:** extend memory/creative pattern to Lambda error/latency alarms + a synthetic cross-surface remember→recall probe.

---

## 18. Doc map

| Living | Purpose |
|---|---|
| **This file** | Ecosystem status across six surfaces |
| [`README.md`](./README.md) | Docs index |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Dual-loop non-goals, revisit triggers, fitness |
| [`adr/`](./adr/) | ADR-0001 retention, ADR-0002 erase, ADR-0003 engine bar |
| [`walkcroach-desktop.md`](./walkcroach-desktop.md) | Desktop pointer into sibling repo |
| `walkcroach-desktop/docs/{ARCHITECTURE,STATUS,SHIPPING}.md` | Desktop detail |
| `runtime-secrets-and-ssm.md`, `smoke-and-redirects.md` | Ops |
| `web-claims-audit.md`, `walkcroach-chrome-threat-model.md`, `walkcroach-stdio-mcp-security-review.md` | Security / claims |
| `walkcroach-sdk-implementation-plan.md` | Historical SDK plan — prefer this master doc + ARCHITECTURE for status |
| `color-system-research.md` | Design tokens |
| `archive/*` | Historical PRDs / plans |

---

## 19. Decision / Ask

**Decision this document asserts:** WalkCroach is a **six-surface platform on one memory graph with two intentional agent loops**. Client surfaces are shipping-capable at production maturity (Web mature; Chrome/IDE/CLI published or publish-workflowed; Desktop production-grade on an **unsigned preview** channel); the SDK is a real memory/content product with first-party adoption.

**Ask of readers:** When updating marketing, hackathon copy, or architecture recommendations, cite **this file + code**, not archived PRDs. If a claim here disagrees with a demo script, **change the script** or label the gap — do not paper over status drift.
