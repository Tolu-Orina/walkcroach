# WalkCroach SDK & Platform Packaging

> Implementation guidance for the public SDK, agent-engine, developer portal, and first-party consolidation. Grounded in the Aug 2026 codebase and industry patterns (layered SDKs à la Vercel AI SDK; API-key + meter billing à la Stripe).

## Contents
1. What the packages actually are
2. Recommendation (commit to this layering)
3. Publishing and versioning
4. First-party consolidation path
5. Developer portal
6. Billing and metering
7. Dual-engine strategy
8. Fitness functions / revisit triggers

---

## 1. What the packages actually are

| Package | Public? | Role |
|---|---|---|
| `@walkcroach/sdk` | Intended public | Typed client: `memory`, `content`, `keys`, `health`. Talks `/v1/*` on ide-api. No agent loop. |
| `@walkcroach/sdk-mcp` | Intended public | MCP server wrapping the SDK (list/recall/remember/timeline). |
| `@walkcroach/sdk-host` | Borderline | `SandboxHostAdapter` + `runProgrammatic` → **agent-engine**. Used by ide-api content worker. Depends on private `file:` engine. |
| `@walkcroach/agent-engine` | **`private: true`** | Host-agnostic coding loop (`HostAdapter`, `runAgentLoop`). Consumers: IDE, CLI, Desktop, sdk-host. |
| `@walkcroach/agent-harness` | Internal (infra-backend) | Cloud agent for Web/Chrome. Not the SDK. |
| `@walkcroach/desktop-agent` | Internal (desktop repo) | Fourth HostAdapter host. |

**Verified gap:** web, chrome, ide, cli **do not import** `@walkcroach/sdk`. Only `sdk-mcp` does. "SDK as baseline for other surfaces" is a **strategy**, not current wiring.

---

## 2. Recommendation — commit to this layering

**Do not publish `agent-engine` as "the WalkCroach SDK."** It is a local coding runtime (BYOK Bedrock, FS/terminal tools, worktrees). Shipping it publicly as the flagship SDK forces every consumer into HostAdapter + Bedrock credentials and couples your public API to an internal loop that must stay free to break for IDE/Desktop.

**Do publish `@walkcroach/sdk` (+ `sdk-mcp`) as the public platform product.** That matches what the README already claims: durable cross-surface memory with provenance, time-travel, and portability. That is the moat competitors lack.

