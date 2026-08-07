# Agentic IDE Competitors

> Field notes for design decisions — not a hype roundup. Verify install counts and project status before citing as current fact; several moved fast in 2025–2026.

## Contents
1. Forks vs extensions vs terminal
2. Players
3. What worked
4. What failed or died
5. Market segments (why WalkCroach ships both)
6. Implications for WalkCroach

---

## 1. Forks vs extensions vs terminal

| Approach | Examples | Upside | Tax |
|---|---|---|---|
| **Code OSS fork** | Cursor, Windsurf, Antigravity, Kiro, Void, WalkCroach Desktop | Deep UX, Agent Host, product control | Upstream sync forever; Marketplace forbidden |
| **Extension in stock VS Code** | Cline, Continue, WalkCroach IDE | Zero merge tax; corporate VS Code lock-in | API ceiling; webview limits |
| **Terminal-native agent** | Claude Code, WalkCroach CLI | Autonomy, scripting, headless CI | Weaker visual diff/fleet UX unless paired with an editor |
| **Non-VS editor** | Zed | Performance, clean sheet | Extension ecosystem rebuild |

## 2. Players (snapshot characterisations)

| Product | Shape | Notable bet |
|---|---|---|
| **Cursor** | Fork | Agent + Composer; multi-model; paid cloud. Marketplace proxy → enforcement pain (Apr 2025). |
| **Windsurf** | Fork | High autonomy cascade; criticised when trust eroded. |
| **Antigravity** | Fork | Google-adjacent ecosystem; Open VSX realities apply. |
| **Cline** | Extension | Plan-then-approve; strong regulated-env reputation; large install base. |
| **Continue** | Extension | Open, customisable; hub for bring-your-own models. |
| **Roo Code** | Extension (Cline fork) | Explosive growth then **archived May 2026** — sustainability failure, not a feature failure. |
| **Claude Code** | Terminal (+ IDE adjuncts) | Hooks, worktrees, uniform tool pipeline, subagent isolation — architecture reference even if UX differs. |
| **Kiro** | Fork / AWS orbit | Spec-driven planning depth. |
| **Zed** | Native | Speed; agent features without Electron. |
| **Void** | Fork | Privacy / direct providers; **maintenance freeze** — cautionary tale. |

## 3. What worked

- **Approval as product**, not friction (Cline).
- **Host-agnostic agent core** behind thin adapters (WalkCroach agent-engine mirrors this; Claude Code's tool uniformity is the extreme form).
- **Worktree isolation** for parallel agents.
- **Honest extension gallery strategy** (Open VSX + curated recommendations + CI audits).
- **Serving two segments** without pretending one binary fits corporate VS Code policy and power users who will switch editors.

## 4. What failed or died

- **Marketplace proxying** — legal/ToS and hard enforcement (Cursor, Apr 2025).
- **Unaudited inherited recommendation lists** pointing at missing Open VSX extensions — supply-chain toast installs (disclosed ~Jan 2026 across multiple forks).
- **Maintenance underestimation** — Void frozen; Roo archived despite stars/installs.
- **Autonomy without visible control** — trust regressions (pattern associated with Windsurf critiques).
- **Scattered fork diffs** — unmaintainable upstream merges.

## 5. Market segments

| Segment | Needs | WalkCroach fit |
|---|---|---|
| Cannot leave VS Code / Cursor / Windsurf | Extension, Open VSX or marketplace rules of host | `walkcroach/ide` |
| Will install a dedicated IDE | Deep Agent Host, fleet window, branding | `walkcroach-desktop` |
| Headless / SSH / scripts | CLI | `@walkcroach/cli` |
| Embed memory in own agents | Public SDK / MCP | `@walkcroach/sdk`, `sdk-mcp` |

## 6. Implications for WalkCroach

1. Keep **extension and Desktop** — but share `agent-engine` and memory semantics so features do not fork in behaviour.
2. Publish a **maintenance signal** (cadence, allowlist CI, release notes) — empty market niche.
3. Invest in **cross-surface memory demos**, not another completion-quality arms race.
4. Treat Claude Code's **tool pipeline / worktree / hooks** lessons as design inputs for agent-engine — without abandoning IDE UX.
5. Never reopen Marketplace proxy; keep recommendation audits green.
