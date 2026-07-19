# WalkCroach Desktop — Product Requirements Document
## (Module 3, evolved: a full VS Code fork, not an extension)

**Companion docs:** `docs/plan1.md`, `WalkCroach_Web_PRD.md`, `WalkCroach_Chrome_PRD.md`, `WalkCroach_IDE_PRD.md` (the VS Code *extension* PRD this document supersedes in scope, not in engineering — see "How this relates to the extension" below)
**Version:** 1.0
**Date:** July 2026

---

## How to read this document

The prior `WalkCroach_IDE_PRD.md` made a binding architecture decision to ship as a true VS Code *extension* (a custom webview sidebar), explicitly ruling out forking because a fork "contradicts 'starting with VS Code' as a zero-migration entry point." The team has since decided to fork anyway, now that the extension is largely built. This document does not pretend that reversal away — it opens with the research on what forking actually costs, names the trade-off plainly, and then scopes the fork properly rather than treating "fork it" as self-explanatory.

**How this relates to the extension:** nothing from the extension work is wasted. The extension's agent engine — the three-phase loop, `WALKCROACH.md` memory, MCP/vector/ccloud CLI/Agent Skills integration — is the thing that gets embedded natively into the fork, no longer constrained by what the VS Code extension API allows. The extension itself doesn't disappear either: it remains the zero-migration, low-commitment entry point for a developer who isn't ready to switch editors, while WalkCroach Desktop (the fork) becomes the fullest expression of the product for developers who are. Section 4 makes this relationship explicit.

---

## 1. Executive summary

### 1.1 What "forking VS Code" actually means, and what it costs

Forking is not a metaphor — it is a specific, well-understood mechanical process, and the research surfaced exactly what it involves and what it has cost every team that has done it:

- **Mechanically, it's cloning `microsoft/vscode` and replacing `product.json`.** VS Code's source is MIT-licensed; what you download as "Visual Studio Code" is that MIT source plus a Microsoft-authored `product.json` (branding, telemetry endpoints, marketplace URL) built under a separate, proprietary Microsoft license. Clone the source, lay down your own `product.json`, and by default you get a clean, MIT-licensed build with none of Microsoft's branding or telemetry — this is literally how the community's VSCodium project works, and it's the reference implementation worth studying before writing a single line of custom code.

- **The cost is not the fork — it's the marketplace and the maintenance, and both are well-documented, not hypothetical.** Microsoft's Marketplace Terms of Service explicitly restrict use to "in-scope products" (Visual Studio, VS Code, GitHub Codespaces, Azure DevOps) and explicitly prohibit "alternative products built on a fork." This isn't a gray area: Microsoft directly enforced it against Cursor in April 2025, breaking several proprietary extensions (C/C++ Tools, Pylance, C# DevKit, Remote Development) after discovering Cursor was reverse-proxying requests to the official Marketplace. Every serious fork — Cursor, Windsurf, Google Antigravity, AWS's own Kiro, VSCodium — now runs on **Open VSX**, the Eclipse Foundation's vendor-neutral alternative registry, which reached v1.0 in mid-2026 with Google as a strategic sponsor. Open VSX is real, growing, and the correct default — but it has fewer extensions than Microsoft's marketplace, and inheriting VS Code's *recommended-extensions* list wholesale caused a **live, disclosed security incident in January 2026**: Cursor, Windsurf, Google Antigravity, and Trae were all found recommending extensions that don't exist on Open VSX, opening a namesquatting attack surface a bad actor could exploit by publishing malware under those exact names. This is a concrete, dated lesson this PRD builds a specific requirement around (NFR-F09).

- **The maintenance burden is the single biggest long-term risk, and it has a real, current cautionary tale.** EclipseSource — a firm that has forked VS Code for multiple client projects — documents the pattern plainly: forks start with a small, contained change (a logo, a panel) and feel manageable, because the areas you've touched happen not to collide with upstream changes yet. That's a false sense of security. VS Code ships fast, and "even minor upstream changes can cause significant maintenance challenges" once your fork has enough surface area. The clearest evidence in the wild: **Void**, a VS Code-forked, privacy-first Cursor alternative, paused active development in mid-2025 after building real traction — the project is not dead, but as of mid-2026 it is, in the words of one independent review, "frozen in time": no upstream security patches, no compatibility fixes as model APIs change, extensions gradually breaking as the VS Code extension API moves on without it. Void's own team was candid that ongoing maintenance was the reason for the pause. This is the fate this PRD is explicitly built to avoid (Section 9, NFR-F12).

- **A genuine alternative exists and deserves to be named, not skipped past.** Eclipse Theia is an open, vendor-neutral IDE *platform* (not a single product) that supports VS Code extensions natively, uses the same underlying standards (LSP, DAP, Monaco), and — critically — was purpose-built so that customization doesn't require forking: no marketplace lockout, no upstream-rebasing burden, shared maintenance across its community. The team has already decided to fork rather than build on Theia; this PRD respects that decision and does not relitigate it, but Section 9's mitigations exist specifically because forking gives up the exact protections Theia would have provided by default.

