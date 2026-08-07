# Fork Mechanics

> Forking is mechanically easy and *economically* expensive. The mechanics take a week; the maintenance is permanent. Two credible competitors have already been killed by the second half — see §6.

## Contents
1. The clean fork
2. The build system (in transition)
3. Marketplace and licensing
4. Distribution
5. Upstream sync discipline
6. Maintenance economics
7. The alternative you should have ruled out on purpose

---

## 1. The clean fork

VS Code's source is MIT. What ships as "Visual Studio Code" is that source *plus* Microsoft's `product.json` and branding, built under a separate proprietary licence. Clone the source, replace `product.json`, and you have a clean MIT build with no Microsoft branding or telemetry. That is the entire mechanism — VSCodium is the public reference implementation.

**Steps:**
1. Clone `microsoft/vscode` at a **pinned tag**, not `main`. Record the tag.
2. Add `upstream` as a tracked remote.
3. Replace `product.json` (§4 of `customization-primitives.md`) — including `dataFolderName`, or your fork shares user data with real VS Code.
4. Replace icons and branding assets.
5. Strip telemetry endpoints; default telemetry off.
6. Point `extensionsGallery` at Open VSX.
7. Create the dedicated directories for fork-specific code, and commit an allowlist of permitted upstream touch-points.
8. Build, and record wall-clock time and artifact size as a baseline.

**Step 7 is the one that determines whether this fork is alive in two years.** An enforced allowlist (a script in CI that fails if fork code touches an unlisted upstream file) converts "we should keep changes contained" from an intention into a constraint.

## 2. The build system (in transition)

**Verify which pipeline your pin uses before debugging any build failure.** As of mid-2026 the repo is mid-migration:

- **Legacy**: gulp-based (`build/gulpfile.vscode.ts` and friends). Tasks like `gulp vscode-linux-x64`, `minify-vscode`, packaging tasks per platform. The historical bundling task has been renamed `core-ci-old`.
- **New**: an esbuild-based pipeline in `build/next`. Notably, build scripts there are TypeScript run **directly with node** (`node build/next/index.ts transpile --out out-test`) and are *not* compiled by the main VS Code build. Microsoft maintains `.github/instructions/buildNext.instructions.md` describing it — read that at your pin.

**Practical commands** (verify at pin): `npm install`, `npm run compile` or `npm run watch` for development, `npm run electron` to launch, platform gulp tasks for packaged builds. Native module compilation (`node-gyp`) is the usual source of first-build failures; match the Node version the repo expects.

**Expect long builds.** A full packaged build is minutes, not seconds. Budget CI time accordingly, and don't put a full build in a pre-commit hook.

## 3. Marketplace and licensing

The hard constraint, and the one with a live enforcement precedent.

