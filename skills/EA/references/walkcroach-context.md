# WalkCroach Platform Context

> **Read this before any recommendation that touches the real platform.**
> Snapshot basis: **code review of `walkcroach/` + `walkcroach-desktop/` (Aug 2026)**, not stale phase docs. Docs under `docs/` and older PRDs drift — prefer package.json, exports, Lambdas, and tests. Label claims **verified / inferred / assumed**. Fast-moving details (Bedrock model IDs, Open VSX counts, pricing) go stale quickly — re-verify before one-way-door decisions.

## Contents
1. Surfaces
2. Runtime topology (two agent loops)
3. Stack
4. Locked decisions
5. Cross-cutting principles
6. Known debt and open risks
7. The five evaluation criteria
8. How this team works

---

## 1. Surfaces

Six product surfaces exist today. Desktop lives in a **sibling repo**. Naming: Chrome is the browser extension (rename target: **WalkCroach Browser Extension**).

| Surface | Repo path | Runtime agent | Maturity (code-backed) |
|---|---|---|---|
| **Web** (App Builder) | `walkcroach/web` | **agent-harness** via `lambda-agent` | Mature SPA (React 19, Vite, WebContainer); creative + projects + builder |
| **Browser Extension** | `walkcroach/chrome` | **agent-harness** via `chrome-api` | Mature MV3 (WXT); device→Cognito auth; no SDK import |
| **IDE Extension** | `walkcroach/ide` | **agent-engine** + `/ide/v1` BFF | Published Open VSX; `VsCodeHostAdapter` |
| **CLI** | `walkcroach/cli` | **agent-engine** (bundled) | Published `@walkcroach/cli`; Ink TUI |
| **SDK** | `packages/sdk` (+ `sdk-mcp`, `sdk-host`) | Memory/content HTTP; host runs via engine | Client built; **first-party surfaces do not import it yet**; no publish workflow |
| **Desktop IDE** | `walkcroach-desktop/` | **agent-engine** via `desktop-agent` + Agent Host | **Production-grade** (parity with IDE/CLI); **unsigned preview** channel only |

**Planned / missing product surfaces (not built):**
- **Developer portal** — API keys UI, docs, usage, billing for public SDK consumers (partially foreshadowed by `/v1/keys` + SDK README; no portal app).
- **Admin / ops portal** — per-customer usage, infra cost, token spend (still not built).

Architecturally important property: **one CockroachDB memory graph, many clients.** `source_surface` values include `web` | `chrome` | `ide` | `cli` | `sdk` | `desktop`. Any design that makes a surface's durable state local-only breaks the platform differentiator.

---

## 2. Runtime topology (two agent loops)

Do **not** describe WalkCroach as having a single agent runtime. Code has two full loops:

| Loop | Package | Used by | Character |
|---|---|---|---|
| **Coding / host-local** | `@walkcroach/agent-engine` (`private: true`) | IDE, CLI, Desktop (`desktop-agent`), `sdk-host` → ide-api content worker | `HostAdapter` + `runAgentLoop`; BYOK Bedrock; worktrees; MCP; local `.walkcroach/` sessions |
| **Cloud / creative** | `@walkcroach/agent-harness` (`infra-backend/packages/`) | Web + Chrome Lambdas | Server-side; CRDB memory native; creatives; E2B; connectors; different `AgentEvent` type |

Empty dir `packages/agent-harness/` is a **dead placeholder** — ignore it.

**`@walkcroach/sdk` is not an agent loop.** It is a typed HTTP client for public `/v1/{memory,content,keys,health}` on the IDE Lambda. Relation to agent-engine: **none at import time**. First-party memory clients remain bespoke (`ideClient`, CLI `api.ts`, web `client.ts`, chrome `lib/api.ts`).

Shared scaffolds: `@walkcroach/templates` (web + CLI only).

---

## 3. Stack

- **Models** — Amazon Bedrock (Nova converse + Titan embeddings). Model IDs and caching change — verify live Bedrock docs.
- **Memory / data** — CockroachDB Cloud: C-SPANN vector index, `superseded_by` provenance, AS OF SYSTEM TIME recall (bounded by `gc.ttlseconds`), Managed MCP + ccloud behind confirmation, skills judgement layer.
- **Compute** — Lambda-first BFFs (`lambda-agent`, `lambda-chrome`, `lambda-ide`, `lambda-creative`); Step Functions for video; S3 + CloudFront for web/artefacts; Secrets Manager.
- **Sandbox** — E2B primary (Web); WebContainer fallback.
- **Auth** — Cognito. Chrome: device token → Cognito. IDE/CLI/Desktop: PKCE / connect flows (Desktop still paste-token in places). SDK: `wc_live_…` API keys (scrypt-hashed) **or** access token; keys cannot mint keys.
- **Billing** — `@walkcroach/ledger` + Stripe on web BFF (checkout/portal/webhook). SDK metering for public API keys is **not** a finished developer-product loop — extend ledger + Stripe Meters when opening the portal.
- **Observability** — Partial: Terraform modules `observability-memory` and `observability-creative` (SNS, Budgets, some CloudWatch alarms). Not platform-wide coverage; do not claim "no monitoring exists" without re-grepping.