### 1.2 The honest case for forking anyway

Despite all of the above, forking is a proven, viable path — Cursor (1M+ daily active users, ~$9.9B valuation) and Windsurf (acquired in a ~$2.4B Google/Cognition deal after an earlier OpenAI acquisition attempt) are the two clearest proof points that a well-executed VS Code fork can become a category-defining product, not just a technical curiosity. The reason to fork, matching the reasons every one of these teams gave, is the same reason in `WalkCroach_IDE_PRD.md`'s own Section 2.2 findings about the extension API's limits: **deep, native AI integration — overlay UI, custom panels wired directly into the editor core, an onboarding and account experience that doesn't have to route through a sidebar webview — is only possible once you own the codebase, not the extension surface.** That is the actual justification for this pivot, and this PRD's feature set (Section 7) is built around the specific things that were impossible in the extension and become possible in the fork.

### 1.3 What this PRD commits to differently from a typical fork

Given the maintenance-burden research (Section 1.1), this PRD treats three things as first-class, funded product requirements rather than assumed background work: a **defined upstream-sync cadence and owner** (Section 9, NFR-F12), a **day-one Open VSX-only extension strategy with no reverse-proxy workaround** (avoiding Cursor's 2025 enforcement action, NFR-F07), and an **extension-recommendation audit** so WalkCroach Desktop never inherits the namesquatting exposure disclosed in January 2026 (NFR-F09). These are not optional hardening tasks for later — they are why forks fail, per the research, and are scoped as such.

---

## 2. Deep-dive research: forks, competitors, and what went right and wrong

### 2.1 How forking works, mechanically

| Step | What happens | Reference implementation |
|---|---|---|
| Clone | Clone `microsoft/vscode` at a pinned commit | Every fork studied (Cursor, Void, VSCodium, `opencode-vscode-ide`) does this |
| Rebrand | Replace `product.json` (`nameShort`, `applicationName`, `urlProtocol`, icons, marketplace URL, telemetry endpoints) | VSCodium's build scripts are the clearest public reference |
| Isolate fork-only code | Keep custom feature code in a small number of dedicated directories rather than scattered edits across the codebase | `opencode-vscode-ide`'s pattern — a single `src/vs/workbench/contrib/<product>/` directory for all fork-specific code — is the cleanest example found and directly informs FR-F03 |
| Track upstream | Maintain an `upstream` remote, periodically merge/rebase fork-only work on top of new upstream commits | The activity every reviewed fork underestimates (Section 1.1) |
| Build & distribute | Cross-platform Electron build, code-signed and notarized per OS, distributed via your own updater | Section 2.7 |

### 2.2 The Marketplace problem, in full

Microsoft's Marketplace ToS restricts use to Microsoft's own in-scope products and explicitly bars "alternative products built on a fork." This has three concrete, dated consequences every fork must plan around:

1. **Proprietary extensions stop working outright.** Live Share, Remote Development (Remote-SSH/Containers), C/C++ Tools, Pylance, and C# DevKit are all closed-source and license-restricted to official Microsoft builds. A forked editor cannot offer these at parity without building or sourcing open alternatives.
2. **Reverse-proxying the Marketplace is not a viable workaround — it gets caught and cut off.** Cursor did exactly this (masking requests to Microsoft's Marketplace endpoints) and was directly broken by Microsoft in April 2025 when the specific proprietary extensions stopped functioning in non-Microsoft editors. Cursor's own CEO publicly confirmed the cause and announced a transition to open-source alternatives.
3. **Open VSX is the sanctioned, standard answer — but it is not a drop-in equivalent.** The Eclipse Foundation-run registry has fewer extensions and lower usage than Microsoft's, though it reached v1.0 in 2026 with Google as a strategic sponsor and is now the de facto standard across Cursor, Windsurf, Google Antigravity, AWS Kiro, and VSCodium. Building a good day-one experience means curating and, where necessary, contributing to Open VSX rather than assuming feature parity with the Microsoft Marketplace.

### 2.3 The January 2026 supply-chain lesson (dated, specific, directly actionable)

Independent security research (Koi Security) disclosed in January 2026 that Cursor, Windsurf, Google Antigravity, and Trae all inherited VS Code's built-in extension-recommendation list — which points at extensions that exist on Microsoft's Marketplace but **do not exist on Open VSX** — creating a namesquatting opportunity: an attacker could register those exact extension names on Open VSX and get them proactively recommended to users via toast notifications or software-detection prompts, with no user search or scrutiny involved. All four vendors shipped fixes after responsible disclosure; the Eclipse Foundation also tightened Open VSX's own registry-level protections. **The direct lesson for WalkCroach Desktop:** never ship an inherited, unaudited extension-recommendation list. Every recommended extension must be verified to exist, under a verified publisher, on whichever registry WalkCroach Desktop actually points to (NFR-F09).

### 2.4 The maintenance burden, and Void as the cautionary tale

EclipseSource's direct client experience, published in a widely-cited December 2024 analysis, describes the pattern in blunt terms: forks feel manageable at first because the customized areas happen not to intersect with upstream churn yet; "even minor changes can cause significant maintenance challenges" once they do, and the effort is "unpredictable" because upstream changes are neither controlled nor announced by the forking team. Their conclusion is not "never fork" — it is "understand you are taking on an ongoing, uncapped maintenance obligation, not a one-time engineering task."

Void is the clearest live proof of this risk materializing. It launched as a genuine, well-received privacy-first Cursor alternative (direct-to-provider model routing, no proprietary backend, full VS Code extension/theme/keybinding compatibility) and paused active development in mid-2025. As of mid-2026, independent reviews describe it as "frozen in time": the last meaningful source commit was August 2025, no security patches are landing, compatibility with newer model APIs is not guaranteed, and the honest recommendation from reviewers is to treat it as a reference implementation rather than a daily driver for a team without in-house capacity to maintain their own fork of it. **This is precisely the outcome Section 9's upstream-sync requirement (NFR-F12) exists to prevent** — not through more enthusiasm, but through treating sync cadence as a funded, owned, recurring line of work from week one.

### 2.5 The alternative not taken: Eclipse Theia

Theia is a vendor-neutral IDE *platform*, governed by the Eclipse Foundation, purpose-built so that deep customization — including the kind of overlay-chat, embedded-AI-panel UX that motivates forking in the first place — doesn't require forking at all. It supports VS Code extensions natively, uses the same standards (LSP, DAP, Monaco), and ships with its own open equivalents for the exact things forking VS Code loses (Open VSX for the marketplace, Open Collaboration Tools in place of Live Share, CDT Cloud for C/C++, built-in remote-container support, and "Theia AI" as a framework purpose-built for AI-powered tools). Every drawback named in Sections 2.2-2.4 — marketplace lockout, proprietary-extension breakage, unbounded upstream-maintenance burden — is a drawback Theia was specifically designed not to have, because customization happens *with* a shared community, not in isolation from one. This PRD names this alternative for the record and does not choose it, per the team's stated decision to fork; the mitigations in Section 9 exist precisely because that choice forgoes Theia's built-in protections.

### 2.6 Competitor teardown

| Fork | Origin / status | What it got right | What went wrong / cautionary lesson |
|---|---|---|---|
| **Cursor** | Anysphere, 2023–present; ~1M+ DAU, ~$9.9B valuation | Fastest-growing fork by revenue; kept VS Code's UX/keybindings/extensions nearly 1:1 so migration felt like zero cost; strong multi-model agent (Composer) | Reverse-proxied the Microsoft Marketplace to bypass the ToS restriction; got directly broken by Microsoft in April 2025 when proprietary extensions stopped working — a fully avoidable, self-inflicted risk this PRD explicitly designs against (NFR-F07) |
| **Windsurf** (ex-Codeium) | Rebranded Jan 2025; ~1M users within months; OpenAI acquisition attempt fell through, later acquired (~$2.4B) by Google/Cognition for its team and technology | Pioneered "Cascade"/"Flows" — persistent, session-aware agentic collaboration rather than per-prompt completion; genuinely differentiated agent UX, not just a rebrand | Zero-confirmation autonomous file/command execution by default was flagged repeatedly as a trust/control concern in independent reviews — informs this PRD's approval-gate carryover from the extension PRD (Section 7.4) |
| **AWS Kiro** | AWS's own fork, GA March 2026, official Amazon Q Developer replacement | Spec-driven planning (requirements → design → tasks) before code; deep native AWS/Bedrock integration | A February 2026 production incident (a Kiro-generated change was blamed, likely incorrectly, for an AWS service disruption) became a widely-repeated cautionary headline regardless of fault — the reputational lesson (visible approval gates on anything production-adjacent) is one this PRD already carries from the extension PRD and reinforces here |
| **Void** | MIT-licensed, privacy-first; development paused mid-2025 | Genuinely open, no proprietary backend, direct-to-provider model routing — a real, differentiated value proposition | The maintenance-burden risk (Section 2.4) materialized in full; the clearest evidence that "fork it and keep building" is not a given outcome without dedicated, ongoing investment |
| **Google Antigravity** | Built on the acquired Windsurf team/technology, launched weeks before the Jan 2026 security disclosure | Backed by a major, well-resourced vendor with a credible long-term maintenance story | Was one of the four forks named in the January 2026 Open VSX namesquatting disclosure — proof that even well-resourced forks inherit this exact risk if they don't audit what they ship |
| **VSCodium** | Community project; not a product, a build-script reference | The cleanest possible demonstration of "fork mechanically" done right: minimal deviation, telemetry stripped, MIT-only, Open VSX by default | Not a competitor in the product sense — but the single best technical reference for how WalkCroach Desktop's own build pipeline should work (Section 2.1) |

### 2.7 Runtime: Electron is still the right, proven choice

The research is consistent and current: Electron remains the pragmatic default for a cross-platform, web-stack-team desktop app in 2026, and VS Code itself (~35M monthly active developers) is the strongest possible existence proof that "Electron is slow" is a myth about poorly-optimized apps, not the framework. Cursor made the same choice for the same reason — time-to-market and UI consistency across three OSes beat the last 100MB of RAM savings a Rust-based alternative (Tauri) would offer. Realistic 2026 budgets: 150-250MB idle, 300-600MB with a typical UI loaded, and — specific to an editor at VS Code's own scale — 1-2GB for a large workspace; cold start under 500ms is achievable with disciplined lazy-loading. **Decision:** WalkCroach Desktop builds on Electron, inheriting VS Code's own proven Electron architecture rather than introducing a second runtime migration on top of the fork itself.

### 2.8 Distribution: code signing, notarization, and auto-update

Both macOS notarization and Windows code signing are treated as non-negotiable in 2026 — unsigned apps trigger Gatekeeper/Defender warnings that measurably kill user trust and installs. `electron-updater` is the de facto standard for auto-update: differential updates, staged rollouts, and direct integration with GitHub Releases or a custom update server. macOS signing/notarization requires a Mac in the CI pipeline (GitHub Actions macOS runners or equivalent). This is standard, well-solved infrastructure — the risk is treating it as an afterthought rather than budgeting the CI/CD and Apple Developer Program setup into the initial build plan (FR-F24, NFR-F13).

---

## 3. Product vision

**WalkCroach Desktop is a VS Code fork that stops treating AI as a sidebar guest and makes CockroachDB-backed, cross-surface memory a first-class part of the editor itself — the same agent engine already proven in the WalkCroach IDE extension, now with full native UI control, built on the same Electron foundation that makes VS Code itself trustworthy at scale, and built from day one with the specific, dated lessons of Cursor, Windsurf, Kiro, and Void's own mistakes designed out rather than repeated.**

It does not compete with Cursor or Windsurf on being "another AI-native fork." It competes on the same axis the extension PRD already committed to: memory that survives across WalkCroach Web, Chrome, and now Desktop — and it adds an axis no competitor reviewed has claimed: a publicly stated, funded upstream-maintenance commitment, because the research shows that promise is exactly where forks quietly fail.

---

## 4. Relationship to the WalkCroach IDE extension

| | WalkCroach IDE (extension) | WalkCroach Desktop (fork) |
|---|---|---|
| Install | Into the developer's existing VS Code | Standalone application |
| Commitment | Zero-migration, try-it-now | A deliberate editor switch |
| UI ceiling | Whatever the VS Code extension API allows (webview sidebar) | Full native UI — overlay panels, embedded chat in any view, custom onboarding/account UI |
| Agent engine | Shared | Shared — same three-phase loop, `WALKCROACH.md`, CockroachDB tool integration |
| Ongoing role | Stays the low-commitment entry point; not deprecated | Becomes the flagship surface for developers who want the deepest integration |

Both surfaces are kept alive deliberately: the extension protects the "zero-migration" value proposition the original IDE PRD was right about, while the fork exists specifically for the UI/UX ceiling the extension PRD's own Section 2.2 identified as impossible to clear from inside the extension API.

---

## 5. Target users and personas

### 5.1 Primary persona — "Full-time WalkCroach developer"
A developer whose primary, daily work is inside a WalkCroach-originated project (scaffolded in Web, extended via the extension) who is ready to commit to WalkCroach Desktop as their main editor for the deepest available integration — native CockroachDB schema/data panels, in-editor account and billing UI, and the fullest expression of cross-surface memory.

### 5.2 Secondary persona — "Switching from Cursor/Windsurf"
A developer already comfortable with an AI-native VS Code fork, evaluating WalkCroach Desktop specifically for its CockroachDB-native tooling and cross-surface memory, who will judge onboarding friction and extension-compatibility gaps against the fork they're switching from.

### 5.3 Tertiary persona — "Evaluating CockroachDB's agentic tooling" (hackathon-relevant)
Carried over from the extension PRD's tertiary persona — a developer or judge assessing how deeply and correctly WalkCroach Desktop uses the Managed MCP Server, Distributed Vector Indexing, ccloud CLI, and Agent Skills Repo, now potentially even more visible given native UI (e.g., a real schema browser panel) rather than a sidebar chat transcript.

---

## 6. User journeys

### UJ-F1 — Migration from stock VS Code
Developer downloads WalkCroach Desktop, and on first launch is offered a one-click import of their existing VS Code settings, keybindings, and (where compatible) extensions — directly addressing the "zero-migration-feel" bar Cursor set and that any credible fork must clear.

### UJ-F2 — First-launch extension compatibility check
On import, any extension that depends on a Microsoft-proprietary package (Section 2.2) is flagged clearly, with an open-source alternative suggested where one is bundled or available on Open VSX, rather than silently failing later.

### UJ-F3 — Native AI panel, not a sidebar
Developer opens a project; the WalkCroach agent is available as a first-class part of the editor UI — not confined to a sidebar webview, but capable of overlay presence in the terminal, inline in the diff view, and in a dedicated CockroachDB panel — the concrete payoff of forking named in Section 1.2.

### UJ-F4 — Native CockroachDB panel (MCP-backed)
Developer opens a dedicated CockroachDB panel (schema browser, query runner, audit-log viewer) backed by the Managed MCP Server connection — a native UI the extension's webview constraints made materially harder to deliver well.

### UJ-F5 — Cross-surface memory, now with a native "memory" view
The same `recall_project_memory` capability from the extension PRD, now with a dedicated native panel showing what's been recalled and its source surface (Web, Chrome, extension, or Desktop), addressing the extension PRD's own FR-D16 more richly than a sidebar could.

### UJ-F6 — Extension marketplace (Open VSX, audited)
Developer opens the Extensions view; it points at Open VSX by default, with WalkCroach's own curated, audited recommendation list (Section 2.3's lesson applied directly) rather than an inherited, unverified one.

### UJ-F7 — Auto-update
Developer receives a signed, notarized, differential update via the built-in updater, with release notes and a changelog entry distinguishing "upstream VS Code changes absorbed this release" from "WalkCroach-specific changes," so the maintenance-burden work (Section 9) is visible, not hidden.

### UJ-F8 — Reporting a fork-specific vs. upstream bug
Developer hits a bug; the issue-reporting flow asks whether it reproduces in stock VS Code/VSCodium, routing upstream-inherited bugs away from the WalkCroach team's own backlog and toward the correct owner — a direct, practical mitigation for the "unpredictable effort" problem named in Section 2.4.

---

## 7. Feature set

### 7.1 Fork foundation (the "do it right" baseline, Section 2.1)
- Rebranded `product.json` (name, icons, protocol handler, telemetry endpoints removed/opt-in), built from a pinned upstream commit.
- All WalkCroach-specific code isolated to a small number of dedicated directories (the `opencode-vscode-ide` pattern from Section 2.1), never scattered through upstream files, to keep future rebases tractable.
- A documented, scripted upstream-sync process (not ad hoc), run on a fixed cadence (Section 9).

### 7.2 Native AI integration (the actual payoff of forking)
- Agent presence beyond a sidebar: overlay chat in the integrated terminal, inline agent commentary in the diff/merge view, and agent-editable regions directly in the editor surface — each a UX pattern the extension API blocked, per the extension PRD's own Section 2.2 findings.
- A custom, first-run onboarding flow (account sign-in, project linking) that doesn't have to be squeezed into a webview panel.

### 7.3 CockroachDB-native panels
- A dedicated CockroachDB view: schema browser, query runner (MCP-backed, read-only by default), audit-log viewer — richer than the extension's chat-only MCP interaction.
- A native memory/recall panel (UJ-F5), sourced from the same C-SPANN vector index and `memory_entries` schema already established.
- ccloud CLI actions surfaced with the same explicit-confirmation gate carried over verbatim from the extension PRD (FR-D18) — forking does not relax this.

### 7.4 Extension compatibility and marketplace
- Open VSX as the default and only registry, with no reverse-proxy workaround to the Microsoft Marketplace, ever (Section 2.2's Cursor lesson).
- An audited, WalkCroach-curated extension-recommendation list — every recommended extension verified to actually exist, under a verified publisher, on Open VSX before being recommended (Section 2.3's lesson).
- A clearly surfaced list of known-incompatible proprietary extensions (Live Share, Remote-SSH/Containers, C/C++ Tools, Pylance, C# DevKit) with open-source alternatives suggested where available, rather than a silent failure.

### 7.5 Migration tooling
- One-click import of settings, keybindings, and compatible extensions from an existing VS Code installation (UJ-F1).

### 7.6 Distribution and update infrastructure
- Code-signed, notarized builds for macOS and Windows; signed packages for Linux.
- `electron-updater`-based auto-update with differential updates and staged rollout.
- Release notes that distinguish upstream-absorbed changes from WalkCroach-specific changes (UJ-F7).

### 7.7 Maintenance and sustainability tooling (funded as a product feature, not background work)
- A scripted, repeatable upstream-merge process, run on a fixed cadence, with a designated owner (Section 9).
- An "is this an upstream bug" triage flag in the issue-reporting flow (UJ-F8).

---

## 8. Functional requirements

### 8.1 Fork foundation
| ID | Priority | Requirement |
|---|---|---|
| FR-F01 | MUST | WalkCroach Desktop shall be built from a pinned `microsoft/vscode` upstream commit with a fully replaced `product.json` (name, icons, URL protocol, telemetry/marketplace endpoints), yielding an MIT-licensed build with no Microsoft branding, consistent with the mechanism documented for VSCodium. |
| FR-F02 | MUST | All WalkCroach-specific source code shall live in a small, defined set of dedicated directories (e.g., `src/vs/workbench/contrib/walkcroach/`), never as scattered edits to upstream files, to keep future upstream merges tractable. |
| FR-F03 | MUST | The repository shall maintain a tracked `upstream` remote pointed at `microsoft/vscode`, with a documented, scripted merge process usable on a recurring cadence (Section 9). |
| FR-F04 | MUST | Telemetry shall be disabled by default, with any opt-in telemetry clearly disclosed and separately toggleable, matching the privacy bar VSCodium and Void both set as baseline expectations for this category. |

### 8.2 Native AI integration
| ID | Priority | Requirement |
|---|---|---|
| FR-F05 | MUST | The agent shall be embeddable as an overlay in the integrated terminal view, not only in a dedicated sidebar panel. |
| FR-F06 | SHOULD | The agent shall be able to surface inline commentary/suggestions directly within the diff/merge view during a review. |
| FR-F07 | MUST | First-run onboarding (account sign-in, project linking) shall use native application UI, not a webview constrained to extension-panel dimensions. |
| FR-F08 | MUST | The three-phase agent loop, approval-gate model, and `WALKCROACH.md` local memory file from the extension PRD (FR-D01-FR-D10) shall carry over unchanged in behavior, only with a richer native UI. |

### 8.3 CockroachDB-native panels
| ID | Priority | Requirement |
|---|---|---|
| FR-F09 | MUST | A native CockroachDB panel shall provide schema browsing and read-only query execution via the Managed MCP Server, consistent with the read-only-by-default, audit-logged posture already required in the extension PRD (FR-D11-FR-D13). |
| FR-F10 | MUST | A native memory/recall panel shall display `recall_project_memory` results with their originating surface (Web, Chrome, extension, or Desktop) visibly labeled. |
| FR-F11 | MUST | ccloud CLI actions initiated from any native panel shall require the same explicit per-action confirmation as the extension (FR-D18), with no autonomy-mode exception, carried over without weakening. |

### 8.4 Extension compatibility and marketplace
| ID | Priority | Requirement |
|---|---|---|
| FR-F12 | MUST | WalkCroach Desktop shall point to Open VSX as its default and only extension registry; no reverse-proxy or workaround to the Microsoft Marketplace shall be implemented, at any point, regardless of feature-parity pressure. |
| FR-F13 | MUST | Every extension in WalkCroach Desktop's own curated recommendation list shall be verified — at build time and on a recurring schedule thereafter — to exist, under a verified publisher, on Open VSX before being shipped as a recommendation, directly preventing the namesquatting exposure disclosed in January 2026. |
| FR-F14 | MUST | Known Microsoft-proprietary, fork-incompatible extensions (Live Share, Remote-SSH/Containers, C/C++ Tools, Pylance, C# DevKit, and any others discovered) shall be listed explicitly in-product with open-source alternatives suggested where available, rather than allowed to fail silently on install attempt. |

### 8.5 Migration
| ID | Priority | Requirement |
|---|---|---|
| FR-F15 | MUST | On first launch, WalkCroach Desktop shall offer to import settings, keybindings, and Open VSX-compatible extensions from a detected existing VS Code installation. |
| FR-F16 | SHOULD | Any detected extension that is not available on Open VSX shall be flagged during import with a clear explanation, rather than silently dropped. |

### 8.6 Distribution and updates
| ID | Priority | Requirement |
|---|---|---|
| FR-F17 | MUST | Release builds shall be code-signed and notarized (macOS) / code-signed (Windows) / signed (Linux packages) before distribution. |
| FR-F18 | MUST | Auto-update shall use differential updates with staged rollout, consistent with the `electron-updater` pattern established as the category standard. |
| FR-F19 | MUST | Every release's notes shall separately list upstream-VS-Code changes absorbed in that release versus WalkCroach-specific changes. |

### 8.7 Maintenance and sustainability
| ID | Priority | Requirement |
|---|---|---|
| FR-F20 | MUST | An upstream merge shall be performed on a fixed, documented cadence (Section 9), producing a tracked record of what was merged and any conflicts resolved. |
| FR-F21 | MUST | The issue-reporting flow shall include a "does this reproduce in stock VS Code / VSCodium" triage question, routing confirmed upstream bugs to a separate tracking label rather than the WalkCroach-specific backlog. |

### 8.8 Cross-cutting
| ID | Priority | Requirement |
|---|---|---|
| FR-F22 | MUST | All new persistent state introduced by this module (linked projects, native-panel memory views, update-channel preferences) shall be stored in CockroachDB where cross-session or cross-surface durability is required, consistent with the single-system-of-record principle established across all three prior modules. |

---

## 9. Non-functional requirements

### 9.1 Performance
- **NFR-F01 (MUST):** Cold start to an interactive window shall not exceed 2 seconds on reference hardware, in line with the "well-built Electron apps start under 500ms to first paint, under 2s to interactive" benchmark identified in research.
- **NFR-F02 (MUST):** Idle memory usage shall not exceed 300MB for an empty workspace, and shall not regress by more than 20% release-over-release without an explicit, documented justification.
- **NFR-F03 (SHOULD):** A large workspace (the scale VS Code itself is benchmarked at, ~1-2GB) shall not exceed that same envelope without a specific optimization plan.

### 9.2 Security
- **NFR-F04 (MUST):** No secret, credential, or auth token shall be stored in plaintext; the OS-level credential store (Keychain/Credential Manager/Secret Service) shall be used, consistent with the standard already set in the extension PRD.
- **NFR-F05 (MUST):** All release builds shall be code-signed and notarized before public distribution (FR-F17); unsigned builds shall never be distributed as a general release.
- **NFR-F06 (MUST):** Telemetry shall be off by default (FR-F04); any opt-in telemetry payload shall be documented publicly.
- **NFR-F07 (MUST):** No mechanism shall be built, at any time, to proxy or otherwise access the Microsoft Marketplace from a non-sanctioned build — directly codifying the lesson from Cursor's April 2025 enforcement action (Section 2.2/2.6).
- **NFR-F08 (MUST):** MCP write access and ccloud CLI actions shall retain the exact opt-in, per-action-confirmed posture already required in the extension PRD — forking shall never be used as a justification to relax either gate.
- **NFR-F09 (MUST):** The extension-recommendation list shall be automatically, continuously validated against the live Open VSX registry (existence + verified publisher) as part of CI, failing the build if a stale or non-existent recommendation is detected — the direct, permanent fix for the January 2026 namesquatting class of vulnerability (Section 2.3).

### 9.3 Reliability
- **NFR-F10 (MUST):** A failed or interrupted auto-update shall never leave the application in an unlaunchable state; the updater shall verify integrity before applying and roll back automatically on failure.
- **NFR-F11 (SHOULD):** A crashed session shall not lose any already-committed local (`WALKCROACH.md`) or CockroachDB-mirrored memory, consistent with the reliability bar already set across every prior WalkCroach module.

### 9.4 Maintainability (the risk this PRD treats as first-class, per Section 2.4)
- **NFR-F12 (MUST):** Upstream merges shall occur on a fixed cadence no longer than every two weeks during active development, tracked against a named owner or rotation, with the health of this cadence itself reported as a standing engineering metric — not an ad hoc, best-effort task, directly designed to avoid the outcome documented for Void (Section 2.4).
- **NFR-F13 (SHOULD):** Fork-specific code shall be kept under a tracked size/surface-area budget (e.g., lines changed outside the dedicated WalkCroach directories from FR-F02), reviewed quarterly, to keep the "false sense of security" failure mode named in Section 2.4 visible before it becomes unmanageable.
- **NFR-F14 (COULD):** A documented decision log shall record any point where a fork-specific change was deliberately scoped down or deferred specifically to reduce future merge conflict risk — preserving the reasoning for future maintainers, not just the code.

### 9.5 Compatibility
- **NFR-F15 (MUST):** WalkCroach Desktop shall support the current major release of Windows, macOS, and at least one major Linux distribution family (Debian/Ubuntu-based).
- **NFR-F16 (SHOULD):** Extensions compatible with Open VSX and not dependent on a Microsoft-proprietary package shall install and function without WalkCroach-specific modification, preserving the "feels like VS Code" migration bar Cursor set.

### 9.6 Observability
- **NFR-F17 (MUST):** Crash reports and update failures shall be logged with enough detail to diagnose without requiring opt-in telemetry to already be enabled for a first diagnosis — i.e., a minimum, privacy-respecting crash-report path shall exist independent of the general telemetry toggle.

### 9.7 Cost efficiency
- **NFR-F18 (SHOULD):** Backend services newly introduced for this module (update-manifest hosting, crash-report ingestion) shall follow the existing "scale to $0 idle" principle already locked for the rest of WalkCroach's architecture.

---

## 10. Architecture decisions (binding)

1. **Fork mechanism:** clone `microsoft/vscode` at a pinned commit, replace `product.json`, isolate fork-specific code to dedicated directories — the VSCodium/`opencode-vscode-ide` pattern (Section 2.1), not an ad hoc set of scattered patches.
2. **Runtime:** Electron, inheriting VS Code's own architecture rather than a second migration to Tauri or another runtime (Section 2.7) — time-to-market and cross-platform UI consistency outweigh the marginal resource savings for this product stage.
3. **Extension registry:** Open VSX only, permanently, with no Microsoft Marketplace proxy under any circumstance (Section 2.2, NFR-F07) — this is the single most important decision in this document given Cursor's direct precedent.
4. **Upstream sync:** a funded, cadenced, owned process (NFR-F12), not a background task — the direct, designed answer to Void's fate (Section 2.4).
5. **Extension recommendations:** built and continuously validated in-house, never inherited wholesale from upstream VS Code (NFR-F09) — the direct, permanent fix for the January 2026 disclosed vulnerability class.
6. **Relationship to the extension:** both surfaces stay alive (Section 4) — the fork does not deprecate the lower-commitment extension entry point.

---

## 11. Success metrics

- **Migration friction:** % of first launches that successfully complete a settings/extension import (FR-F15) without a reported compatibility blocker.
- **Maintenance health (the metric no competitor reviewed publishes):** upstream-merge cadence adherence (NFR-F12) and fork-specific surface-area trend (NFR-F13), tracked as an internal, standing engineering KPI, not just a launch-time promise.
- **Security posture:** zero recommended extensions failing the existence/publisher-verification check (NFR-F09) at any point post-launch.
- **Native-integration payoff:** usage rate of native-only surfaces (terminal-overlay agent, diff-view inline commentary, CockroachDB native panels) versus the equivalent sidebar-only interaction in the extension, as direct evidence the fork is earning its cost.
- **Cross-surface adoption:** % of extension users who migrate to Desktop and successfully link an existing project (carrying forward the same metric family from the Web, Chrome, and extension PRDs).

---

## 12. Phasing

| Phase | Scope | Depends on |
|---|---|---|
| **Fork Phase A — Bootstrap** | FR-F01-FR-F04 (clean fork, rebrand, telemetry-off, upstream-tracking scaffolding) | Nothing outside this module |
| **Fork Phase B — Native agent migration** | FR-F05-FR-F08 (agent engine ported from the extension into native UI surfaces) | Phase A; the existing extension's agent engine as the source to port |
| **Fork Phase C — CockroachDB-native panels** | FR-F09-FR-F11 | Phase B; the existing MCP/ccloud CLI/Agent Skills integration from the extension PRD |
| **Fork Phase D — Marketplace and migration** | FR-F12-FR-F16 | Phase A |
| **Fork Phase E — Distribution infrastructure** | FR-F17-FR-F19, NFR-F04/F05 (signing, notarization, auto-update) | Phase A; Apple Developer Program and code-signing certificate procurement, which should start early given lead time |
| **Fork Phase F — Sustainability tooling** | FR-F20-FR-F21, NFR-F12-F14 | Phase A; ongoing from bootstrap, not a later add-on — the cadence should start with the very first upstream merge, not be retrofitted |

Phase F is listed last only because its requirements are cross-cutting; the cadence itself must begin in Phase A, per NFR-F12 — this is the one phase whose *start date*, not just its deliverables, is load-bearing.

---

## 13. Risks

- **The maintenance burden is real and has already ended a comparable project (Void).** This is the top risk in this document by a clear margin. NFR-F12's fixed-cadence, owned-rotation requirement is the direct mitigation; treating it as aspirational rather than tracked is the single most likely way this module quietly fails 12-18 months in, exactly as it did for Void's team.
- **Marketplace/proprietary-extension gaps will be visible to every switching user on day one.** Live Share, Remote Development, and language-specific tooling (Pylance, C/C++ Tools) are genuinely popular; FR-F14's explicit in-product disclosure is a mitigation, not a fix — the gap itself is structural and permanent, not a bug to close.
- **Reverse-proxy temptation under competitive pressure.** Cursor's own precedent shows exactly how this fails; NFR-F07 is written as an absolute, not a default, specifically because "just for now, to close the gap" is the most likely path back to Cursor's April 2025 outcome.
- **Supply-chain trust in the extension-recommendation surface.** NFR-F09's continuous validation is a permanent CI gate, not a one-time audit — the January 2026 disclosure affected four separate, well-resourced forks simultaneously because none of them treated it as an ongoing check.
- **Scope competition with the extension.** Section 4 exists specifically to prevent an implicit "the fork replaces the extension" assumption from creeping in and stranding the extension's zero-migration value proposition; both surfaces need an explicit, continued support commitment, not just a launch announcement for the fork.
- **Electron performance discipline is a per-release habit, not a one-time optimization pass.** NFR-F01-F03's budgets need a regression check in CI, not just a launch-day benchmark, or the "VS Code proves Electron can be fast" argument (Section 2.7) stops being true for WalkCroach's own build specifically.

---

## 14. Out of scope

- Building on Eclipse Theia instead of forking — considered and named explicitly (Section 2.5) as the road not taken; not revisited in this document.
- Full feature parity with Cursor's or Windsurf's entire feature set — WalkCroach Desktop's differentiation is cross-surface CockroachDB memory and native CockroachDB tooling, not matching every feature of either competitor line for line.
- Mobile or web-based versions of WalkCroach Desktop — this module is a native desktop application only.
- Rebuilding Microsoft's proprietary extensions (Live Share, Remote Development, etc.) in-house — FR-F14's disclosure-and-alternative approach is the scoped answer; a from-scratch reimplementation of any of these is a separate, much larger undertaking not committed to here.