- Microsoft's Marketplace Terms restrict use to Microsoft's own in-scope products and **explicitly prohibit alternative products built on a fork**.
- **This is enforced.** In April 2025 Cursor — which had been reverse-proxying requests to the official Marketplace — had proprietary extensions (C/C++ Tools, Pylance, C# DevKit, Remote Development) stop working in non-Microsoft editors. Their CEO confirmed the cause publicly.
- **Open VSX** (Eclipse Foundation) is the sanctioned alternative and the de-facto standard across every serious fork: Cursor, Windsurf, Antigravity, Kiro, VSCodium. It reached v1.0 in 2026 with Google as a strategic sponsor.
- **Open VSX has fewer extensions.** Plan for the gap: bundle what you can as built-ins, publish missing ones you depend on, and disclose the rest in-product rather than letting installs fail silently.

**The January 2026 supply-chain lesson.** Cursor, Windsurf, Antigravity and Trae were all found shipping VS Code's inherited extension-*recommendation* list — which points at extensions that exist on the Microsoft Marketplace but **not** on Open VSX. An attacker could register those names on Open VSX and get recommended to users via toast notifications, with no search or scrutiny involved. All four fixed it after disclosure; Eclipse also tightened registry protections.

**The permanent fix**: never ship an inherited, unaudited recommendation list. Validate every recommended extension for existence and verified publisher against your actual registry, **in CI, continuously** — not as a one-time audit. This is a fitness function, and it's the single cheapest security win available to a fork.

## 4. Distribution

- **Code signing and notarisation are non-negotiable.** Unsigned builds trigger Gatekeeper/Defender warnings that measurably kill installs. macOS notarisation requires a Mac in CI (GitHub Actions macOS runners or equivalent) plus an Apple Developer Program membership — **start procurement early**, it has lead time.
- **Auto-update**: `electron-updater` is the category standard — differential updates, staged rollouts, GitHub Releases or a custom update server.
- **A failed update must never brick the app.** Verify integrity before applying; roll back automatically on failure.
- **Release notes should separate upstream-absorbed changes from your own.** This makes the maintenance work visible rather than invisible, which matters for §6.

**Electron budgets** (achievable, worth tracking as regressions): cold start under ~2s to interactive; idle memory ~150–300MB; a large workspace at VS Code's own scale runs 1–2GB. "Electron is slow" is a statement about undisciplined apps — VS Code itself is the counterexample — but the discipline has to be maintained per release, not proven once.

## 5. Upstream sync discipline

The activity every fork underestimates.

- **Fixed cadence, named owner.** No longer than every two weeks during active development. Ad-hoc merging is how forks fall six months behind and then never catch up.
- **Scripted, not manual.** A documented merge procedure that anyone on the team can run.
- **Track fork surface area as a metric.** Lines changed outside your allowlisted directories, reviewed quarterly. Growth here is the leading indicator of an unmaintainable fork.
- **Triage upstream bugs away from your backlog.** Add "does this reproduce in stock VS Code / VSCodium?" to the issue template. Inherited bugs are not yours to fix.
- **Report the cadence as an engineering health metric**, not a background chore. What isn't measured here decays silently.

## 6. Maintenance economics — the part that kills forks

Consultancies with repeated fork experience describe the same pattern: forks feel manageable at first *because the areas you've customised haven't collided with upstream churn yet*. That's a false signal. VS Code ships fast, and once collision starts, effort becomes unpredictable — you don't control or get advance notice of upstream changes.

**Two dated casualties, both instructive:**

- **Void** — MIT-licensed, privacy-first, direct-to-provider model routing, genuinely well received. Paused active development mid-2025. As of mid-2026 it's described as "frozen in time": last meaningful commit August 2025, no upstream security patches, breaking compatibility as model APIs move. The team was candid that ongoing maintenance was the reason.
- **Roo Code** — not a fork but an extension, and it still died: forked from Cline in early 2024, reached 23,800+ stars, 1.55M installs and 300+ contributors by March 2026 — then **shut down May 15, 2026, repository archived read-only.** Growth and community were not enough.

**The lesson generalises past forking**: sustainability in this category is a real, non-obvious risk, and *nobody publishes a signal about it*. A tracked, published maintenance commitment is cheap and genuinely differentiating (see the parent SKILL.md §6).

## 7. The alternative you should have ruled out on purpose

**Eclipse Theia** is a vendor-neutral IDE platform built so that deep customisation doesn't require forking. It supports VS Code extensions natively, uses the same standards (LSP, DAP, Monaco), and ships open equivalents for exactly what forking loses: Open VSX for extensions, Open Collaboration Tools in place of Live Share, CDT Cloud for C/C++, built-in remote-container support, and "Theia AI" as a framework for AI-powered tools.

Every drawback in §3, §5 and §6 is one Theia was designed not to have, because customisation happens *with* a shared community rather than in isolation from it.

**Name this explicitly in any fork decision.** WalkCroach chose to fork; that's legitimate. But a fork decision that never considered Theia isn't a decision, it's a default — and the mitigations in §5 exist precisely because forking gives up Theia's built-in protections.

---

## 8. WalkCroach Desktop — apply this file here

Concrete mapping (re-verify pin in `product/product.walkcroach.json`):

| Concern | WalkCroach practice |
|---|---|
| Pin | Recorded in product overlay + nested vscode tag; sync via `scripts/sync-upstream.sh` |
| Allowlist | `product/surface-area-allowlist.txt` + CI audit — treat failures as merge blockers |
| Gallery | Open VSX only; curated recommendations audited |
| Distribution | Interim unsigned Windows portable; signing/auto-update deferred — name the trust cost |
| Agent code | `contrib/walkcroach` + Agent Host `walkcroach/` + `packages/desktop-agent` / `agent-ui` |
| Cadence | ≤14 days; publish sync as a health metric |
| Git risk | Parent gitignores `vscode/`; nested untracked forks files are a **real** maintenance hazard — STATUS before claims |

Full product map: `references/walkcroach-desktop.md`.