Monorepo note: **no root npm workspace** in `walkcroach/`. Surfaces install separately; only `infra-backend/` uses workspaces.

---

## 4. Locked decisions — do not silently reopen

Reopening is legitimate; doing it *by accident under schedule pressure* is the failure mode. If a recommendation reverses one, say so explicitly.

| Decision | Why | Where it breaks |
|---|---|---|
| CockroachDB is the **sole system of record** | One memory graph is the product | New feature tempted to add its own store |
| **Never delete — mark superseded** (`superseded_by`) | Provenance trail | New write paths inventing delete/overwrite |
| **Propose → confirm → execute** for mutate / spend / third-party | Trust-first | Demo autonomy shortcuts |
| ccloud infrastructure actions: **explicit confirmation, no autonomy exception** | Competitor production incident | Smoothing demos |
| Web generated apps: **opinionated React/TS/Vite/Tailwind** | Generation variance | Multi-framework sprawl |
| Secrets **never** plaintext in WebContainer/client; backend proxy | Platform constraint | "Just pass the key through" |
| Desktop: **Open VSX only, no Marketplace proxy, ever** | Cursor Apr 2025 enforcement | Feature-parity pressure |
| IDE/CLI(/Desktop) inference: **BYOK**; platform features authenticated | Unbounded cost | Platform-paid coding loop without entitlement |
| Public SDK keys: **server-side only** (`allowBrowserApiKey` opt-in only) | Tenant compromise | Shipping `wc_live_` in SPAs |

### Superseded (keep for trail)

| Was | Now | Note |
|---|---|---|
| Desktop UI must be native `ViewPane` + single stylesheet (React webview "reverted") | Desktop ships **React/Tailwind webviews** (`packages/agent-ui` → `agent-ui.js` / `settings-ui.js`) hosted by contrib panes | Spike lesson still valid for *core* chrome; product agent UI is webview. Do not re-litigate without reading `walkcroach-desktop/docs/ARCHITECTURE.md`. |
| Desktop "scaffold / never compiled" | Production-grade Agent Host + Path B + live CRDB/MCP when configured; unsigned preview packaging | STATUS: production-grade; unsigned preview only |
| CLI "no packaging/CI" | `@walkcroach/cli` published; GH publish workflow | — |

---

## 5. Cross-cutting principles

1. **CockroachDB is the sole system of record.**
2. **Never delete, mark superseded** — data rows *and* architecture docs.
3. **Propose, then confirm, then execute** — agent actions *and* production-touching architecture changes.
4. **Disclose the trade-off** — match the team's habit of naming limitations instead of smoothing them.
5. **Lowest capable rung** — for Desktop/IDE: extension API → webview → contrib → core patch → fork (see agentic-ide skill). For platform packages: public SDK → host-local engine → cloud harness — do not collapse layers for neatness.

---

## 6. Known debt and open risks

Carry these into design; re-verify rather than assuming fixed.

**Platform-wide**
- **Dual agent loops** (`agent-engine` vs `agent-harness`) with parallel `AgentEvent` types — intentional split, high drift risk. Shared *contracts* before shared *code*.
- **SDK not first-party baseline yet** — README strategy ahead of imports; memory clients duplicated across four surfaces.
- **Observability incomplete** — memory/creative modules exist; not full SLI/SLO/error-budget coverage across all Lambdas.
- Lambda BFF handlers historically thin on tests relative to engine/harness cores.
- `packages/agent-harness/` empty placeholder confuses layout docs.
- IAM asymmetry (backend pipeline vs web) — re-check current TF.

**Desktop-specific** (see `walkcroach-desktop/docs/STATUS.md`)
- Nested `vscode/` gitignored by parent; substantial fork code can be **untracked** in nested git — CI/parent do not fully capture product surface.
- Upstream sync workflow skew (historically clones older tag than product pin).
- Approvals/fleet hardening debt; CRDB live when configured; signing/auto-update deferred (unsigned preview).
- Protocol hand-mirror between `agent-ui` and contrib.

**SDK / go-to-market**
- No `publish-sdk` workflow; `sdk-host` depends on private `file:../agent-engine`.
- No developer portal; key minting exists on API but product UX for external developers is incomplete.
- MVCC time-travel window (~25h `gc.ttlseconds`) is a product constraint to disclose, not hide.

**Documentation risk**: status markers and master docs lag code. Prefer verification.

---

## 7. The five evaluation criteria

| Criterion | What it asks |
|---|---|
| **Agentic Memory Design** | Is CockroachDB a real memory layer — state, embeddings, context, transactional data — or decorative? |
| **Technical Implementation** | Quality of vector index, MCP, ccloud, HostAdapter hosts, and safe tool use? |
| **Real-World Impact** | Would this change a real workflow, or only impress technically? |
| **Production Readiness** | Secure, observable, scalable? Failure designed for? |
| **Creativity & Originality** | Novel insight into agentic systems, or a familiar app with an agent bolted on? |

---

## 8. How this team works

- Research precedes building; plans change when research contradicts them.
- Reversals are recorded, not hidden (see superseded table).
- Spikes gate commitments.
- Honest scope / descope under deadline pressure.
- Verified vs inferred is tracked explicitly — keep doing this.
