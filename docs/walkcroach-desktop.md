# WalkCroach Desktop

**Repo:** sibling `walkcroach-desktop/` (Code OSS fork)  
**Detail docs (in that repo):** `docs/ARCHITECTURE.md` · `docs/STATUS.md` · `docs/SHIPPING.md`  
**As of:** 2026-08-07 · Written from **codebase review**, not legacy phase plans

This is the **only** Desktop product doc in the `walkcroach/` monorepo. Older Desktop plans/PRDs under `docs/walkcroach-desktop-*.md` are retired.

---

## 1. What Desktop is

The sixth WalkCroach surface: a **forked VS Code / Code OSS** that runs `@walkcroach/agent-engine` inside the upstream **Agent Host** (AHP), with WalkCroach UI under `contrib/walkcroach/`.

| Shares with IDE / CLI / Chrome | Does not |
|--------------------------------|----------|
| `@walkcroach/agent-engine` | Renderer importing the engine or AWS SDK |
| BFF `/ide` (auth, projects, memory) | Microsoft Marketplace gallery |
| `source_surface=desktop` on memory writes | Signed general release (yet) |

Pinned upstream today: **vscode `1.131.0`** @ `3a03d6f72…`, Electron **42.7.0**, Node **24.18.0** (see Desktop `product/product.walkcroach.json`).

---

## 2. Architecture in one page

```text
agent-ui / settings-ui (webview)
        → WalkCroachAgentService + AgentBridge (workbench)
        → WalkCroachAgent (Agent Host process)
        → @walkcroach/desktop-agent  (dist/ or engine-bundle.cjs)
        → @walkcroach/agent-engine runAgentLoop
```

Hard rules:

- Renderer never imports `@walkcroach/agent-engine`.
- Agent Host provider never imports `workbench/`.
- Fork edits stay on the Desktop surface-area allowlist (`platform/agentHost/node/walkcroach/**` is the intentional platform exception).

**Agents Window = Path B:** WalkCroach fleet UI on Agent Host. Microsoft `vs/sessions` / Copilot Agents Window stays disabled (`chat.agent.enabled` false). Title-bar “Agents Window” opens WalkCroach’s editor pane.

---

## 3. What works today

| Area | State |
|------|--------|
| Agent Chat / Plan / Agent modes → Bedrock turns | ✅ (needs Bedrock API key) |
| Approvals / questions | ✅ |
| Fleet tabs/grid, soft cap 6 + force, worktree tools | ✅ |
| Session survival (UI + disk transcript; AHP URI reattach) | ✅ |
| Settings editor (WalkCroach) | ✅ |
| Memory pane + online `/ide` when Cognito+project linked | ✅ |
| Open VSX-only gallery, telemetry off | ✅ |
| Graphite Lumen theme + branding assets | ✅ |
| Engine packaging for release (`engine-bundle.cjs`) | ✅ |
| Unsigned Windows Setup.exe (7z SFX) + zip tooling | ✅ |
| Stable CloudFront download (`infra-web` desktop-releases) | ✅ module; upload via `publish:desktop-cdn` |

---

## 4. What does not work / is demo

| Area | State |
|------|--------|
| CockroachDB Schema / Query / ccloud panels | Demo fixtures — not live MCP |
| Skills aux list | Demo content |
| Durable offline memory buffer | Code present, **not wired** into product path |
| Secrets file encryption | **Plaintext** `secrets.json` mirror today |
| Terminal prefer-hook from Agent Host | Unwired (Node spawn fallback in adapter) |
| Chat fork / model switch on provider | Stubbed |
| PKCE Cognito | Paste-token auth |
| Auto-update from CDN | URL reserved; CloudFront not in TF yet |
| Code signing / notarization | No budget — unsigned preview only |
| First public GitHub Release | Operator still needs to run package + publish |
| Full zip build on GitHub Actions | Blocked: nested `vscode/` not in parent git |

See Desktop `docs/STATUS.md` for bugs (double event emit risk, approval fan-out across fleet slots, CI pin skew, dead native chat pane, etc.).

---

## 5. Relation to this monorepo

| Path | Role |
|------|------|
| `walkcroach/packages/agent-engine` | Engine Desktop loads (`file:` dep from `desktop-agent`) |
| BFF `/ide/v1/*` | Auth, link, memory used by Desktop when configured |
| `walkcroach-desktop/packages/desktop-agent` | Fourth HostAdapter host (with IDE extension, CLI, …) |
| `walkcroach-desktop/packages/agent-ui` | Desktop-only React chrome |

Do **not** reintroduce a “Desktop IDE plan” tree here. Implementation detail and shipping runbooks stay in `walkcroach-desktop/docs/{ARCHITECTURE,STATUS,SHIPPING}.md`.

---

## 6. How to dogfood

From a machine with nested `vscode/` and this repo as sibling:

```bash
cd walkcroach-desktop
npm run apply:product
# compile vscode + build desktop-agent / agent-ui (see SHIPPING.md)
npm run package:windows-portable   # zip + Setup.exe (needs 7-Zip SFX)
npm run publish:desktop-cdn -- --env=dev
```

End-user preview install (unsigned Windows Setup.exe): Desktop `docs/SHIPPING.md` §5.

---

## 7. Explicit non-claims

- Desktop is **not** a signed production installer.
- Desktop CRDB panels are **not** a live cluster console yet.
- Desktop is **not** “Phase F complete / done forever” — STATUS lists hardening debt.
- Hackathon / master docs must not call Desktop “shipped” unless a preview Release exists and wording matches unsigned policy.
