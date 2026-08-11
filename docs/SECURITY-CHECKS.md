# WalkCroach security checks (AWS Security Agent)

Living cadence for **threat modeling → full-repo code review → production penetration testing** using [AWS Security Agent](https://docs.aws.amazon.com/securityagent/latest/userguide/how-it-works.html).

**Repo in scope:** `walkcroach` only.  
**Environment:** production only (no separate dev/staging stack).  
**Output policy:** findings only — never auto-apply remediations, auto-PRs, or IDE “apply fix” flows.

---

## Locked decisions

| # | Decision | Reason |
|---|---|---|
| 1 | **Agent Space attaches `walkcroach` only** — not `walkcroach-desktop` | Desktop is a Code OSS fork with large upstream/VS Code surface area. Including it floods the agent with third-party noise and burns budget on junk we do not own. Desktop security stays a separate, human-scoped exercise if needed. |
| 2 | **Pen tests run against production** | There is no staging stack. Wave-1 targets are the live Web app and API hostnames below, under strict rules of engagement. |
| 3 | **Findings only** | Remediations from the agent are advisory artifacts. Humans triage, accept risk, or open intentional fix work. Preserves propose → confirm → execute. |

---

## Cadence (ordered waves)

1. **Threat model** (this brief + repo context) → human accept/reject assumptions  
2. **Full-repo code review** on `walkcroach` → triage register (P0/P1/P2)  
3. **On-demand pen test** against prod Web + API → validated findings only  

Re-run wave 2 on major auth/memory/BFF changes; wave 3 before risky public launches or after material API surface growth. Do not start wave 3 until wave 1 assumptions are accepted.

### Operating rules

1. Do **not** enable Kiro / Claude Security Agent “apply fix” or auto-PR remediations.  
2. Treat generated patches as evidence, not merge candidates.  
3. Log every finding: severity × surface × trust boundary × disposition (`verify` / `false positive` / `accept risk` / `fix planned`).  
4. Pen-test identity: a **dedicated Cognito test user** with disposable memory — never personal admin accounts; rate-limit Bedrock-facing paths; stop on customer-data risk.  
5. Out of Agent Space / auto-scan: `walkcroach-desktop`, nested `vscode/` trees, Marketplace-related paths (N/A).

---

## Production targets (verified)

| Role | Hostname |
|---|---|
| Web portal | `https://walkcroach.rinegansolutions.com` |
| Public API | `https://api.walkcroach.rinegansolutions.com` |
| Chrome API base (clients) | `https://api.walkcroach.rinegansolutions.com/v1` (+ `/chrome/v1/...` BFF paths) |
| Chrome extension ID (prod) | `oljdeopppkgfjeoobgochpddchlhmeaj` |
| Region | `eu-west-2` |

Source: `infra-backend/environments/prod.tfvars`, `chrome/release.env`, `docs/ARCHITECTURE.md`.

---

## Capability map

| Wave | AWS Security Agent capability | Maturity (public) | Input |
|---|---|---|---|
| 1 | STRIDE threat modeling | Preview | **This brief** + `walkcroach` repo |
| 2 | Full-repository code review | Preview | GitHub `walkcroach` |
| 3 | On-demand penetration testing | GA | Prod URLs + auth + this brief |

---

# Threat model brief

Upload this section (or the whole file) to AWS Security Agent as the design / scope pack for wave 1. Label claims: **verified** in repo/tfvars; **inferred** from architecture; **assumed** where noted.

## 1. Product one-liner

WalkCroach is a multi-surface agentic platform: one **CockroachDB** memory graph shared across clients; cloud creative/agent loops on AWS Lambdas; coding loops via `@walkcroach/agent-engine` in IDE/CLI (and Desktop in a sibling repo — **out of this engagement’s code scan**).

## 2. Surfaces in this engagement

| Surface | Path in `walkcroach` | Agent runtime | In wave 2 scan | In wave 3 pentest |
|---|---|---|---|---|
| **Web** (App Builder / chat / projects) | `web/` | agent-harness → `lambda-agent` | Yes | Yes (portal) |
| **Browser Extension** | `chrome/` | agent-harness → `lambda-chrome` | Yes | Partial (BFF/API; not full MV3 host model) |
| **IDE Extension** | `ide/` | agent-engine → `/ide/v1` | Yes | Yes (`/v1` memory/content/keys) |
| **CLI** | `cli/` | agent-engine (bundled) | Yes | Indirect (same `/v1` + auth) |
| **SDK** | `packages/sdk`, `sdk-mcp`, `sdk-host` | HTTP client to `/v1` | Yes | Yes (API key + token paths) |
| **Shared backend** | `infra-backend/` | Lambdas, APIGW, Cognito, secrets | Yes | Yes (API surface) |
| **Desktop IDE** | sibling `walkcroach-desktop/` | agent-engine + Agent Host | **No** | **No** |

Desktop still appears in the **platform** threat picture (same Cognito/CRDB/`source_surface=desktop`) so cross-tenant and token risks stay honest — but the Agent Space must **not** ingest the Desktop/VS Code tree.

## 3. Dual agent loops (do not collapse)

| Loop | Package | Used by | Character |
|---|---|---|---|
| Cloud / creative | `@walkcroach/agent-harness` | Web + Chrome Lambdas | Server-side; CRDB native; connectors; E2B |
| Coding / host-local | `@walkcroach/agent-engine` | IDE, CLI (+ Desktop elsewhere) | HostAdapter; BYOK Bedrock; MCP; local sessions |

`@walkcroach/sdk` is **not** an agent loop — typed HTTP client for `/v1/{memory,content,keys,health}` on the IDE Lambda.

## 4. Trust boundaries

Draw STRIDE on these boundaries, not on folders:

1. **Browser / Web SPA** ↔ CloudFront / Web origin  
2. **Chrome MV3** (sidepanel, content script, service worker) ↔ Chrome BFF (`/chrome/v1`)  
3. **IDE / CLI host process** ↔ IDE BFF (`/ide/v1`, public `/v1`)  
4. **API Gateway + Cognito authorizer** ↔ Lambda BFFs  
5. **Lambdas** ↔ CockroachDB (memory, projects, captures, ledger)  
6. **Lambdas** ↔ Bedrock (Nova / embeddings)  
7. **Lambdas** ↔ Secrets Manager / SSM  
8. **Web builder** ↔ E2B / WebContainer sandboxes (generated app runtime)  
9. **Connectors** ↔ Google OAuth / third-party APIs (propose → confirm → execute)  
10. **Stripe webhooks** ↔ billing / ledger  
11. **SDK API keys** (`wc_live_…`) ↔ `/v1` (server-side only; no browser key by default)

## 5. Auth & identity modes

| Mode | Surfaces | Notes for attackers / reviewers |
|---|---|---|
| Cognito (user pool) | Web, IDE, CLI, Chrome (after upgrade) | Primary human identity |
| Chrome device session → Cognito upgrade | Chrome | Device bearer on `/chrome/*`; upgrade merges captures; dual token (id vs access) for BFF vs SDK |
| PKCE / Web connect | IDE, CLI, Chrome | Prefer over paste-token |
| BYOK Bedrock | IDE / CLI coding loop | Platform features still authenticated |
| API keys `wc_live_…` | SDK / public `/v1` | scrypt-hashed server-side; keys must not mint keys; `allowBrowserApiKey` opt-in only |

**Locked product rules (security-relevant):**

- CockroachDB is sole system of record; **never delete — mark superseded**  
- Mutate / spend / third-party: **propose → confirm → execute**  
- ccloud / infra actions: explicit confirmation, no autonomy exception  
- Secrets never plaintext in WebContainer/client  
- No Microsoft Marketplace proxy (Desktop policy; N/A to this repo scan)

## 6. Data classes

| Class | Examples | Sensitivity |
|---|---|---|
| Account | Cognito sub, email, sessions | High |
| Memory / captures | Project memory, Chrome captures, selections, screenshots | High — cross-surface |
| Page / repo context | Extracted page text, IDE workspace snippets | High |
| Secrets | OAuth tokens, Stripe, device signing keys, profiles keys | Critical |
| Billing | Stripe customer, credits ledger | High |
| Telemetry | Agent/tool events (partial coverage) | Medium |

## 7. Priority threat themes (seed for STRIDE)

Ask the agent to expand these; humans will accept or reject:

1. **Cross-tenant memory** — any path that reads/writes another user’s project/capture via IDOR, confused deputy, or mis-bound `project_id` / workspace link.  
2. **Auth confusion** — Chrome device vs Cognito; id token used where access token required (or reverse); API key privilege escalation.  
3. **Confirm bypass** — connector execute, ccloud, spend, or destructive memory ops without a real propose→confirm gate.  
4. **Sandbox escape / secret exfil** — WebContainer/E2B seeing platform secrets; prompt-injection → tool that exfils.  
5. **Extension over-read** — host permissions, screenshot/capture without grant, XSS into extension origin.  
6. **Public `/v1` abuse** — key leakage, unbounded memory export, cost amplification via Bedrock.  
7. **Webhook / OAuth** — Stripe signature bypass; connector token theft; open redirect on connect flows.  
8. **Supply chain in monorepo clients** — but **not** upstream VS Code (excluded).

## 8. Explicit non-goals / out of scope

- `walkcroach-desktop` and any nested Code OSS / VS Code trees  
- Microsoft Marketplace / Open VSX publishing pipeline hardening (except secrets in this repo’s CI)  
- Generated customer apps’ own end-user auth (product out of scope)  
- Destructive testing that deletes or corrupts **other customers’** prod data  
- Unbounded Bedrock load / credit burn as a “test”  

## 9. Pen-test rules of engagement (prod)

Because there is **no staging**:

1. **Announce window** — time-box the run; know who can halt it.  
2. **Identity** — dedicated Cognito test user; empty or synthetic projects only.  
3. **Allowlist** — `walkcroach.rinegansolutions.com`, `api.walkcroach.rinegansolutions.com` only.  
4. **Deny** — other tenants’ resources; mass email/connector send; production Stripe live charges beyond trivial; DoS.  
5. **Chrome** — prefer API/BFF tests; do not automate mass installs against CWS. Extension ID for CORS/context: `oljdeopppkgfjeoobgochpddchlhmeaj`.  
6. **Stop conditions** — unexpected PII of other users; auth bypass confirmed on shared tenancy; data mutation outside the test account.  
7. **Output** — validated findings + exploit path narrative; **no auto-remediation**.

## 10. Requested agent outputs

### Wave 1 — threat model

1. System overview & trust-boundary diagram (textual is fine)  
2. STRIDE table keyed by **boundary** (§4)  
3. Cross-surface attack paths (Chrome↔Web memory, SDK key↔`/v1`, IDE BYOK vs platform auth)  
4. Open assumptions list (must be human-approved before wave 2/3)

### Wave 2 — code review

Triage buckets:

- **P0** — authz bypass, secret exposure, SSRF to cloud metadata, cross-tenant memory  
- **P1** — injection/XSS with privilege, confirm-gate gaps, insecure defaults  
- **P2** — hygiene / defense-in-depth  

Disposition only — no patches merged from the agent.

### Wave 3 — pen test

Validated findings against allowlisted prod hosts; map each to a wave-1 boundary and wave-2 code area when possible.

---

## Artifacts to keep

| Artifact | Location / owner | Use |
|---|---|---|
| This brief + cadence | `docs/SECURITY-CHECKS.md` | Input to Security Agent; living policy |
| STRIDE report | Agent Space export | Accepted assumptions trail |
| Finding register | Eng (sheet or issues) | `verify` / `FP` / `accept` / `fix planned` |
| Pen-test report | Eng | Prod engagement record |
| Accepted-risk list | Eng | Explicit supersession; never silent |

---

## Setup checklist (Phase 0)

- [ ] Create AWS Security Agent **Agent Space** (prefer `eu-west-2` alignment)  
- [ ] Connect GitHub repo **`walkcroach` only**  
- [ ] Upload this document as the threat-model / design pack  
- [ ] Disable remediation / auto-fix / auto-PR integrations  
- [ ] Create dedicated Cognito pen-test user + synthetic project  
- [ ] Confirm pen-test allowlist and stop conditions with whoever owns prod  
- [ ] Run wave 1 → human gate → wave 2 → wave 3  

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-11 | Initial cadence: walkcroach-only, prod-only, findings-only; threat model brief included |
