# WalkCroach Master Doc — Implementation Status Across the Ecosystem

**Compiled:** 2026-07-29
**Method:** This document is based on a direct, from-scratch review of the codebases themselves — five parallel deep-dive investigations, one per surface, each reading actual source (not prior documentation) and citing `file:line`. Existing PRDs and plans (`docs/walkcroach-*-prd.md`, `walkcroach-desktop/docs/`) were used only as a *diff target* — to identify where reality has moved ahead of, diverged from, or fallen behind what was originally planned — not as a source of truth about current status. Where this doc's findings conflict with `CLAUDE.md` or any PRD, this doc reflects what the code actually does as of this date.

**Scope:** Five product surfaces sharing one CockroachDB-backed memory layer — **Web** (app-builder SPA), **Chrome** (browser copilot extension), **IDE extension** (VS Code/Cursor), **CLI**, and **Desktop** (a from-scratch VS Code fork, separate repo) — plus the shared **agent-engine** (IDE/CLI runtime), **agent-harness** (Lambda runtime), and the cross-cutting **backend infrastructure** (CockroachDB schema, Terraform, CI/CD) all five depend on.

---

## 0. Executive Summary

### 0.1 Status at a glance

| Surface | Maturity | One-line verdict |
|---|---|---|
| **Web** | **Substantially complete** — ahead of its own PRD | Nearly all PRD Phase 1–3 scope is built and wired end-to-end (checkpoints, visual edit, DB provisioning, deploy, billing meter), plus unplanned scope (RAG documents, code library, E2B-primary sandboxing). Weakest points: Lambda business-logic test coverage and zero monitoring/alerting. |
| **Chrome** | **Functional, store-readiness incomplete** | Side-panel copilot, workspace linking, anonymous→authenticated upgrade, and cross-surface memory mirroring all genuinely work. Shipped a materially different interaction model than its PRD specified (side panel, not floating action button) and Chrome Web Store submission looks incomplete per the repo's own checklist. |
| **IDE extension** | **Complete, real product** | The single most feature-dense surface — chat, checkpoints/revert, attachments, semantic search, MCP/ccloud tooling, shared skills — with a working private VSIX distribution pipeline. Scope has grown well beyond its PRD. |
| **CLI** | **Functional core, thin ops story** | Shares the exact same agent loop as the IDE (genuine parity where it counts), but auth requires manually pasting a token (no PKCE), no MCP/ccloud secret-setting command, no packaging/publishing pipeline at all. |
| **Shared agent-engine** | **Most mature module in the ecosystem** | The host-agnostic loop (gather→act→verify, hard verify gates, adversarial self-review sub-agent, checkpoints, hooks, tool-loop-guard) exceeds its own PRD's ambition in nearly every dimension. |
| **Desktop IDE** | **Scaffold only — not functional** | Every "phase" is marked done in its own docs, but the VS Code fork has never been compiled, and the flagship feature (a native Bedrock agent) doesn't exist as code — the UI simulates a canned streamed response. Built in a single ~1-minute commit burst on one day, not the multi-week effort its plan describes. |
| **Shared backend infra** | **Real, actively evolving, some soft spots** | 19 CockroachDB migrations, a working three-environment Terraform/CI-CD setup. One likely-orphaned table, one duplicated table pattern, one IAM-hardening gap, and the single most-cited architecture doc (`docs/plan1.md`) does not exist in the repo. |

### 0.2 Top cross-cutting findings

