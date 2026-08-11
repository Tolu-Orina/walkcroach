# WalkCroach Desktop — Code Reality

> Prefer this over phase narratives. Sibling repo: `walkcroach-desktop/`. Nested `vscode/` is **gitignored by the parent** and has its own `.git`. Truth sources: `docs/ARCHITECTURE.md`, `STATUS.md`, `SHIPPING.md`, `product/`, `packages/`.

## Contents
1. Topology
2. Upstream pin and cadence
3. Packages and Agent Host
4. Path B (Agents Window / fleet)
5. Escalation reality
6. Relation to `walkcroach/` monorepo
7. Packaging
8. Known gaps (do not paper over)

---

## 1. Topology

```text
walkcroach-desktop/
├── packages/desktop-agent/     # HostAdapter → agent-engine (file: sibling)
├── packages/agent-ui/          # React → agent-ui.js / settings-ui.js
├── product/                    # Overlay, allowlist, curated Open VSX lists
├── scripts/                    # apply-product, audits, sync, package, verify
├── packaging/                  # Release notes, entitlements, dist
├── infra/                      # desktop-update (S3), desktop-crash (Lambda)
├── cadence/                    # Sync checklist, records, conflict stubs
└── vscode/                     # Nested microsoft/vscode @ pin (own git)
    ├── product.json            # Applied overlay
    ├── extensions/theme-walkcroach/
    └── src/vs/
        ├── platform/agentHost/node/walkcroach/
        ├── platform/agentHost/common/walkcroach*
        └── workbench/contrib/walkcroach/
```

## 2. Upstream pin and cadence

| Field | Typical source of truth |
|---|---|
| Tag | `product/product.walkcroach.json` → `walkcroach.upstreamTag` (verify; was **1.131.0**) |
| Electron | Nested `vscode/package.json` + overlay |
| Sync | `npm run sync:upstream` / `:dry`; cadence ≤ **14 days**; `cadence/CHECKLIST.md` |
| Allowlist | `product/surface-area-allowlist.txt` + `scripts/audit-surface-area.mjs` (deny-by-default) |

**Re-verify before acting.** CI workflows have historically lagged the product pin — treat workflow tags as suspect until grepped.

## 3. Packages and Agent Host

### `desktop-agent`
- Fourth HostAdapter host (with IDE, CLI, sdk-host).
- Depends on `@walkcroach/agent-engine` only — **not** `@walkcroach/sdk`.
- Session helpers, worktree `setToolRoot`, IDE BFF memory bridge (`source_surface=desktop`).
- Shipped into the fork as `engine-bundle.cjs` (~2 MiB) and/or monorepo `dist/`.

### `agent-ui`
- React/Tailwind/Motion IIFE webviews. Protocol v2: modes `chat|plan|agent`, phases `gather|act|verify`, approvals, fleet.
- Hand-mirrored types in contrib `walkcroachAgentProtocol.ts` — **drift risk**.

### Agent Host
- Provider id `walkcroach`, registered first in `agentHostMain.ts`.
- Mode codec `__WC_MODE__{chat|plan|agent}__` → engine `plan` vs `full`.
- Approvals via AHP + `wc-approve:` / RPC search.
- Stock Chat suppressed; Microsoft Agents Window title-bar path disabled in favour of Path B.

## 4. Path B (Agents Window / fleet)

WalkCroach does **not** productise upstream `vs/sessions` as the primary multi-agent UX. Path B = WalkCroach Agents Window editor + aux Agent webview + fleet soft cap (typically **6**) + force.

When designing session/fleet features, extend Path B and the bridge — do not silently reintroduce stock Chat/session UX unless an ADR reverses Path B.

## 5. Escalation reality

| Rung | Desktop |
|---|---|
| Extension API | Almost unused for the agent product (theme is builtin extension) |
| Webviews | Heavy — agent-ui / settings-ui in contrib panes |
| Workbench contrib | Primary product layer |
| Platform patch | Minimal: Agent Host provider + codecs + entry imports |
| Thick core fork | Avoided; allowlist forbids casual `platform/**` / `editor/**` |

**Supersession note:** An earlier platform decision preferred native ViewPane CSS over React webviews. Current product **does** ship React webviews for agent/settings. Core chrome still binds `--vscode-*`. See EA `walkcroach-context.md` superseded table.

## 6. Relation to monorepo

| Artifact | Consumed? |
|---|---|
| `packages/agent-engine` | Yes |
| `packages/sdk` / sdk-mcp / sdk-host | No |
| `/ide` BFF | Yes when Cognito + project linked |
| `ide/VsCodeHostAdapter` | Parallel host, not imported |

Memory "baseline" for Desktop is still the IDE BFF + engine bridges, not the public SDK client.

## 7. Packaging

- Interim: **unsigned Windows portable** zip; `quality: insider`.
- Open VSX gallery; `marketplaceProxy: false`; telemetry off.
- `updateUrl` / crash infra exist as Terraform stubs; product crash endpoint often empty; signing CI gated off.
- Full gulp zip needs nested vscode present; parent CI may not compile the fork.

## 8. Known gaps (STATUS-aligned)

Do not overclaim distribution:

- Skills aux: still **demo content**
- Terminal prefer-hook / chat fork: stubbed or unwired
- Nested vscode **untracked** WalkCroach files vs committed pin — git hygiene is a product risk
- Auto-update / code signing: deferred (**unsigned preview** channel)

**Verdict language to use externally:** "production-grade WalkCroach Desktop IDE on an unsigned preview channel" — parity with other surfaces; **not** dogfood; **not** signed/auto-updating.
