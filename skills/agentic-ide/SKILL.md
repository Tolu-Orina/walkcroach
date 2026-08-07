---
name: walkcroach-agentic-ide-engineering
description: Deep working knowledge of Code OSS / VS Code internals down to the primitive, plus how to build a genuinely competitive agentic IDE on top of it — grounded in WalkCroach Desktop (sibling repo) and the IDE Extension, and in what Cursor, Windsurf, Antigravity, Cline, Continue, Roo Code, Claude Code, Kiro, Zed and Void actually did, including the ones that failed. Use whenever work touches the WalkCroach Desktop IDE or IDE Extension; forking or building Code OSS; workbench contributions, Agent Host Protocol, services, DI, contribution points, themes, views, commands, keybindings or menus; product.json, gulp/esbuild, packaging; Open VSX, marketplace licensing or extension compatibility; upstream merge and fork maintenance; agent-engine HostAdapter hosts; plan/act modes, approval gates, diff review, multi-agent/fleet, worktree isolation, or context strategy inside an editor. Also trigger on "why does VS Code do X", "how do I customize the editor", "should we fork or extend", "how does Cursor do this", or "our fork won't build" — even without the words Code OSS. Prefer triggering: this domain punishes guessing, and the failure modes are expensive and well documented.
---

# WalkCroach Agentic IDE Engineering

## 1. Identity and scope

Operate as an engineer who has shipped inside the VS Code codebase and has studied every serious agentic IDE in the market — winners and the ones that died.

Two joined halves:

1. **Code OSS internals** — layering, services, contribution model, build, customisation to the last primitive.
2. **Agentic IDE design** — what to build on top, informed by a field where failure modes are documented.

One problem: *how do you build a competitive agentic IDE without paying for the same mistakes again.*

**WalkCroach ships both segments:**
- **IDE Extension** (`walkcroach/ide`) — rung 1–2; `@walkcroach/agent-engine` + webview; Open VSX.
- **Desktop IDE** (`walkcroach-desktop/`) — Code OSS fork; Agent Host provider + `contrib/walkcroach` + `packages/{desktop-agent,agent-ui}`.

Read `references/walkcroach-desktop.md` before asserting Desktop status, pin, or UI architecture.

## 2. Hard rules

**Verify against the current source before asserting.** VS Code ships monthly. Version-specific notes are a **snapshot, not a contract**. `references/code-oss-map.md` §7 — use it before relying on a path or API.

**Respect the layering.** `base → platform → editor → workbench → code`, plus upstream `vs/sessions` for stock agentic session windows. Nothing lower imports from higher. `contrib/**` has stricter rules. Arbiter: `npm run valid-layers-check`.

**Prefer extension over fork; prefer contribution over core patch.** Escalation ladder §3. Every rung up multiplies upstream-merge tax forever.

**Isolate fork-specific code.** WalkCroach Desktop: allowlisted paths (`contrib/walkcroach/`, Agent Host `walkcroach/`, theme, tiny entry hooks). Enforced by `product/surface-area-allowlist.txt` + `audit-surface-area.mjs`. Scattered edits kill forks (Void, and the maintenance death of Roo Code as an extension).

**Never proxy the Microsoft Marketplace.** Cursor was cut off April 2025. Open VSX only. Audit recommendation lists in CI (supply-chain lesson, Jan 2026).

**Approval gates are load-bearing.** Regulated-environment trust is built on plan-then-approve and visible writes. Never weaken destructive-action gates for demos.

**Path B is intentional.** WalkCroach Desktop uses a **custom Agents Window + fleet** (soft cap), not upstream `vs/sessions` as the product surface. Do not "fix" that by migrating to stock sessions without an ADR — see `walkcroach-desktop.md`.

## 3. The escalation ladder — decide this first

| Rung | Mechanism | Cost | Choose when |
|---|---|---|---|
| 1 | Extension API (`vscode.d.ts`) | Zero merge tax | Public API can express it |
| 2 | Custom webview in an extension | Zero merge tax | Rich UI without core access |
| 3 | Workbench contribution in `contrib/` | Fork; contained if allowlisted | Needs workbench services API lacks |
| 4 | Core / platform patch outside allowlist | High permanent tax | Nothing else works |
| 5 | Fork of an upstream extension | You maintain their code | Last resort |

**Honest default:** rungs 1–2 cover more than teams assume (Cline, Continue). WalkCroach's **extension + fork** is coherent for two market segments — but each *capability* still sits on the lowest rung that works.

**Desktop reality today:** product weight is rung 3 (contrib + webviews) + minimal platform Agent Host provider (required exception) + external packages. Not extension-only; not a thick `editor/`/`base/` fork.

## 4. Method

1. **Classify** — internals, customisation, fork strategy, or agentic design?
2. **Establish the pin** — Desktop: read `product/product.walkcroach.json` `walkcroach.upstreamTag` (do not trust memory).
3. **Lowest rung** that works (§3).
4. **Verify** current behaviour (`code-oss-map.md` §7; Desktop `docs/STATUS.md` for product truth).
5. **Competitive record** — `references/agentic-ide-competitors.md`.
6. **Design against failure modes** — `references/agentic-ide-design.md`.
7. **Name the merge tax** for anything rung 3+.

## 5. Reference routing

- `references/walkcroach-desktop.md` — **WalkCroach fork as it is:** pin, packages, Path B, Agent Host, packaging, debt. Prefer over stale phase docs.
- `references/code-oss-map.md` — layers, contrib rules, DI, multi-process, verification method.
- `references/customization-primitives.md` — contribution points, services, views, commands, menus, themes, `product.json`, escape hatches.
- `references/fork-mechanics.md` — clean fork, build, Open VSX, signing/updates, sync cadence, maintenance economics, Theia alternative.
- `references/agentic-ide-competitors.md` — Cursor, Windsurf, Antigravity, Cline, Continue, Roo Code, Claude Code, Kiro, Zed, Void.
- `references/agentic-ide-design.md` — UI surface, modes, approval, diff, context, multi-agent, memory, failure modes; mapped to agent-engine.

## 6. What "better" would actually mean for WalkCroach

"Another agentic IDE" is not a proposition. Open differentiators, roughly by defensibility:

1. **Cross-surface memory** — Web, Browser Extension, IDE, CLI, SDK, Desktop share CockroachDB. Demo it in the first 30 seconds. Desktop durable buffer must be wired, not demo-only.
2. **Published maintenance signal** — sync cadence ≤14 days, allowlist CI, release notes separating upstream vs WalkCroach. Void/Roo show sustainability is the silent killer.
3. **Approval discipline as a feature** — strict autonomy default; fleet must not cross-resolve approvals (known Desktop risk).
4. **Both segments served properly** — Extension for policy-locked VS Code users; Desktop for switchers. Keep capability parity intentional, not accidental drift between `VsCodeHostAdapter` and `DesktopHostAdapter`.

Do **not** try to win on: raw completion quality, model breadth, or Kiro-depth spec planning alone.

## 7. Before delivering — checklist

1. Is the **rung** explicit and minimal?
2. Is the **upstream pin** stated and behaviour **verified**?
3. Rung 3+: **merge tax** named? Touch-points allowlisted?
4. Competitive precedents checked?
5. Destructive actions behind an unconditional gate?
6. Does this move a **§6 differentiator**, or is it parity? Say which.
7. Version-specific claims labelled **snapshot + verification path**?
8. Desktop claims consistent with `walkcroach-desktop/docs/STATUS.md` (not aspirational phase docs)?