Treat packages as layers (same idea as Vercel AI SDK's Spec → Providers → Core → UI):

```text
Public product surface
  @walkcroach/sdk          memory / content / keys
  @walkcroach/sdk-mcp      MCP adapter over sdk

Optional later (gated, separate package name)
  @walkcroach/agent        thin public wrapper IF you ever expose programmatic agents
                           (wraps sdk-host patterns; stable HostAdapter subset;
                            NOT a re-export of every private engine symbol)

Internal (never npm-public without a deliberate product decision)
  @walkcroach/agent-engine
  @walkcroach/sdk-host     (or merge into agent later after bundling engine)
  @walkcroach/agent-harness
  @walkcroach/desktop-agent
```

**For App Builder / Desktop / IDE "baseline":**
- Share **agent-engine** (already done for IDE/CLI/Desktop/sdk-host).
- Share **memory** via `@walkcroach/sdk` (or a thin isomorphic client extracted from it) — **not yet done**.
- Do **not** force Web/Chrome onto agent-engine; they correctly need the cloud harness (creatives, E2B, multi-tenant Bedrock). Converge on **contracts** (memory kinds, event shapes, supersede semantics), not one binary.

**Decision / Ask default:** When someone says "use the SDK as the masterpiece for App Builder," translate to: (1) App Builder keeps harness for the cloud loop; (2) App Builder and all surfaces call the same memory API the SDK exposes; (3) any programmatic agent product is a separate package with an explicit stability contract.

---

## 3. Publishing and versioning

Before first public `npm publish` of `@walkcroach/sdk`:

1. Add GitHub Actions publish workflow (mirror cli/ide/chrome).
2. Freeze a **semver policy**: memory API is the stability boundary; breaking changes = major.
3. Ship OpenAPI (or equivalent) generated from ide-api `/v1` handlers — docs and SDK should not drift.
4. Document retention window (`asOf` / MVCC TTL) in the portal, not only README.
5. Keep `publishConfig.access: public`; ensure LICENSE/NOTICE clear.
6. Do **not** publish `sdk-host` until agent-engine is either bundled into the artifact or published under a deliberate name with a stability promise.

`agent-engine` stays private until there is a paid/support story for "bring your own host." Prefer documenting the HostAdapter interface for first-party hosts over opening the floodgates.

---

## 4. First-party consolidation path

Ordered by leverage / risk:

| Step | Change | Why |
|---|---|---|
| A | Mint + manage keys in **Web settings** (and later portal) | Unblocks external + first-party adopters |
| B | Point IDE/CLI memory bridges at the same handlers the SDK uses (or import `@walkcroach/sdk` server-side) | Deletes duplicate clients; proves SDK |
| C | Chrome/Web memory write/recall paths align on same kinds + supersede rules (already CRDB; ensure API parity) | Cross-surface truth |
| D | Extract shared `AgentEvent` / tool-result DTOs only where both loops need them | Stops silent drift |
| E | App Builder consumes SDK for any *externalizable* memory/content APIs it already exposes | "Baseline" for builder = API identity, not engine swap |

Do not big-bang rewrite harness into engine.

---

## 5. Developer portal

Treat the portal as a **first-class surface** (Web module is fine for v1; separate app later if needed). Minimum viable:

| Capability | Notes |
|---|---|
| Auth | Same Cognito as Web |
| API keys | Create / list / revoke — already on `/v1/keys` (user token only). Show plaintext **once**. Scopes: `memory:read` \| `memory:write` |
| Docs | Quickstart, OpenAPI, MCP install, error taxonomy, retention limits, security (no browser secret keys) |
| Usage | Per-key and per-project recall/remember/content runs; source from ledger + Stripe Meter summaries |
| Billing | Subscribe / top-up credits; map to existing ledger entitlements |
| Playground | Optional: recall/remember against a sandbox project |

**Do not** wait for a perfect portal before publishing the SDK — but **do** ship key management UI + docs before marketing "public SDK," or support load will land on Discord/email.

Admin portal (ops) remains separate: cost, multi-tenant health, abuse.

---

## 6. Billing and metering

WalkCroach already has Stripe + ledger for end-user credits. For **developer API** usage:

1. Record usage in **your** ledger first (source of truth for quotas / 429 `QuotaError`).
2. Emit Stripe **Billing Meter Events** asynchronously with deterministic `identifier` (request id) for idempotency — see [Stripe usage-based billing](https://docs.stripe.com/billing/subscriptions/usage-based).
3. Prefer meters such as `memory_recall`, `memory_remember`, `content_run` with dimensions `project_id` / `key_id` — not raw Bedrock tokens for the memory API (tokens belong to BYOK coding surfaces).
4. If you later sell hosted agent runs (`sdk-host`), meter those separately; consider Stripe token-billing only if you intermediary models (private preview product — verify current Stripe docs).
5. Never put secret platform Stripe keys in the SDK; customers pay you; you pay AWS/Stripe.

Quota failures must remain `QuotaError` with `Retry-After` as the SDK already models.

---

## 7. Dual-engine strategy

| Force | Response |
|---|---|
| Web needs creatives, E2B, multi-tenant inference | Keep harness |
| IDE/CLI/Desktop need local FS, approvals, worktrees, BYOK | Keep engine |
| Drift in tools / events / memory semantics | Shared **contracts** package or OpenAPI + golden tests; not a forced merge |
| "One engine to rule them all" | Reject until a quality-attribute scenario proves the merge pays for itself |

Fitness function: cross-surface integration test continues to pass for remember→recall across `web|chrome|ide|cli|sdk|desktop` source surfaces.

---

## 8. Fitness functions / revisit triggers

- Publish workflow green for `@walkcroach/sdk` and `@walkcroach/sdk-mcp`.
- At least one first-party surface imports `@walkcroach/sdk` for memory (IDE or CLI).
- Portal can create a key and run the README quickstart without tribal knowledge.
- Revisit "publish agent-engine" only if ≥3 external HostAdapter implementers exist or App Builder genuinely needs in-browser HostAdapter (unlikely — WebContainer is not the desktop host).
- Revisit engine↔harness merge if maintaining two Bedrock tool registries costs more than a shared core with two adapters.
  **Quantified (Phase 4 / `docs/ARCHITECTURE.md`):** within one calendar quarter, either (A) ≥3 dual-fix bugs requiring identical fixes in both loops on memory/tool semantics, or (B) ≥500 net LOC changed in *both* packages for the same semantic change. Until then: forever-dual + `@walkcroach/memory-contracts`.