1. **`docs/plan1.md` does not exist.** `CLAUDE.md` cites it four times as "the full rationale and locked architecture decisions" — for the memory-types-to-tables mapping and the client-resume-vs-server-side tool split specifically. It is not present anywhere in the repo. Everything CLAUDE.md attributes to it has been independently re-verified against actual code in this document (see §7) and is accurate where checked — but the doc itself is missing, which is a real onboarding hazard.
2. **The PRDs are systematically stale in the same direction: behind reality, not ahead of it — except Desktop, which is the opposite.** Web, Chrome, and IDE all have significant *unplanned* scope built beyond their PRDs (RAG documents and code library for Web; Chrome→Web chat handoff for Chrome; checkpoints, attachments, local semantic search, and a bidirectional shared-skills library for IDE). Desktop inverts this pattern entirely: its docs mark every phase "✅ complete" while the actual functional core — a real, non-simulated agent — doesn't exist yet.
3. **One shared identity, one shared memory layer, genuinely realized.** Cognito is a single pool/client shared across Web/Chrome/IDE/CLI (confirmed in Terraform and in each surface's auth code), and CockroachDB's `memory_entries`/`shared_skills` tables are `source_surface`-tagged and cross-surface-readable by design — this is not aspirational, it's built and exercised (e.g., Chrome's page captures become recallable from IDE's `recall_project_memory`).
4. **Test coverage follows a consistent, cross-surface pattern**: client/engine-side logic is reasonably well tested everywhere; **Lambda BFF handler business logic is the thin point on every single surface** (lambda-agent, lambda-chrome, lambda-ide all under-test their most consequential handlers), and the single largest, most important file in the whole ecosystem — `agent-harness/src/loop.ts` (1,333 lines, the core Bedrock agent orchestration used by Web and Chrome) — has no dedicated unit test file anywhere.
5. **Sandbox execution architecture has quietly inverted from what's documented.** Both `CLAUDE.md` and the Web PRD frame WebContainer as Web's execution model; the actual code makes **E2B the primary runtime and WebContainer the fallback**, only engaged if an E2B boot fails.
6. **Desktop IDE cannot currently be treated as a fifth shipped surface.** It's real, thoughtfully planned scaffolding with unusually good decision documentation — but it has no working agent, has never been compiled, and its own commit history (2 commits, same evening) contradicts the multi-week phased narrative in its docs.

### 0.3 How to read the rest of this document

Sections 1–6 cover each surface in the depth the investigating agent gathered (feature inventory → architecture → tests → gaps → PRD delta → ops maturity, or the closest equivalent structure for that surface). Section 7 covers the shared backend. Section 8 consolidates cross-cutting risks into one register. Section 9 gives directional recommendations. All `file:line` citations below were captured directly from source during this review; assume paths are relative to `walkcroach/` (repo root `c:\Users\toluo\OneDrive\Desktop\New folder\CF\walkcroach\walkcroach\`) except where explicitly marked `walkcroach-desktop/...`.

---

## 1. Web (`web/` + `infra-backend/modules/lambda-agent` + `infra-web/`)

### 1.1 Feature inventory

**Onboarding & project creation** — largely implemented. Template gallery (`web/src/features/onboarding/TemplateGallery.tsx`, backed by `web/src/templates/index.ts`), guided first-run tour (`web/src/features/onboarding/CoachMarkTour.tsx`). **Not found:** GitHub-repo-as-starting-point import (PRD FR-04, Phase 4/COULD).

**Chat / Build loop & plan transparency** — implemented. Two session modes server-side (`mode: 'chat' | 'builder'`, `rest.ts:497-538`). Structured plan-preview/approve gate: `handlers/planDecision.ts` (`continueAfterPlanDecision`), UI at `web/src/features/plan/PlanReviewCard.tsx` (Approve / Approve-edited / Adjust / Cancel, per-file diff). Activity/tool-call log: `web/src/features/activity/ActivityPanel.tsx` ← `GET /sessions/:id/activity` (`rest.ts:809-839`).

**Version control / checkpoints** — fully implemented. Auto-checkpoint after every file-mutating turn (`web/src/app/BuilderPage.tsx:118-127`), manual named checkpoints (`web/src/features/checkpoints/CheckpointPanel.tsx:61`), list/revert (`handlers/projectArtifacts.ts:159-265`), never-delete/`superseded_by` storage pattern. **Not found:** AS-OF-SYSTEM-TIME debug view (dev-only, FR-13/Phase 3 partial).

**Visual / inline editing** — implemented (was Phase 2/PRD scope). Click-to-select + toolbar (`web/src/features/visual/ElementToolbar.tsx`, `PreviewBridge.tsx`), DOM-to-source mapping via `data-wc-path` attributes baked into scaffold templates. Inline text edit with a server-enforced daily cap (`INLINE_EDIT_DAILY_CAP`, default 50/day, `handlers/phase2.ts:296-355`), free of charge (cost 0 in `CREDIT_COSTS`). **Not found:** freehand annotation-on-preview (FR-17, Phase 4/COULD).

**Backend & data for the generated app** — implemented (PRD's own "hardest/riskiest" section). "Add a database" provisions an isolated CockroachDB database per project on the same cluster (`handlers/phase2.ts:101-182`, strict identifier allowlist before SQL interpolation). A secrets proxy (`handlers/phase2.ts:184-294`) means the generated app's own code calls `/proxy/:projectId/sql` and `/proxy/:projectId/http` — real credentials never reach the client. **A genuine, automated security test exists for this**: `web/scripts/nfr13-secret-leak-scan.mjs` builds a fixture app and scans the built client bundle for five categories of canary secrets, wired as `npm run scan:secrets`. **Not found:** "add sign-in" for the generated app's own end users (FR-22/23, Phase 3/4).

**Ownership, export, portability** — implemented. ZIP export via `fflate` + presigned S3 URL (`handlers/projectArtifacts.ts:267-296`). GitHub integration goes beyond its own PRD's stated Phase-3 scope: not just one-way push, but also a manual pull (`handlers/github.ts:158-224`, size/path/extension-filtered) — still not full bidirectional sync with conflict resolution (FR-26, correctly left for Phase 4).

**Deploy & publish** — implemented. One-click deploy zips the project, uploads to S3, triggers a CodeBuild build (`handlers/deploy.ts:165-250`), debits credits atomically *before* the build starts to avoid overspend races, self-heals stuck deployment statuses by checking for a completion marker in S3. **Not found:** custom domains (FR-29), deployment rollback (FR-30) — both correctly scoped to Phase 4.

**Returning users / multi-project management** — implemented in full. Dashboard with per-project memory-summary snippets, archive/delete (soft-delete via `deleted_at`), session resume.

**Usage, billing, account** — partially implemented, matching the PRD's own honest framing. Always-visible credit meter, free tier + metered costs, atomic conditional-`UPDATE` credit debits to prevent concurrent overspend, full `usage_ledger` audit trail. **Explicitly deferred, confirmed in shipped UI copy** (`web/src/features/backend/SecretsPanel.tsx:194-195`): *"Billing portal coming soon... Stripe Customer Portal is deferred."*

**Not in the PRD at all — implemented anyway:**
- **Project documents / RAG pipeline** — full document upload → chunk → embed → recall (migrations `011`, `015`, `016`; `project_document_chunks` table), ingest-status tracking. Zero mention in the PRD.
- **Code Library / Apps Hub** (`web/src/app/CodeLibraryPage.tsx`, `AppsHubPage.tsx`) — a code-artefact catalog/versioning concept, not in the PRD.
- **"Personal Chat workspace"** — a chat-only mode decoupled from the app-builder concept (`kind='general'` projects), not in the PRD's user journey.

### 1.2 Architecture as-built

```
Web SPA → API Gateway (REST) → Lambda (handleRest router, rest.ts, 1207 lines)
   → agent-harness (Bedrock Converse streaming + tool loop, loop.ts)
   → CockroachDB (all durable state) + S3 (blobs) + Secrets Manager (project secrets/DB creds)
```

- No framework — `handleRest` is a single large regex-path-matching router; every handler enforces `assertProjectOwner` before touching project data.
- **Client-resume vs. server-side tool split is confirmed as real**, not aspirational: `write_file`/`edit_file`/`run_terminal` are recognized client-resume tools in `agent-harness/src/loop.ts`; `web_search`/`web_extract`/`recall_project_memory`/`remember_preference` execute entirely server-side.
- Two runtime shells share the same router: `lambda-handler.ts` (real streaming Lambda) and `local-app.ts`/`local-server.ts` (local dev server) — good for iteration without deploying.
- **Sandbox execution has quietly inverted from its documented design**: `web/src/hooks/useBuilderSandbox.ts` prefers **E2B** cloud sandboxes and only falls back to in-browser **WebContainer** if the first E2B boot attempt fails. Both `CLAUDE.md` and the PRD frame WebContainer as the locked architecture; in the actual build it's the degrade path. This matters beyond terminology — it changes the browser-compatibility and COOP/COEP story, since E2B runs server-side and WebContainer is the piece that actually needs the cross-origin-isolation headers `infra-web` provisions.

### 1.3 Test coverage

- **Web (`web/src`)**: 20 test files, ~1,616 lines. Substantial coverage of `api/client.test.ts` (358 lines) and `auth/cognito-idp.test.ts` (301 lines). No component/integration tests for the largest UI surfaces (`BuilderPage.tsx`, `DashboardPage.tsx`, `GithubPanel.tsx`, `SecretsPanel.tsx`) — exercised only indirectly via mocked API-client tests.
- **`lambda-agent`**: only 5 test files, and **none of `billing.ts`, `deploy.ts`, `phase2.ts`, `github.ts`, `sandbox.ts`, `projectArtifacts.ts` have dedicated unit tests** — only two integration tests exercise this surface indirectly. This is the thinnest-tested part of Web despite containing the highest-stakes logic (credit-debit concurrency safety, checkpoint provenance, secret masking).
- **`agent-harness/src/loop.ts`** (1,333 lines, the largest and most consequential file touching Web) has **no dedicated test file at all** — only exercised indirectly via Lambda integration tests and manual smoke scripts (`smoke-loop.ts`, not part of `npm test`).
- **`nfr13-secret-leak-scan.mjs`** is a genuine, well-built CI-gate security test — a real exception to the general BFF-handler undertesting pattern.

### 1.4 Known gaps / TODOs

- `agent-harness/src/mcp.ts:1-4` is explicitly self-labeled: *"Optional CockroachDB Managed MCP client stub. Wire service-account auth in Phase 1 when enabling agent MCP tools."* Only 15 lines — config plumbing, no real client. Not blocking (the hackathon's "≥2 CockroachDB tools" requirement is met elsewhere via direct SQL tools), but the Managed MCP integration alluded to in the PRD isn't actually wired for Web.
- No other inline `TODO`/`FIXME`/`HACK` markers found in `web/src` or the reviewed Lambda handlers — the codebase is otherwise clean of debt markers; absent features are simply absent, not flagged in-code.

### 1.5 Recent activity

The most recent commits (`001e8fd`, `89e6c81`) are bug fixes specifically in the **Chat module** (as distinct from Builder) — the newest/least-stable surface right now. `c97c72e "Revamped WalkCroach Web application"` marks a large rewrite point; `edbc4c5 "Fixing E2B i-frame display"` confirms E2B-as-primary-sandbox was a recently-stabilized concern. An earlier long run of `"Fixing pipeline errors"` / `"Fixing API CORS error"` commits has settled — none appear in the most recent ~15 commits.

### 1.6 Deployment / ops maturity

CI/CD is genuinely mature: `web/buildspec.yml` pulls config from SSM, builds, syncs to S3, invalidates CloudFront, fails loudly (not silently) if the backend URL isn't resolvable. Separate buildspecs exist for unit/integration/E2E (`web/buildspec-{test,integration,e2e}.yml`) — testing is a first-class pipeline stage. Secrets management is solid (SSM for config, Secrets Manager for actual secrets, `dev`-only auth bypass explicitly hardened off for `prod` in the buildspec).

**The one clear ops gap: no monitoring or alerting exists anywhere.** A grep across all of `infra-backend/**/*.tf` for `aws_cloudwatch_metric_alarm`, `aws_sns_topic`, `aws_budgets_budget` returned **zero matches**. No scheduled synthetic smoke test against production either, despite the PRD's own NFR-26 calling for one. Logging exists only as default Lambda `console.error`/CloudWatch Logs capture, not purpose-built observability.

---

## 2. Chrome extension (`chrome/` + `infra-backend/modules/lambda-chrome`)

### 2.1 Feature inventory

**Page capture** — partial. No content scripts, no broad host permissions; extraction happens on-demand via `chrome.scripting.executeScript` after the user opens the side panel (`chrome/entrypoints/background.ts:125-201`). A better Mozilla-Readability-based extractor exists (`chrome/lib/extract.ts:41-68`) but is **not actually wired into the shipped path** — `background.ts` uses its own cruder heuristic instead, a real (if minor) architectural inconsistency. Captured text truncated to 24,000 chars with an FNV-style content hash for dedup. **No selection-based capture** (PRD-implied, FR-C05) and **no screenshot capture** exist.

**Copilot side panel** — fully implemented, but as a **different interaction model than the PRD specifies** (see §2.6). Four tabs (Page / Recall / Workspaces / Trust): summarize, draft, save, ask (with optional web-search grounding), price-history display, structured-proposal review, "Open in Web Chat" handoff. Streaming via NDJSON with proper `AbortController` cancellation on tab switch.

**Workspace linking to Web projects** — fully implemented, including backfilling existing captures into `memory_entries` on link (`handlers/link.ts:239-289`, batched, capped at 2000) and keeping price-track updates mirrored into project memory on every append. This is the most complete PRD requirement in Chrome.

**Anonymous / "try-first" device sessions** — fully implemented, including edge cases: device-key mismatch rejection, already-linked-to-another-account conflict handling, transactional ownership merge on sign-in (`handlers/upgrade.ts:101-120`).

**Auth** — more sophisticated than a plain device-only model: three-tier (device tokens, Cognito JWT, opt-in `dev:*` bypass gated behind an env var). Cognito sign-in mirrors the IDE's PKCE-via-Web-tab handoff pattern exactly.

**Enterprise policy template** (`chrome/enterprise/policies.json`) — a stub by its own admission, requiring manual `EXTENSION_ID_REPLACE_ME` substitution post-publish; not automatable until the extension actually has a Chrome Web Store ID.

**Store packaging** — thorough packet (`chrome/store/`: listing copy, privacy practices, permission justifications, screenshots, an automated Playwright screenshot generator) but **`SUBMISSION_CHECKLIST.md` (dated for v0.1.4) has 4 of 9 items unchecked**, most critically "Upload 0.1.4 to CWS" — there is no evidence in the repo that the extension has actually been submitted to the Chrome Web Store. Code has since moved to v0.1.5 with no updated checklist.

### 2.2 Architecture as-built

MV3 service worker (`entrypoints/background.ts`) + side panel (`entrypoints/sidepanel/App.tsx`) + an OAuth-handoff landing page (`entrypoints/auth/`) — **no content script, no popup**. Manifest permissions are deliberately minimal: `["storage", "activeTab", "scripting", "sidePanel"]` plus a single narrow `host_permissions` entry for the API host only — **zero page-host permissions at all**. Chrome's LLM routes call `agent-harness`'s Bedrock streaming primitive directly per-handler (single-shot streamed completions), not through a full multi-turn agent loop — lighter-weight than Web's integration. Rate limiting (`assertRateLimit`) is applied per-owner and globally across LLM/device-session routes.

### 2.3 Test coverage

Client-side (`chrome/lib/`): 942 lines across 7 files — solid coverage of `auth.ts` (373 lines) and `api.ts` (294 lines). **But zero test coverage for `entrypoints/background.ts`** (the message-routing/extraction/insert logic) **and zero for the ~1,100-line `sidepanel/App.tsx`** — the two largest, most stateful files are entirely untested at the unit level.

Lambda side (`lambda-chrome`): 273 lines across 7 files, thin relative to 14 handler files — only `oauth.ts` has a dedicated handler test. `price-track.ts` (upsert-by-URL, history append, memory mirroring — the most logically complex handler), `link.ts` (backfill logic), and `upgrade.ts` (ownership-merge transaction) all have **no dedicated test file**.

### 2.4 Known gaps / TODOs

No inline `TODO`/`FIXME`/`HACK` comments anywhere in the reviewed code — gaps are structural, not marked:
- `chrome/lib/permissions.ts:1-27` is a **self-documented dead-code path**: `ensureOriginPermission` always returns `true`, `hasOriginPermission` always `false`, `listGrantedOrigins` always `[]`, `revokeOrigin` always `false` — a deliberate stub after the move to `activeTab`-only in v0.1.3, but it means the entire per-site trust/revoke UI the PRD describes (FR-C15, UJ-C9) is dead code today.
- `handlers/telemetry.ts:5-8` — the telemetry allowlist only contains permission-grant/revoke events for a permission model that no longer exists client-side; effectively unreachable.
- `background.ts`'s shipped extraction path duplicates, with a cruder implementation, the better Readability-based extractor sitting unused in `lib/extract.ts`.

### 2.5 Recent activity

Very recent, active work: `8bed9c7`, `3f10310`, `3f31da5` (all 2026-07-25) correspond exactly to the CORS/host-permission hotfix cycle documented in `CHANGELOG.md` (0.1.3→0.1.4→0.1.5). Commit messages ("Fixing...", "Implemented fixes update") suggest a reactive fix cycle rather than net-new feature work in the very latest commits, though the underlying scope added (Cognito login, Web Chat bridge, shared-memory linking) is substantial.

### 2.6 PRD delta

**Biggest architectural delta in the whole ecosystem**: the PRD specifies a **Floating Action Button (FAB)** rendered automatically on every page (UJ-C1/C2, FR-C01/C02, NFR-C01: render <300ms) with a first-appearance tooltip onboarding flow. **None of this exists.** The shipped product is a side panel the user must deliberately open via the toolbar icon — a fundamentally different onboarding and always-available-affordance model.

Also diverged: the PRD's per-site permission grant/revoke system (`optional_host_permissions`, requested just-in-time per domain, FR-C14/C15) was replaced with `activeTab`-only + zero host permissions — arguably *better* for user trust (nothing to grant or revoke), but the letter of FR-C15 (a visible revoke UI) is unmet; the Trust tab instead states there's nothing to revoke.

**Implemented but not in the PRD**: the full Cognito PKCE sign-in system (the PRD only speaks generally of "sign-in linking"), the "Open in Web Chat" one-time-code handoff (entirely new scope, backed by its own migration `018_chrome_chat_handoffs.sql`), content-hash-based summarize caching.

### 2.7 Deployment / ops maturity

Real, working CI (`chrome/buildspec.yml`, fails closed on missing prod config), disciplined semver policy (`VERSIONING.md`), well-maintained `CHANGELOG.md`, live production endpoint defaults baked into `release.env`. Monitoring plan (`POST_SUBMIT_MONITORING.md`) references real, already-emitted CloudWatch metrics — good hygiene, though it still references the now-defunct permission-grant/revoke events as its primary "trust" metric. **The one clear open item, per the repo's own tracking, is whether the extension has actually cleared Chrome Web Store review** — evidence suggests it has not.

---

## 3. IDE extension, CLI, and the shared agent-engine

### 3.1 `packages/agent-engine` — the shared, host-agnostic runtime

This is **the most mature module in the entire ecosystem** — ~13,000 lines across ~40 modules, host-agnostic (never imports `vscode`), fully re-exported from `index.ts`.

- **`loop.ts`** (1,099 lines) — the agent loop itself. Beyond a basic gather→act→verify cycle, this includes: a hard verify gate reading `.walkcroach/verify.json` recipes that blocks clean turn completion; an **adversarial read-only "verify-review" sub-agent** that must reply with a `REVIEW_OK` marker before a turn can end; todo-write/progress nudges; blocking `Stop` hooks; a tool-loop guard that detects and refuses repeated identical failing calls; depth-limited sub-agent fan-out (max 3, forced read-only, cannot spawn further sub-agents). **Note a real narrowing from the PRD**: the spec's example of parallel sub-agents that *write* files (one renaming an API, one updating tests) is not what's built — sub-agents can only investigate; the parent turn does all mutation.
- **`bedrock.ts`** — Bedrock Converse streaming, recently and substantially hardened (the most recent commit in the whole repo, `89e6c81`, touched this file for the Bedrock auth/region fixes covered elsewhere in this project's history).
- **Tool surface** materially exceeds what any PRD describes: `PHASE_A_TOOLS` (file/search/terminal/todo/ask_user, 17 tools), `PHASE_B_TOOLS` (CockroachDB MCP, generic MCP, skills, ccloud), `PHASE_C_TOOLS` (project memory recall/mirror), `SHARED_SKILL_TOOLS` (`mirror_skill`).
- **`mcp.ts`** — CockroachDB Managed MCP connects directly (no WalkCroach proxy). A documented, deliberate deferral: stdio-spawned local MCP servers are explicitly out of scope as "a real security surface deserving its own review" — only HTTP/Streamable `.walkcroach/mcp.json` servers work today.
- **`skills.ts` + `skills/bundled.ts`** — the most recently and substantially expanded module (the Jul 26 commit alone added +789 lines here). Two-tier progressive-disclosure loading, official CockroachDB skills synced out-of-band as a separate JSON asset (kept out of the JS bundle for size reasons), plus the account-scoped, CockroachDB-synced shared-skills system built out over the course of this project.
- **`checkpoints.ts`**, **`attachments.ts`**, **`local-index.ts`** (semantic search) — all real, tested, wired-in modules, **none mentioned in the PRD at all**. `local-index.ts` is unusually candid in its own header comment about being a deliberately-scoped v1 (brute-force cosine similarity, no ANN library, no file-watcher-driven reindexing) — "fine at single-repo scale," not gold-plated.
- Root `CLAUDE.md`'s module list for this package is accurate but **understates scope** — it omits `checkpoints.ts`, `attachments.ts`, `local-index.ts`, `shared-skills.ts`, `project-memory.ts`, `approval-controller.ts`, `tool-loop-guard.ts`, `compact.ts`, `coalesce.ts`, all of which are real and load-bearing.

### 3.2 `ide/` — feature inventory

A complete, feature-dense product, not a prototype:
- **Webview UI** (`App.tsx`, 1,244 lines): streaming chat, tool cards, sub-agent cards, todo checklist, attachment picker, Agent/Ask mode toggle, autonomy toggle, approval UI. A genuinely complete event-protocol surface (12 distinct message types handled).
- **Checkpoint/revert is real end-to-end**, not just engine-side: a "Revert all file changes from this turn" button in the webview, gated to only appear on turns that actually mutated files.
- **Host wiring** (`webviewProvider.ts`, 1,353 lines) is where everything connects — builds project-memory and shared-skills bridges only when signed in (and, for project memory, linked), points at the externally-shipped CockroachDB skills JSON, persists full sessions after every turn, implements exponential-backoff auto-continue.
- **Auth**: full PKCE flow against Web's shared Cognito client, no separate IDE user pool, VS Code-URI-scheme redirect (works across VS Code/Cursor/Insiders), with a "paste token" fallback command.
- **Packaging**: a mature, actively-used **private VSIX distribution pipeline** — build → bundle-size gate → `vsce package`, with a documented install flow and baked-in production defaults, explicitly pending Open VSX publisher enrollment before public distribution.

### 3.3 `cli/` — feature inventory and parity gaps

Genuine parity with the IDE **at the engine level** — both consume the exact same `runAgentLoop` from `@walkcroach/agent-engine`, so tool behavior, approval semantics, and CockroachDB tool integration are shared, not reimplemented. Commands: `run`, `ping`, `auth {login,logout,status}`, `link`/`unlink`/`projects`/`status`, `config`, `doctor`. Three output modes (Ink TUI, `--plain`, `--json`/NDJSON) plus a genuinely hardened `--yes`/non-interactive CI mode that still refuses ccloud/MCP-writes/infra-shell.

**Concrete, non-PRD-aspirational parity gaps**:
- No browser-based PKCE sign-in — `auth login` requires manually pasting a token obtained elsewhere.
- No command to set MCP/ccloud secrets — must hand-edit `~/.walkcroach/secrets.json`; `config` explicitly rejects unknown keys.
- No `revert` command — `checkpoints.ts`/`revertTurn` are exported from the shared engine and wired into the IDE's UI, but never back-ported to a CLI command.
- No shared-skills/project-memory "list" command analogous to the IDE's `viewMirroredMemory`/`viewSharedSkills`.
- **No packaging or CI pipeline exists for the CLI at all** — `cli/package.json` is `"private": true`, no `publishConfig`, no `cli/buildspec.yml`. Distribution is `npm link` from a local clone. This is the least mature ops story of any surface reviewed.

### 3.4 Test coverage

| Package | Test cases (rough) | Coverage gate |
|---|---|---|
| `packages/agent-engine` | 289 | `statements: 40`, applies broadly across `src/**/*.ts` |
| `ide` | 38 | `statements: 40`, but scoped to **only 3 files** — `App.tsx` (1,244 lines) and `webviewProvider.ts` (1,353 lines), the two largest and most business-critical files, are **entirely excluded from the coverage gate** |
| `cli` | 63 | `statements: 40`, reasonably comprehensive for its smaller surface |
| `lambda-ide` | 13 | **No coverage configuration at all** |

`CLAUDE.md`'s claim that coverage thresholds are "enforced per-package (statements: 40 in most configs)" is accurate for 3 of these 4 but not for `lambda-ide`, and the `ide` package's 40% figure is misleading in isolation given what it's actually computed over.

A precise grep for `TODO`/`FIXME`/`HACK`/`not implemented` across all four of `ide/src`, `cli/src`, `packages/agent-engine/src`, `lambda-ide/src` returned **zero matches** — no informal debt-comment backlog anywhere in this surface group; deferred work is documented in prose instead (see §3.1, `mcp.ts` and `local-index.ts`).

### 3.5 Recent activity

Only 10 commits in the repo's short history touch this surface group. The most recent (`89e6c81`, Jul 28) is the Bedrock auth/region hardening. The prior commit (`3ade07e`, Jul 26, "Upgrade to Walkcroach IDE extension") is the single largest change in this project's history — it introduced attachments, checkpoints, local semantic index, and the full shared-skills system essentially all at once.

### 3.6 PRD delta

**Confirmed not implemented / narrower than described**: the multi-writer sub-agent pattern (§3.1), latency budget instrumentation (NFR-D01/02/03 — unmeasured, unenforced anywhere), Chat Participant/Language Model Tools interop (correctly deprioritized, PRD marks it COULD).

**Implemented, not in the PRD (the larger and more significant delta)**: per-turn checkpoints/revert, chat attachments, local semantic index, the bidirectional shared-skills library (official skills load read-only *plus* users can mirror their own learned skills into a personal, cross-surface library — a materially different, larger product surface than the PRD's "load official skills read-only" framing), interactive PTY terminal sessions, Stop/PostToolUse hooks, structured hard-verify gates, the adversarial verify-review sub-agent, todo nudges, full session persistence across VS Code reloads. **Actual delivered scope in what the PRD called "Phase A" (no-CockroachDB-dependency features) alone now exceeds the PRD's entire stated ambition.**

### 3.7 Deployment / ops maturity

IDE: real CI (`ide/buildspec.yml` — typecheck + full test + build + bundle-size check + VSIX packaging), a genuinely-used private-distribution flow with a pre-written (not-yet-executed) path to public Open VSX publishing. CLI: no CI, no publishing — the clear ops laggard among these three. `lambda-ide`: standard Lambda BFF pattern (auth, project linking, memory sync, skills sync), but the only one of the four Lambda BFFs with zero coverage configuration.

---

## 4. Desktop IDE (`walkcroach-desktop/` — separate repo)

### 4.1 Headline finding

This is a **structurally complete, functionally shallow scaffold**. `README.md` marks every phase (0 through F) "✅," but the qualifier attached to most of them — "✅ Structural" — is the operative word. The phase-verification scripts (`scripts/phaseB-verify.mjs`, etc.) are almost entirely file-existence and string-content checks, not functional or integration tests. The full VS Code fork **has never been compiled or launched** (blocked on disk space per `docs/phase-A/COMPILE.md:3`), and **the core promised feature — a native Bedrock-backed agent — does not exist as code anywhere in the tree.** Only a typed IPC contract and a renderer-side simulation exist.

Git history is **two commits, both from the same evening** (2026-07-19, ~1 minute apart) — meaning the entire multi-phase "history" recorded across `docs/phase-0` through `docs/phase-F` was authored in a single session, not accumulated over the multi-week phase durations (1.5–3 weeks each) the implementation plan specifies. There has been no further commit activity in the ten days since.

### 4.2 Phase-by-phase reality check

| Phase | Claimed | Actual backing |
|---|---|---|
| 0 — Research spike | ✅ | Real: upstream pin recorded, Electron/engine-import spikes exist. Signing procurement is an entirely unchecked human-action checklist. |
| A — Fork bootstrap | ✅ Structural | Real nested `microsoft/vscode` clone at the pinned commit exists, product-config overlay exists. **Never compiled.** |
| B — Native agent | ✅ Structural | Real: `packages/desktop-agent` genuinely implements a HostAdapter + session runner (see §4.3). **Not real**: the renderer's agent UI (`walkcroachAgentService.ts:213-284`) hardcodes a simulated streamed reply — it never calls `desktop-agent`, because the electron-main bridge that would connect them doesn't exist anywhere in the repo. |
| C — CockroachDB panels | ✅ Structural | Real session class wrapping the shared `CockroachMcpClient`/`SkillsRegistry` — but **demo mode is the default**, returning hardcoded fixture data unless explicitly configured otherwise, and real connectivity is gated on the same unbuilt bridge. |
| D — Marketplace/migration | ✅ Structural | Real, reasonably complete static config (incompatibles list, curated recommendations, surface-area allowlist). Never exercised against a running instance. |
| E — Distribution/signing | ✅ Structural | Docs-heavy; explicitly deferred: "Signed installers downloadable: ⏳ Deferred — interim Windows portable ship." No signed builds exist. |
| F — Sustainability | ✅ Structural — "continuous cadence" | Real artifacts (`cadence/OWNER.md`, `CHECKLIST.md`), but exactly **one same-day** cadence record exists — not an actual track record over time. |

### 4.3 `desktop-agent` package — what's real

`packages/desktop-agent` is the direct analog of `ide/src/host/VsCodeHostAdapter.ts`, and it **directly depends on the shared engine via a `file:` reference reaching out of this repo into the sibling `walkcroach` repo** (`packages/desktop-agent/package.json:16-18`) — meaning the two repos are only usable checked out as siblings, not independently distributable. This is the single most important cross-repo coupling fact in this document.

- `desktopHostAdapter.ts` (353 lines) — **real, working, non-stubbed** Node implementation of the shared `HostAdapter` interface: path-confined file I/O, ripgrep-with-fallback search, real `child_process`-based terminal execution, workspace-trust gating.
- `session.ts` (174 lines) — genuinely wraps `runAgentLoop` from the shared engine, fully wired to build MCP config, ccloud keys, and project-memory bridges. **This is the real Bedrock-driven loop** — it is simply never invoked by anything in the actual Electron app; no caller exists outside the package's own tests.
- `crdbPanel.ts` (438 lines) — real CockroachDB panel backend with a hard read-only-by-default gate and unconditional per-action confirmation for ccloud actions, but demo-mode-first by default.
- Only 194 lines of genuinely-executed tests exist in this package (plus a small crash-Lambda test) — the only real automated verification in the entire `walkcroach-desktop` repo outside file-existence checks.

**The gap, precisely stated**: the pieces that would make this a real product (a working HostAdapter, a working session runner, a working CockroachDB panel) are already written and even unit-tested — they are just not connected to the actual VS Code renderer, because the connecting piece (an electron-main IPC bridge) is documented (`docs/phase-B/ENGINE_BRIDGE.md`) but not coded anywhere in the repo.

### 4.4 Product customization scope

A **light, well-contained reskin, not a deep fork**. All customization is confined to a single `src/vs/workbench/contrib/walkcroach/` directory plus three minimal upstream hook points (`workbench.common.main.ts`, `product.json`, `.gitignore`), enforced by an actual audit script (`scripts/audit-surface-area.mjs`) against a committed allowlist. No evidence of edits to VS Code's core editor/platform/base layers was found. Product config (`product/product.walkcroach.json`) does standard rebrand work — name, data folder, URL protocol, bundle IDs — and points the extension gallery exclusively at Open VSX with no Microsoft Marketplace fallback, with telemetry off by default.

### 4.5 Decisions log (the strongest part of this project)

Two ADRs, both dated the same day as everything else, but both genuinely well-reasoned pragmatic deferrals:
1. **No Marketplace proxy, ever** — Open VSX only, citing Cursor's 2025 Marketplace enforcement and a January 2026 Open VSX namesquatting disclosure as direct precedent. Framed as the single most load-bearing decision in the project.
2. **Unsigned Windows portable as the only interim public distribution** — signing certs are budget-blocked; rather than stall all distribution, ship an unsigned zip with checksums and documented SmartScreen/Gatekeeper warning expectations, revisit when budget allows.

### 4.6 Known gaps

Consolidated from §4.2–4.3: no electron-main bridge exists at all; the full fork has never compiled; signing/notarization hasn't started; Cognito auth is paste-token only (no real OAuth); the ccloud runner throws at runtime if invoked outside tests because nothing supplies the missing bridge function; the crash-reporting endpoint is configured empty despite the Lambda ingest code existing.

### 4.7 PRD/plan delta

Unusually, the companion PRD and implementation-plan documents (in the *other* repo, `walkcroach/docs/`) already contain inline status annotations that match almost exactly what's found in this repo's own phase-exit docs — strongly suggesting the plan was updated in lockstep with (or generated alongside) this repo's build-out, rather than being an independent target measured after the fact. What's built essentially as specified: the fork-isolation mechanism, the Open-VSX-only extension policy with its full audit trail, the CockroachDB panel's hard ccloud-confirm gate. What's planned but not started: **the PRD's entire stated reason for forking at all** — "deep, native AI integration... only possible once you own the codebase" — is exactly the piece that doesn't work yet.

---

## 5. Shared backend infrastructure

### 5.1 Documentation drift (read this first)

**`docs/plan1.md` does not exist anywhere in the repo.** `docs/` contains only PRDs, a color-system note, a smoke/redirects note, and two images. `CLAUDE.md` cites `plan1.md` four separate times as the authority for the project's rationale, the memory-types-to-tables mapping, and the client-resume-vs-server-side tool split. This document independently re-verified each of those specific claims against actual migrations/code (below) and found them **accurate** — but the cited source itself is missing, which is real, actionable documentation debt: any new contributor following CLAUDE.md's instruction to "read `docs/plan1.md` §Memory types → tables" will hit a dead end.

### 5.2 CockroachDB schema — full picture across 19 migrations

Applied in order via `infra-backend/packages/db/src/migrate.ts` (tracks applied files in a `schema_migrations` table). No ORM — a thin `pg.Pool` wrapper.

**Scoping patterns observed across all tables:**
- **Project-scoped**: `projects`, `sessions`, `memory_entries`, `checkpoints`, `project_files`, `project_documents`, `project_document_chunks`, `tool_invocations`, `build_events`.
- **Owner/account-scoped**: `workspaces`, `shared_skills`, `credit_balances`, `usage_ledger`, `chrome_device_sessions`, `ide_project_links`.
- **Global/ephemeral**: one-time-code auth-handoff tables (`ide_auth_codes`, `chrome_auth_codes`, `chrome_chat_handoffs`, `github_oauth_states`).

**Vector columns** (`VECTOR(1024)`, Titan Embeddings V2 dimension): `memory_entries.embedding`, `page_captures.embedding`, `project_documents.embedding`, `project_document_chunks.embedding`, `shared_skills.embedding`. **Indexed** (C-SPANN vector index actually created): `memory_entries`, `project_documents`, `project_document_chunks`. **Not indexed**: `page_captures.embedding` (no migration ever added one) and `shared_skills.embedding` (deliberately left commented-out pending cluster-support confirmation — though that confirmation already happened two migrations after the first such comment, so this reads as simply not-yet-done rather than a real open question).

**Notable schema-evolution facts, migration by migration:**
- `001_initial.sql` establishes the core five (`projects`, `sessions`, `messages`, `memory_entries`, `build_events`) plus `agent_locks` and `deployments`.
- `003_checkpoints.sql` adds checkpoints + a file-index table, and is where the `memory_entries` vector index actually gets turned on (proving C-SPANN works on-cluster).
- `007_chrome_workspaces.sql` generalizes `page_captures` to be workspace-scoped (not just project-scoped) and adds the anonymous device-session table.
- `010_web_revamp.sql` is the single biggest schema jump — adds RAG-adjacent `project_documents`, makes `sessions.project_id` nullable (enabling project-less "General Chat"), and adds `code_artefacts` (the one "content" table whose primary scoping is user-level rather than project- or owner-level).
- `013_tool_invocations.sql` explicitly documents itself as "dual-written alongside `build_events`" — i.e., both tables are actively written today, a clear future-consolidation candidate, not dead code.
- `016_project_document_chunks.sql` is the most mature/production-shaped table in the schema — its own SQL comments twice stress that every chunk row must carry `project_id` for tenant-boundary correctness at recall time.
- `019_shared_skills.sql` (newest, Jul 26) is explicitly designed to mirror `workspaces`' owner-scoped shape rather than `memory_entries`' project-scoped shape, with the design rationale documented directly in the migration file.

**Likely orphaned table**: `agent_locks` (`001_initial.sql:57-64`) — a full distributed-locking schema (resource path, holder, expiry) with **zero matching source references anywhere under `infra-backend/**/src`**. Either dead code from an abandoned early design, or a mechanism this investigation's search methodology didn't surface — worth a targeted follow-up before assuming it's safe to drop.

### 5.3 Agent-harness (shared Lambda runtime) — maturity signal

Every source file in `infra-backend/packages/agent-harness` has a colocated test file, and no stub/placeholder files were found. `loop.ts` (1,333 lines) and `skills.ts` (paired with migration 019) are the most recently touched — consistent with skills being the newest feature area across the whole ecosystem. (Note the tension with §3.4/§1.3: every file has *a* test, but `loop.ts` specifically — the largest file — has none of its own; its testing happens only indirectly.)

### 5.4 Terraform-provisioned resources

`infra-backend` orchestrates 8 modules: secrets (lookup only, provisions nothing itself), artefacts (S3), apps-hosting (S3 + CloudFront + ACM + Route53 + a CloudFront Function router for slug-based app hosting + CodeBuild), Cognito (single pool/client shared across all surfaces), Bedrock Guardrails (PROMPT_ATTACK filter, region-specific profile IDs including a UK-specific override), and three near-identical Lambda modules (`lambda-agent`/`lambda-chrome`/`lambda-ide`).

**A real architectural asymmetry**: `lambda-agent` gets explicit REST resources/methods in API Gateway (`/health`, `/projects`, `/sessions`, etc.), while Chrome and IDE each get a single `{proxy+}` catch-all that forwards everything to their own Lambda's internal router. Not a bug, but worth knowing if you're expecting symmetric REST surfaces.

**Per-environment reality**: `dev` and `test` are both minimal, near-identical configs relying almost entirely on variable defaults — both effectively "insecure by default" (dev-auth allowed, no Cognito enforcement at the API Gateway layer, no custom domain). **Only `prod` diverges meaningfully** — it's the only environment with a custom domain, ACM cert, Route53 records, and hardened auth flags (`allow_dev_auth=false`, `enable_apigw_cognito_authorizer=true`).

`infra-web` (S3/CloudFront for Web hosting) depends on `infra-backend` having been applied first for the same environment — it reads the backend API URL via an SSM parameter `infra-backend` publishes, meaning the two Terraform roots have a real, one-directional apply-order dependency. The COOP/COEP header policy required for WebContainer's cross-origin isolation is genuinely provisioned here (`infra-web/modules/cloudfront/main.tf:47-58`).

### 5.5 CI/CD

Two CodePipeline CloudFormation stacks (not Terraform — infra-as-code for the pipelines themselves), each with a Non-Prod pipeline (dev auto-deploy, test behind manual approval) and a Prod pipeline (manual approval before deploy). Both use modern CodeStar/CodeConnections GitHub triggers, not webhooks.

**A real, if soft, security gap**: the backend pipeline's Terraform IAM role is a single, broadly-scoped role (`Resource: '*'` for most services) shared across all three environments, while the *web* pipeline was later hardened with **separate, explicitly-commented, per-environment IAM roles** specifically to prevent a dev build from being able to touch prod's S3 bucket or CloudFront distribution. The backend pipeline hasn't caught up to this later hardening pass.

**A minor inconsistency**: the backend pipeline's Dev-deploy stage has no manual approval gate; the web pipeline's Dev-deploy stage does.

### 5.6 Gaps / TODOs

No inline `TODO`/`FIXME`/`HACK` markers and no commented-out Terraform resource blocks anywhere in either `infra-backend` or `infra-web` — the Terraform itself is clean and passes `terraform validate`/`fmt -check` with zero issues in both roots. The concrete gaps are all structural/process: the orphaned `agent_locks` table, the `build_events`/`tool_invocations` duplication, the missing `shared_skills` vector index, the IAM-hardening asymmetry between the two pipelines, and `test.tfvars`' `web_app_url` being commented out (potentially leaving the E2E pipeline stage without a fully configured target).

### 5.7 Recent activity

32 commits touch this area total. A large fraction of the early history is repeated "Fixing pipeline errors" / "Fixing API CORS error" cycles — CI/CD and cross-surface auth clearly took several iterations to stabilize. The most recent commits are IAM/auth-pattern updates, meaning infra is still actively evolving alongside application code, not frozen.

---

## 6. Consolidated risk / gap register

Ranked roughly by how load-bearing the gap is, not by surface:

| # | Gap | Where | Why it matters |
|---|---|---|---|
| 1 | Desktop IDE's core agent doesn't exist — renderer simulates it | `walkcroach-desktop/.../walkcroachAgentService.ts:213-284` | The entire justification for forking VS Code (native AI integration) is unrealized; nothing here should be represented as a working fifth surface today |
| 2 | `docs/plan1.md` doesn't exist but is cited as the architecture authority | `CLAUDE.md` (4 citations) | Onboarding hazard; this doc has re-verified its claims but the source itself needs to be written or the citations removed |
| 3 | `agent-harness/src/loop.ts` (1,333 lines, used by Web and Chrome) has no dedicated test | `infra-backend/packages/agent-harness/src/loop.ts` | The single most consequential file in the shared backend has zero direct unit coverage |
| 4 | Every Lambda BFF's business-logic handlers are the thinnest-tested part of their surface | `lambda-agent` (billing/deploy/phase2/github/sandbox), `lambda-chrome` (price-track/link/upgrade), `lambda-ide` (no coverage config at all) | Consistent cross-surface pattern, not a one-off — highest-stakes logic (money, credentials, cross-account merges) is the least verified |
| 5 | No monitoring/alerting exists anywhere in Terraform | `infra-backend/**/*.tf` | Zero CloudWatch alarms, SNS topics, or budget alarms; no scheduled synthetic smoke test against prod, despite Web's own PRD calling for one |
| 6 | Chrome Web Store submission appears incomplete | `chrome/store/SUBMISSION_CHECKLIST.md` | The store packet is thorough but the checklist's own unchecked boxes suggest the extension isn't actually live/reviewed yet, and the checklist is stale relative to the shipped version |
| 7 | Sandbox execution architecture (E2B vs. WebContainer) has inverted from documentation | `web/src/hooks/useBuilderSandbox.ts` vs. `CLAUDE.md` / Web PRD | Anyone reasoning about Web's execution model from the docs alone will get it backwards |
| 8 | CLI has no packaging/publishing pipeline at all | `cli/` | Distribution is `npm link` from a local clone; no `cli/buildspec.yml`, no npm publish config |
| 9 | CLI auth requires manually pasting a token; no MCP/ccloud secret-setting command | `cli/src/commands/auth.ts` | Genuine ergonomic parity gap vs. IDE, not just a PRD aspiration |
| 10 | `agent_locks` table likely orphaned | `infra-backend/packages/db/migrations/001_initial.sql:57-64` | No source references found; candidate for removal or a follow-up check before assuming so |
| 11 | `build_events` / `tool_invocations` duplication | migrations `001`, `013` | Both actively written today; unresolved consolidation, a growing maintenance surface |
| 12 | Backend Terraform pipeline's IAM role is broadly scoped vs. web pipeline's per-environment hardening | `ci-cd/infra-backend-pipeline.yaml` vs. `ci-cd/infra-web-pipeline.yaml` | Blast-radius inconsistency between two otherwise-similar pipelines |
| 13 | `desktop-agent` depends on the sibling repo via a relative `file:` path | `walkcroach-desktop/packages/desktop-agent/package.json:16-18` | The two repos are not independently distributable; must be checked out as siblings |
| 14 | Chrome's shipped page-extraction path doesn't use the better extractor already in the codebase | `chrome/entrypoints/background.ts` vs. `chrome/lib/extract.ts` | Minor, but a real missed-wiring inconsistency |
| 15 | `ide` package's 40%-statement coverage gate is computed over only 3 of its files | `ide/vitest.config.ts:11-17` | The gate excludes the two largest, most business-critical files (`App.tsx`, `webviewProvider.ts`) entirely — the number is not representative |

---

## 7. Recommendations

These are directional, not prescriptive — flagged here because they fell out clearly from the investigation, not because a plan was requested.

1. **Decide what to say publicly about Desktop.** Given finding #1, it should not be described as a working fifth surface in any external-facing material until the electron-main bridge exists and the fork actually compiles. The scaffolding quality (decision log, audit scripts, isolation discipline) is genuinely good and worth preserving — this is a "not yet," not a "redo."
2. **Either write `docs/plan1.md` or stop citing it.** Given how much of `CLAUDE.md`'s architectural framing depends on it, and how accurate that framing turned out to be when independently re-verified, the fastest fix is probably extracting what's already true (confirmed in this document) into that file, rather than writing it from scratch.
3. **Prioritize a `loop.ts` test suite before the next feature lands on it.** It's the single largest shared-risk file across Web and Chrome; a regression here has the widest blast radius of anything in the ecosystem.
4. **Treat Lambda-handler test coverage as a cross-cutting initiative, not a per-surface one** — the pattern (thin BFF handler tests, solid client/engine tests) repeats identically across all three Lambda BFFs, suggesting a shared root cause (e.g., harder-to-set-up integration test fixtures for Lambda+CockroachDB) worth solving once rather than three times.
5. **Correct the WebContainer/E2B framing** in `CLAUDE.md` and the Web PRD to match reality (E2B primary, WebContainer fallback) — low effort, removes a real source of confusion for anyone reasoning from the docs.
6. **Chrome Web Store submission status should be explicitly confirmed and the checklist brought current** before any external claims are made about Chrome being "published."
