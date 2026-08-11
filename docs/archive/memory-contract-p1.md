# Memory contract — P1 completion notes

**Date:** 2026-08-11  
**Phase:** Dual-funnel P1  
**Companion:** [`dual-funnel-messaging.md`](./dual-funnel-messaging.md)

## Public contract (canonical)

| Surface | Path | Auth |
|---|---|---|
| Remember / list / recall / diff / erase / export / import / audit | `/v1/memory/*` | Cognito **or** `wc_live_` API key |
| Keys | `/v1/keys` | Cognito only to mint |
| Health | `/v1/sdk-health` (shared GW: `/sdk-health`) | none |

First-party **project memory UX** (IDE/CLI/Desktop bridges, Web/Chrome project panels) MUST use `@walkcroach/sdk` or `createHostMemoryBridge` → `/v1`.

Kinds: `@walkcroach/memory-contracts` `MEMORY_KINDS` (single source).  
Supersede: `@walkcroach/agent-harness` `writeMemoryEntryDetailed` (single implementation).

## Internal / deprecated

| Path | Status | Removal target |
|---|---|---|
| `GET /ide/v1/memory/entries` | **Deprecated** — IDE list now uses `/v1` via SDK; handler kept for older VSIX | **2026-10-11** |
| `PATCH /ide/v1/memory/entries/:id` | **Internal IDE-only** (in-place edit of `source_surface=ide` rows). Not on public OpenAPI. Prefer remember/supersede for new UX. | **2026-10-11** (migrate UI to supersede or add public PATCH before then) |
| `POST /ide/v1/memory/mirror\|recall\|diff` | Legacy; bridges already on `/v1`. Handlers retained for published extension/CLI compatibility until deprecation window ends. | **2026-10-11** |

## Chrome: Capture Recall vs project memory

| UI | Data path | Branding |
|---|---|---|
| Nav **Captures** / pane **Capture Recall** | `/chrome/v1/recall` (page captures) | Explicitly **not** `/v1/memory/recall` |
| **Saved → Project memory** | `@walkcroach/sdk` → `/v1/memory/*` | Cross-surface project graph |

## APIGW fitness (ops)

Terraform: `infra-backend/modules/apigw-rest/sdk.tf` routes `keys`, `memory`, `content`, `runs`, `sdk-health` → ide Lambda.

```bash
# Against shared stage (paths already under …/v1):
export WALKCROACH_API_URL=https://api.walkcroach.rinegansolutions.com/v1
node scripts/verify-sdk-apigw.mjs

# Against ide-local (:3003):
export WALKCROACH_IDE_URL=http://localhost:3003
node scripts/verify-sdk-apigw.mjs
```

Expect: `/sdk-health` → 200; unauthenticated `/keys` and `/memory/recall` → **401** (not 404).

## Publish

- `@walkcroach/sdk@0.2.1` — tag `sdk-v0.2.1` → `.github/workflows/publish-sdk.yml`
- `@walkcroach/sdk-mcp@0.2.1` — dep `^0.2.1`; tag `sdk-mcp-v0.2.1`

## Developer portal (P2)

In-app at `/app/developer/*`:

| Tab | Job |
|---|---|
| Overview | Stranger quickstart + shared-pool pricing honesty |
| API keys | Scopes, once-plaintext, revoke, `/v1/keys/usage` |
| Docs | OpenAPI table + `/openapi/v1.yaml`, MCP (Claude/Cursor/Codex), FAQ |
| Ops | Live usage, quotas / 429 / Retry-After, status contact |

Keep `web/public/openapi/v1.yaml` in sync with `packages/sdk/openapi/v1.yaml`.

## Golden

`tests/integration/cross-surface-golden.integration.test.ts` — writes+recalls  
`web|chrome|ide|cli|desktop|sdk` under `ALLOW_DEV_AUTH`.
