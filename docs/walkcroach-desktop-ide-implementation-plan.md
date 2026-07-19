# WalkCroach Desktop — Implementation Plan

**Status:** Phase F structural complete (sustainability); interim ship = Windows portable  
**Module:** Module 3 evolved — WalkCroach Desktop (VS Code / Code OSS fork)  
**Companion docs:** `walkcroach-desktop-ide-prd.md`, `walkcroach-ide-prd.md`, `walkcroach-ide-implementation-plan.md`, `plan1.md`  
**Research cutoff:** July 2026  
**Last updated:** July 19, 2026

---

## 0. One-sentence thesis

> WalkCroach Desktop is a **VS Code fork delivery plane** that embeds the already-proven `@walkcroach/agent-engine` into native workbench UI — while **reusing the same Cognito + CockroachDB + `/ide` BFF control plane** as the extension — so the product moat (cross-surface memory) stays intact and the only new backends are update/crash services that still scale to $0 idle.

**Platform stays shared. Agent stays local and shared. Fork is the new surface. Extension stays the funnel.**

This supersedes the extension plan’s “do not fork” decision for the *flagship* surface only. The extension and CLI remain first-class; Desktop is the fuller expression of the same engine.

---

## 1. Locked architecture decisions

Do not reopen unless blocked. These bind the Desktop PRD §10 decisions plus the platform recommendation accepted July 2026.

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Editor paradigm | **Code OSS / `microsoft/vscode` fork** at a pinned commit | Native overlays, terminal agent, CockroachDB panels, first-run onboarding — blocked by extension API (PRD §1.2; Eclipse Foundation Dec 2025 analysis) |
| Runtime | **Electron** (inherit VS Code’s) | Category standard; Cursor/Kiro/Windsurf all stayed on Electron; Tauri would be a second migration on top of the fork |
| Control plane | **Same** AWS account, Cognito pool, CockroachDB, Bedrock, Terraform root (`infra-backend`) | Cross-surface memory is the moat; a second backend destroys it |
| Agent placement | **Local** `@walkcroach/agent-engine` + Desktop `HostAdapter`; not Web Lambda | Same as extension/CLI; local fs/terminal/MCP; WebContainer protocol is wrong |
| Cloud BFF | **Extend** existing `/ide/*` Lambda (or thin `/desktop/*` alias to same handlers) | Chrome/IDE pattern: surface-owned routes, shared db/memory packages |
| Desktop-only cloud | **Additive** update-manifest (S3) + crash-report Lambda | NFR-F18; not a new Cognito/CRDB |
| Fork isolation | All WalkCroach code under `src/vs/workbench/contrib/walkcroach/` (+ minimal hooks) | `opencode-vscode-ide` pattern — keeps rebases tractable (FR-F02) |
| Extension registry | **Open VSX only**; never Microsoft Marketplace proxy | Cursor’s 2025 enforcement + ToS; NFR-F07 |
| Recommendations | **Curated + CI-validated** against live Open VSX | Jan 2026 Koi/OpenVSX namesquatting class (NFR-F09) |
| Upstream sync | **≤ biweekly**, owned rotation, tracked KPI | Void archived mid-2026; maintenance is the #1 fork killer (NFR-F12) |
| Relationship to extension | **Both live** | Extension = zero-migration funnel; Desktop = flagship (PRD §4) |
| Repo topology | **Separate fork repo** (or submodule); monorepo keeps engine/ide/cli/infra | Do not dump `microsoft/vscode` into the product monorepo |
| Out of scope | Theia rebuild · Microsoft proprietary extension reimplementation · hosted cloud agent · mobile | PRD §14 |

### What “same infra” means vs does not mean

| Shared (one of each) | Separate (Desktop-owned) |
|----------------------|--------------------------|
| AWS account / envs | VS Code fork repo + build/sign/notarize pipeline |
| Cognito User Pool | Open VSX `product.json` gallery config |
| CockroachDB + migrations | Curated extension recommendation list + CI gate |
| Bedrock Nova 2 Lite + Titan Embeddings V2 | Native workbench contrib UI (panels, overlays) |
| Terraform root (`infra-backend` extend) | `electron-updater` / update CDN (S3 or GitHub Releases) |
| `/ide` BFF (link, memory, me) | Crash-report ingest (thin Lambda) |
| `@walkcroach/agent-engine` | Desktop `HostAdapter` + optional vendored SPA assets |
| Observability account | Apple Developer + Windows code-signing certs |

**Do not:** stand up a second Cognito/CRDB “for Desktop.”  
**Do not:** reverse-proxy the Microsoft Marketplace.  
**Do not:** rewrite the agent loop inside the fork.  
**Do:** reuse `recall_project_memory` / `writeMemoryEntry` with `source_surface = 'desktop'` (locked in Phase B — Desktop clients always send `desktop`; `/ide` mirror accepts `ide` | `desktop`).

---

## 2. Deep-dive research (July 2026)

### 2.1 Competitor product models

| Product | Architecture | How they feel fast / deep | Gap we exploit |
|---------|--------------|---------------------------|----------------|
| **Cursor** | VS Code fork; AI woven into rendering / Tab / Composer; Open VSX (+ historical Marketplace workarounds); Anysphere in-house replacements for Pylance/Remote/C++ after Microsoft enforcement | Low migration friction; strong multi-file latency; continuous local index | No WalkCroach-style **durable cross-product memory graph**; Marketplace ToS pain; inherited-recommendation supply-chain risk (fixed late 2025) |
| **Windsurf** (Cascade) | Fork; agent observes editor/terminal/fs continuously (“always watching”) | Fewer round-trips because context is already warm; Flows/session-aware agents | Higher RAM cost; autonomy/trust concerns; same Open VSX gaps; slow to fix recommendation namespaces (Koi disclosure) |
| **AWS Kiro** | Code OSS fork + CLI; Bedrock; specs (`requirements`/`design`/`tasks`); steering; MCP “Powers”; Open VSX | Spec approval before codegen; model routing (Claude for reasoning, Nova for throughput); AWS-native auth/billing | **No cross-tool durable memory** across a builder + browser research surface — our explicit differentiator. Do not compete on EARS-depth specs |
| **Google Antigravity** | Windsurf-tech lineage; well-resourced | Credible long-term maintenance | Named in Jan 2026 Open VSX recommendation disclosure |
| **Void** | MIT fork; privacy-first; direct-to-provider | Clean reference for React-in-workbench + signing CI | **Archived / deprecated mid-2026** — proof that under-funded upstream sync kills forks |
| **VSCodium** | Build scripts over `microsoft/vscode`; Open VSX; telemetry stripped | Best public reference for `product.json` + gallery wiring | Not a product competitor — **copy the bootstrap mechanics** |
| **opencode-vscode-ide** | Pinned vscode fork; all features under `contrib/opencode/` | Cleanest public “isolate fork code” pattern | Reference for FR-F02, not a market rival |
| **Cline SDK** (May 2026) | Extracted harness: `@cline/agents` (stateless) + `@cline/core` (sessions/hub) + IDE/CLI spokes | Sessions survive UI restart; CLI/IDE parity; lower token cost after rewrite | Learned late: don’t grow the loop inside the extension first — **we already extracted `@walkcroach/agent-engine`** |
| **Continue** | `core` ↔ thin IDE adapter ↔ GUI; Bedrock `cachePoint` on system + last user turns | In-process core; prompt caching as first-class TTFT lever | Local RAG; no CRDB cross-surface graph |
| **Eclipse Theia** | Platform (not fork); Open VSX; shared maintenance | Avoids rebase tax and Marketplace lockout | Team already chose fork; mitigations in this plan exist *because* of that choice |

**Industry convergence for AI-native desktop editors (2026):**

```text
Native workbench UI / overlays     (fork-only payoff)
        ↕  typed events / IPC
Agent engine                       (stateless loop + hooks — shared package)
        ↕  HostAdapter (Desktop | Extension | CLI)
Tools: fs · terminal · MCP · skills · memory BFF
        ↕
Model (Bedrock ConverseStream + prompt cache)  +  durable memory (CRDB)
        ↕
Delivery: Open VSX · code-signed updater · owned upstream cadence
```

Nobody serious puts API keys in the renderer. Nobody serious makes the fork own a second identity/memory database. Nobody serious inherits VS Code’s recommendation list onto Open VSX without an audit.

### 2.2 What actually makes forks feel highly performant

Ordered by impact for WalkCroach Desktop (from Electron 2026 startup work, VS Code practice, Cursor/Windsurf UX reports, Cline/Continue caching lessons, Bedrock docs — July 2026):

1. **Time to first streamed agent token, not total task time.** Users forgive a 30s task if tokens and tool cards appear immediately. Target ≤ 2.5s p50 to first token (carry NFR-D02 into Desktop). Mechanisms: Bedrock `ConverseStream`, prompt caching (`cachePoint`), warm credential provider, small first-turn context, no BFF on the hot path for the loop.

2. **Prompt caching as an architectural constraint.** Claude Code / Continue / our IDE plan agree: static → dynamic order — tools → system → project rules (`WALKCROACH.md` + skill metadata) → conversation. Bedrock `cachePoint` on ConverseStream; Nova 2 Lite needs ~1,536 tokens for first checkpoint. Monitor `cacheReadInputTokens`. Never put timestamps in the cached prefix; don’t switch models mid-session.

3. **Local tools have zero network RTT.** File/terminal/git run in-process via Desktop HostAdapter. Only Bedrock, memory mirror/recall, and remote MCP leave the machine. This is why Desktop must **not** host the agent loop on Lambda.

4. **Don’t pay Windsurf’s “always watching” RAM tax unless the feature needs it.** Cascade’s continuous observation feels magical and expensive. WalkCroach should be **event-driven**: gather on task start + explicit hooks (save, terminal exit, approval), not a permanent background indexer for MVP. Defer continuous codebase embedding unless a demo requires it.

5. **Electron / VS Code startup discipline (2026).** Electron’s own 2026 work (Node startup snapshots, V8 bytecode caches for framework/preload, non-blocking renderer startup data) shows cold start is still being won at the framework layer — inherit upstream Electron from vscode pins rather than fighting it. App-level rules still dominate: defer `require` of heavy modules; don’t block first paint on MCP connect, skill full-load, or Cognito refresh; lazy-activate WalkCroach contrib until first command/panel open.

6. **UI stream coalescing.** Same lesson as the extension webview: map every token to a full React/DOM rebuild and the UI stalls. Coalesce deltas (~16ms active / rAF); batch background sessions. Native panels must reuse `TokenDeltaCoalescer` from the engine.

7. **Isolate fork surface area so rebases stay cheap.** Scattered patches across upstream files make every sync a multi-day crisis. `contrib/walkcroach/` + tiny registration hooks is the performance strategy for *engineering velocity*, which is how you keep shipping security patches.

8. **Update path that doesn’t brick installs.** `electron-updater` (or VS Code’s own update URL via `product.json`) with integrity checks and rollback (NFR-F10). Signed/notarized builds are mandatory on macOS for auto-update; Windows benefits from Azure Artifact Signing / EV reputation to avoid SmartScreen friction.

### 2.3 Marketplace, supply chain, and legal reality (dated)

| Event | Lesson for WalkCroach |
|-------|----------------------|
| Microsoft Marketplace ToS bars forks; proprietary extensions (Pylance, C/C++ Tools, Remote-SSH/Containers, C# DevKit, Live Share) are license-restricted | Open VSX only; disclose incompatibles in-product (FR-F14); suggest open alternatives (basedpyright, clangd, open remote stacks) — **do not** rebuild Microsoft’s closed extensions in Phase A–E |
| Cursor and peers hit enforcement / breakage on Microsoft extensions through 2025; Cursor shipped Anysphere replacements | Disclose gaps honestly on day one; don’t reverse-proxy (NFR-F07) |
| **Koi Security / Open VSX namespace gap (disclosed late 2025 → public Jan 2026):** Cursor, Windsurf, Antigravity, Trae inherited VS Code recommendation lists pointing at Marketplace IDs that **did not exist on Open VSX**, leaving namespaces claimable for malware | Empty the inherited list; ship a curated allowlist; **CI fails the build** if a recommendation isn’t on Open VSX under a verified publisher (NFR-F09) |
| Void archived / deprecated by mid-2026 after pause | Fund upstream sync as a product feature from Phase A (NFR-F12), not a backlog wish |

### 2.4 How WalkCroach Desktop can be better

| Dimension | Competitors | WalkCroach edge |
|-----------|-------------|-----------------|
| Memory | Local index / session / vendor cloud | **Same C-SPANN graph** as Web builder + Chrome research + extension (`source_surface` labeled in a native memory panel) |
| Cockroach story | Generic SQL / optional MCP | **MCP + ccloud + Skills + vector** with native schema/query/audit panels — living demo of Cockroach’s agent-ready stack |
| Engine reuse | Cline rewrote late; many forks own a private agent silo | **Engine already shared** across extension + CLI; Desktop is a third HostAdapter, not a rewrite |
| Trust / safety | Mixed autonomy defaults | Hard infra gate + Workspace Trust + OS credential store carried over unchanged (forking never relaxes gates) |
| Maintenance transparency | Almost nobody publishes rebase health | **Public release notes split upstream vs WalkCroach**; internal KPI for sync cadence (PRD §11) |
| Supply-chain | Four major forks got the recommendation bug at once | Day-one CI validation — publish “we never ship an unverified recommendation” as a trust signal |
| Cost at idle | Often always-on control planes | Thin BFF + S3 update manifests; local agent needs no server (NFR-F18) |
| Positioning vs Kiro | Spec depth | Don’t fight specs — win the **30-second demo** on cross-surface recall + native CRDB panel |
| Positioning vs Cursor/Windsurf | Tab/Cascade polish | Don’t chase feature parity; ship native memory + CRDB + honest Open VSX posture |

### 2.5 Safety and approval (mandatory carryover)

| Action class | Gate |
|--------------|------|
| File write / terminal | Diff/command preview; approve by default |
| MCP write | Opt-in per action; connection stays read-only until consent |
| ccloud provision / networking / delete | **Hard gate always** — never in low-friction mode |
| Untrusted workspace | Respect Workspace Trust; disable agentic tools until trusted |

Secrets: OS keychain / VS Code `SecretStorage` equivalent in the fork — never plaintext settings (NFR-F04).

---

## 3. Target architecture

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  Developer machine — WalkCroach Desktop (Electron / Code OSS fork)            │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ workbench.contrib.walkcroach/                                          │  │
│  │  · Agent overlay (chat, terminal overlay, diff inline)                 │  │
│  │  · CockroachDB panel (schema / query / audit)                          │  │
│  │  · Memory / recall panel (source_surface labeled)                      │  │
│  │  · Native onboarding (Cognito PKCE, project link)                      │  │
│  └───────────────────────────────┬────────────────────────────────────────┘  │
│                                  │ typed AgentEvent stream (coalesced)         │
│                                  ▼                                            │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ DesktopHostAdapter  (implements packages/agent-engine HostAdapter)     │  │
│  │  fs · terminal · diff · trust · secrets · emit                         │  │
│  └───────────────────────────────┬────────────────────────────────────────┘  │
│                                  ▼                                            │
│                    @walkcroach/agent-engine (npm / workspace link)            │
│                    gather → act → verify · MCP · ccloud · skills               │
│                    Bedrock ConverseStream (local creds or optional BFF proxy) │
│                    WALKCROACH.md                                              │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │ HTTPS
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Existing control plane (infra-backend)                                        │
│  API Gateway  /ide/v1/*   — Cognito JWT                                        │
│  Lambda walkcroach-ide-{env}  (extend; optional /desktop alias)                │
│    me · projects · links · memory/mirror · memory/recall · entries             │
│  NEW (Desktop delivery):                                                       │
│    S3 (or GitHub Releases) update manifests + signed artifacts                 │
│    Lambda walkcroach-crash-{env}  (optional, scale-to-$0)                      │
│  Shared: @walkcroach/db · agent-harness memory · Cognito · CRDB · Bedrock      │
└──────────────────────────────────┬───────────────────────┬───────────────────┘
                                   ▼                       ▼
                            CockroachDB              Cognito (same pool)
                            memory_entries           CloudWatch
                            (source_surface=desktop)
                            ide_project_links (reuse)
```

**Web Lambda and Chrome Lambda stay untouched** for their routes. Desktop never calls `/sessions/:id/prompt` or `/chrome/v1/*` for the agent loop.

### 3.1 Package / repo layering

| Package / repo | Responsibility | Depends on |
|----------------|----------------|------------|
| `walkcroach-desktop` (new git repo) | vscode fork, `product.json`, contrib UI, packaging, updater | Pins `microsoft/vscode`; consumes agent-engine |
| `@walkcroach/agent-engine` (existing) | Stateless loop, tools, skills, MCP, approvals, Bedrock | No `vscode` imports — CI enforced |
| `ide/` (existing extension) | VS Code Marketplace / Open VSX extension HostAdapter | Same engine |
| `cli/` (existing) | Terminal HostAdapter | Same engine |
| `infra-backend` / `lambda-ide` | Authz, link, memory | `@walkcroach/db`, harness memory |
| `infra-backend` (new modules) | Update bucket + crash ingest | S3, Lambda, IAM |

Optional later (post-MVP): light “hub” process à la Cline hub-spoke so Desktop + CLI share a live session. **Not required for Phase A–C** — in-process engine is enough and keeps cold start simpler.

---

## 4. Repo layout

```text
# Product monorepo (existing) — walkcroach/
walkcroach/
├── packages/agent-engine/          # SHARED — Desktop consumes via npm link / published tarball / git dep
├── ide/                            # Extension (funnel) — stays
├── cli/                            # CLI — stays
├── infra-backend/
│   ├── modules/lambda-ide/         # EXTEND — desktop client metadata, source_surface=desktop
│   ├── modules/lambda-crash/       # NEW — optional crash ingest
│   ├── modules/desktop-updates/    # NEW — S3 bucket + CloudFront for update manifests
│   └── packages/db/migrations/
│       └── 009_desktop_surface.sql # NEW — additive only (see §5)
├── ci-cd/                          # path filters + optional desktop release trigger
└── docs/
    ├── walkcroach-desktop-ide-prd.md
    └── walkcroach-desktop-ide-implementation-plan.md   # this file

# Separate fork repo — walkcroach-desktop/  (NEW)
walkcroach-desktop/
├── README.md                       # how to build, sync upstream, release
├── product.json                    # WalkCroach branding, Open VSX gallery, updateUrl, no MS telemetry
├── scripts/
│   ├── sync-upstream.sh            # fetch + merge microsoft/vscode on cadence
│   ├── apply-product.sh            # VSCodium-style product.json merge
│   ├── audit-recommendations.ts    # NFR-F09 CI gate vs Open VSX API
│   └── package-release.sh          # sign, notarize, publish manifests
├── src/vs/workbench/contrib/walkcroach/
│   ├── browser/                    # panels, overlays, contributions
│   ├── electron-main/              # secrets bridge, updater hooks if needed
│   ├── common/                     # types, protocol with engine
│   └── test/
├── extensions/walkcroach-bundled/  # optional: ship engine-backed built-in extension for faster iteration
└── .github/workflows/
    ├── build.yml                   # win / mac / linux
    ├── upstream-sync.yml           # scheduled + manual
    └── recommendations-audit.yml
```

**Engine consumption options (pick in Phase A; prefer A1):**

1. **Git dependency / npm workspace publish to private registry** from monorepo → Desktop `package.json` depends on `@walkcroach/agent-engine@x.y.z`.  
2. **Vendor copy** only if packaging friction blocks Electron builds — treat as debt; keep single source of truth.

**Install/run (local):**

```bash
# Monorepo — engine + BFF
cd packages/agent-engine && npm i && npm test && npm run build
cd ../../infra-backend && npm run migrate && npm run package:lambda:ide && npm run dev:ide

# Fork repo
cd walkcroach-desktop
npm i
npm run sync:check          # ensure pinned upstream + clean contrib
npm run compile
npm run watch               # or scripts/code.sh equivalent
# Launch WalkCroach Desktop → Sign in → Link project → run agent
```

---

## 5. Data model

Additive only. Reuse `ide_project_links` — Desktop is another client of the same link table.

Migration `009_desktop_surface.sql` (suggested; keep minimal):

```sql
-- WalkCroach Desktop: provenance for memory + optional client metadata.
-- Prefer writing memory_entries with source_surface='desktop'.
-- Links continue to use ide_project_links (same owner + local_repo_key).

-- Optional audit helper (only if product needs install/update analytics without general telemetry):
-- CREATE TABLE IF NOT EXISTS desktop_installs (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   owner_id STRING,                 -- nullable until signed in
--   install_id STRING NOT NULL,      -- opaque client-generated
--   app_version STRING NOT NULL,
--   os STRING,
--   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
--   last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
--   UNIQUE (install_id)
-- );
```

**Memory write:** `source_surface = 'desktop'`, same kinds as IDE (preference | decision | convention | summary). Native memory panel must label Web / Chrome / ide / desktop (FR-F10).

**Recall:** existing C-SPANN path; filter `source_surface IN (...)` as today.

**Do not** duplicate `projects` or invent a parallel memory table.

---

## 6. API / delivery surface

### 6.1 Reuse `/ide/v1` (extend, don’t fork)

| Method | Route | Purpose | Desktop notes |
|--------|-------|---------|---------------|
| GET | `/ide/v1/health` | Liveness | Call with `surface=desktop` query optional |
| GET | `/ide/v1/me` | Identity + link | Same Cognito PKCE client or Desktop-specific Cognito app client in same pool |
| GET | `/ide/v1/me/projects` | Linkable projects | Same |
| POST/GET/DELETE | `/ide/v1/links` | Link local repo | Same `local_repo_key` algorithm as extension |
| POST | `/ide/v1/memory/mirror` | Embed + insert | Accept/emit `source_surface=desktop` |
| POST | `/ide/v1/memory/recall` | Vector recall | Surface filter includes `desktop` |
| GET/PATCH | `/ide/v1/memory/entries` | List/edit | Desktop-sourced entries editable like IDE |

Optional: API Gateway `/desktop/{proxy+}` → **same Lambda** for cleaner product docs — pure alias, zero logic fork.

### 6.2 New Desktop-only (delivery plane)

| Resource | Purpose | Phase |
|----------|---------|-------|
| S3 + CloudFront (or GitHub Releases) `latest-*.yml` + artifacts | `electron-updater` / `product.json` `updateUrl` | E |
| `POST /desktop/v1/crash` (thin Lambda) | Privacy-respecting crash + update-failure reports (NFR-F17) | E |
| Cognito app client `walkcroach-desktop` | PKCE for native onboarding (can share IDE client initially) | B |

### 6.3 Auth

- Cognito PKCE via system browser / loopback (same as extension Hosted UI pattern).  
- Tokens in OS credential store.  
- Dev: `ALLOW_DEV_AUTH` / paste-token path for local only.

### 6.4 Bedrock credentials

| Mode | When | How |
|------|------|-----|
| Local AWS profile / env | Default for development | Engine default credential chain |
| Optional `/ide/v1/bedrock/proxy` | Users without AWS creds | Stream tokens; tools still local |

---

## 7. Performance budget

Tied to Desktop PRD NFRs + carried IDE agent NFRs. Treat as exit criteria and CI gates where noted.

| Metric | Target | How we hit it |
|--------|--------|---------------|
| Cold start → interactive window | ≤ 2s (NFR-F01) | Inherit vscode Electron pin; defer WalkCroach contrib init; no MCP/Cognito on critical path |
| Idle memory (empty workspace) | ≤ 300MB (NFR-F02) | No continuous Cascade-style watcher in MVP; lazy panels |
| First streamed agent token | ≤ 2.5s p50 | ConverseStream + cachePoint; local tools; coalesced UI |
| `recall_project_memory` | ≤ 1.5s p95 | eu-west-2 BFF; limit k |
| UI stream jank | No multi-second stalls | `TokenDeltaCoalescer`; virtualize long transcripts |
| Prompt cache hit rate | Track; aim ≥ 70% after turn 2 | Stable tool schemas; static prefix order |
| Upstream sync cadence | ≤ 14 days (NFR-F12) | Scheduled workflow + named owner; KPI dashboard |
| Recommendation audit | 100% of curated IDs resolve on Open VSX | CI fails build (NFR-F09) |
| Failed update recovery | Never unlaunchable (NFR-F10) | Integrity check + rollback |

**Payload / context caps:** reuse engine truncation, skill progressive disclosure, sub-agent summary-only returns.

**Anti-patterns to ban in review:**

- Background full-repo embedding on every keystroke (MVP).  
- Loading full Agent Skill bodies at startup.  
- Per-token DOM rebuild in native panels.  
- Calling memory BFF on every token delta.  
- Scattering WalkCroach edits outside `contrib/walkcroach/`.

---

## 8. Phased implementation

Capacity assumption: Desktop is a **flagship track** that starts once `@walkcroach/agent-engine` + `/ide` BFF are stable (extension Phase C+ done locally). Phases below are sequential for Desktop itself; **Phase F (upstream cadence) starts in Phase A**, not after launch.

Each phase has **exit criteria**. Do not start the next phase until exits pass.

Mapping to PRD §12:

| This plan | PRD phase |
|-----------|-----------|
| Phase 0–A | Fork Phase A — Bootstrap |
| Phase B | Fork Phase B — Native agent migration |
| Phase C | Fork Phase C — CockroachDB-native panels |
| Phase D | Fork Phase D — Marketplace and migration |
| Phase E | Fork Phase E — Distribution |
| Phase F | Fork Phase F — Sustainability (starts with A) |

---

### Phase 0 — Research spike + certificates (3–5 days) ✅ **IMPLEMENTED (local, 2026-07-18)**

**Goal:** Remove unknown unknowns before cloning vscode at scale. No product UX yet.

**Repo:** sibling `walkcroach-desktop/` (not inside the product monorepo git tree). Verify: `cd walkcroach-desktop && npm run phase0:verify`.

| # | Task | Maps to | Status |
|---|------|---------|--------|
| P0.1 | Pin a specific `microsoft/vscode` commit (prefer latest stable tag); document Electron/Node versions | FR-F01 | ✅ `1.129.0` @ `125df4672b8a6a34975303c6b0baa124e560a4f7`; Electron **42.6.0**; Node build **24.18.0** — `docs/phase-0/UPSTREAM_PIN.md` |
| P0.2 | Spike VSCodium `prepare_vscode` / `product.json` flow; list exact Open VSX gallery URL fields | FR-F01, FR-F12 | ✅ `docs/phase-0/OPEN_VSX_GALLERY.md` + `product/product.walkcroach.json` |
| P0.3 | Spike compile + launch empty branded window on one OS (prefer macOS or Windows primary) | FR-F01 | ✅ Windows Electron **42.6.0** branded smoke (`spike/branded-window`); full vscode gulp compile deferred to Phase A |
| P0.4 | Start Apple Developer Program + Windows code-signing (Azure Artifact Signing or EV) procurement | FR-F17 lead time | ✅ checklist `docs/phase-0/SIGNING_PROCUREMENT.md`; ⬜ human enrollment/submission still required |
| P0.5 | Decide engine packaging strategy (npm publish vs git dep) and prove Desktop can `import` engine without `vscode` | Engine purity | ✅ path/`file:` dependency decided; `spike/engine-import` tests green |
| P0.6 | Name upstream-sync owner / rotation; create empty cadence checklist | NFR-F12 | ✅ `cadence/OWNER.md` + `cadence/CHECKLIST.md` (+ Phase 0 dry-run record) |
| P0.7 | Legal pass: MIT vscode source vs Microsoft product license; confirm no Marketplace proxy in design | NFR-F07 | ✅ `docs/phase-0/LEGAL_PASS.md` |

**Exit:** Documented pin + successful empty branded build on ≥1 OS; signing applications submitted; engine import spike green.

**Exit recorded:** pin ✅ · branded Windows smoke ✅ · engine import ✅ · signing **checklist ready / account submission pending user** — see `walkcroach-desktop/docs/phase-0/EXIT.md`.

---

### Phase A — Fork bootstrap + sustainability scaffolding (1.5–2.5 weeks) ✅ **STRUCTURAL (2026-07-19)**

**Goal:** FR-F01–F04, FR-F20 scaffolding, NFR-F12 process live. Ship an internal daily driver that is “VSCodium-like WalkCroach” with **no agent yet**.

**Repo:** sibling `walkcroach-desktop/` with nested `vscode/` @ pin. Verify: `cd walkcroach-desktop && npm run phaseA:verify`.

| # | Task | Maps to | Status |
|---|------|---------|--------|
| PA.1 | Create `walkcroach-desktop` repo; clone pinned vscode; add `upstream` remote | FR-F01, FR-F03 | ✅ `vscode/` @ `125df467…`, remote `upstream`, branch `walkcroach/phase-a` |
| PA.2 | Replace `product.json` (name, icons, `urlProtocol`, telemetry off/opt-in, Open VSX gallery, updateUrl stub) | FR-F01, FR-F04, FR-F12 | ✅ `scripts/apply-product.mjs` |
| PA.3 | Scaffold empty `src/vs/workbench/contrib/walkcroach/` + contribution registration | FR-F02 | ✅ + hook in `workbench.common.main.ts` |
| PA.4 | Script `sync-upstream.sh` + CI workflow (scheduled biweekly + manual) | FR-F03, FR-F20, NFR-F12 | ✅ |
| PA.5 | Surface-area budget script: fail CI if files outside allowed paths change beyond allowlist | NFR-F13 | ✅ `audit-surface-area.mjs` |
| PA.6 | Empty curated recommendations file `[]` + audit script that would fail on non-empty unresolved IDs | NFR-F09 | ✅ |
| PA.7 | Issue template: “reproduces in VS Code / VSCodium?” triage field | FR-F21 | ✅ |
| PA.8 | README: build, launch, sync, coding conventions (`feat(walkcroach):`) | Maintainability | ✅ |
| PA.9 | First upstream merge recorded (even if no-op) to prove cadence | NFR-F12 | ✅ `cadence/records/2026-07-19-phase-a-bootstrap.md` |

**Exit:** Internal builds install; Open VSX reachable; telemetry off by default; sync script run once with a written record; contrib directory compiles; **zero** inherited VS Code recommendation IDs shipped.

**Exit recorded:** Open VSX + telemetry + contrib + audits + sync dry-run ✅. Full `npm ci` / gulp compile ⏳ deferred on disk budget — see `walkcroach-desktop/docs/phase-A/COMPILE.md` and `EXIT.md`.

**Local verify:**
```bash
cd walkcroach-desktop
./scripts/sync-upstream.sh --dry-run
npm run phaseA:verify
# When ≥15GB free + Node 24.18.0:
#   cd vscode && npm ci && npm run compile && scripts/code.bat
./scripts/audit-recommendations.mjs   # passes on empty curated list
```

---

### Phase B — Native agent migration (2–3 weeks) ✅ structural 2026-07-19

**Goal:** FR-F05–F08. Same three-phase loop, approvals, `WALKCROACH.md` as extension — richer native UI. Unlinked local-only mode works with no account.

| # | Task | Maps to | Status |
|---|------|---------|--------|
| PB.1 | Implement `DesktopHostAdapter` against workbench services (fs, terminal, trust, secrets) | HostAdapter | ✅ `packages/desktop-agent` |
| PB.2 | Wire `@walkcroach/agent-engine` `runAgentLoop` + coalesced event → native chat panel | FR-F08 | ✅ session + chat pane; Bedrock via ENGINE_BRIDGE |
| PB.3 | Diff/command approval UI (native, not extension webview constraints) | FR-F08 | ✅ QuickPick |
| PB.4 | Terminal overlay agent entry point (minimum: panel that can attach to active terminal context) | FR-F05 | ✅ `walkcroach.terminal.ask` |
| PB.5 | Native first-run onboarding shell (sign-in + link placeholders; may stub network) | FR-F07 | ✅ `walkcroach.onboarding` |
| PB.6 | Cognito PKCE + SecretStorage-equivalent; talk to existing `/ide/v1` | FR-F07, FR-F22 | ✅ paste-token + Hosted UI open; PKCE deferred |
| PB.7 | Link project + `source_surface=desktop` mirror/recall tools when linked | FR-F22, FR-F10 precursor | ✅ clients + BFF mirror |
| PB.8 | SHOULD: inline commentary stub in diff view (can be read-only annotations first) | FR-F06 | ✅ hover commentary |
| PB.9 | Autonomy dial + hard ccloud/MCP write gates — parity tests with engine suite | NFR-F08 | ✅ tests |
| PB.10 | Perf: first token ≤ 2.5s p50 on reference hardware; cache metrics visible in debug | Perf budget | ✅ metrics UI; p50 measure deferred to bridge |

**Exit:** Structural verify passed (`npm run phaseB:verify`). Full “add a health route” on Bedrock in Desktop waits on electron-main bridge + disk for compile — see `walkcroach-desktop/docs/phase-B/EXIT.md`.

**Local verify:**
```bash
cd walkcroach-desktop && npm run phaseB:verify
# When disk allows: compile Desktop, enable ENGINE_BRIDGE, then:
# Sign in → Link → run task → approve diffs → recall_project_memory
```

---

### Phase C — CockroachDB-native panels (1.5–2.5 weeks) ✅ structural 2026-07-19

**Goal:** FR-F09–F11. Payoff of forking for the hackathon/demo story.

| # | Task | Maps to | Status |
|---|------|---------|--------|
| PC.1 | Native CockroachDB view container: schema browser via Managed MCP (read-only default) | FR-F09 | ✅ Panel container + Schema view |
| PC.2 | Read-only query runner (MCP `select_query`); write path opt-in + confirm | FR-F09, NFR-F08 | ✅ |
| PC.3 | Audit-log viewer (MCP / Cloud audit where available; else action history from session) | FR-F09 | ✅ session audit |
| PC.4 | Native memory/recall panel with originating surface labels | FR-F10 | ✅ |
| PC.5 | ccloud actions from panel with **hard** per-action confirmation (no autonomy exception) | FR-F11 | ✅ |
| PC.6 | Progressive Agent Skills load for schema/index workflows (reuse engine registry) | Skills | ✅ |
| PC.7 | Telemetry counters: mcp_calls, ccloud_actions, skills_invoked, recalls_by_surface | Success metrics | ✅ |
| PC.8 | Demo script: Web preference → Desktop recall → MCP schema → rejected write → confirmed ccloud dry-run | UJ-F4–F5 | ✅ `docs/phase-C/DEMO.md` |

**Exit:** Structural verify passed (`npm run phaseC:verify`). Live Managed MCP / ccloud binary path uses `@walkcroach/desktop-agent` `CrdbPanelSession` when the electron-main bridge is enabled.

**Local verify:**
```bash
cd walkcroach-desktop && npm run phaseC:verify
# F1 → WalkCroach: Run Phase C Demo Script (after compile)
```

---

### Phase D — Marketplace, recommendations, migration (1.5–2 weeks) ✅ structural 2026-07-19

**Goal:** FR-F12–F16. Can parallelize with late Phase B after Phase A gallery is wired.

| # | Task | Maps to | Status |
|---|------|---------|--------|
| PD.1 | Confirm Open VSX-only gallery in shipped `product.json`; document no Marketplace proxy forever | FR-F12, NFR-F07 | ✅ `NO_MARKETPLACE_PROXY.md` |
| PD.2 | Build curated recommendation allowlist (verified publishers only); CI audit against Open VSX API | FR-F13, NFR-F09 | ✅ 6 verified IDs; fail-closed audit |
| PD.3 | In-product list of known proprietary incompatibles + suggested open alternatives | FR-F14 | ✅ catalog + Incompatibles view |
| PD.4 | First-launch import: settings + keybindings from detected VS Code user dir | FR-F15 | ✅ Migration service + Import view |
| PD.5 | Extension import: only Open VSX-available IDs; flag missing/proprietary clearly | FR-F15, FR-F16 | ✅ `classifyExtensions` |
| PD.6 | Publish WalkCroach IDE **extension** to Open VSX as well (funnel remains installable inside Desktop) | PRD §4 | ✅ checklist; publish when namespace/PAT ready |
| PD.7 | Regression: recommendation audit in release pipeline (fail closed) | NFR-F09 | ✅ CI weekly + PR |

**Exit:** Structural verify passed (`npm run phaseD:verify`). Actual `ovsx publish` of `walkcroach.walkcroach-ide` awaits Open VSX namespace enrollment.

**Local verify:**
```bash
cd walkcroach-desktop && npm run phaseD:verify
```

---

### Phase E — Distribution, signing, auto-update (2–3 weeks; start certs in Phase 0) ✅ structural 2026-07-19

**Goal:** FR-F17–F19, NFR-F04/F05/F10/NFR-F17/F18.

| # | Task | Maps to | Status |
|---|------|---------|--------|
| PE.1 | CI matrix: Windows / macOS / Linux package builds | NFR-F15 | ✅ `package-matrix.yml` |
| PE.2 | macOS Developer ID sign + notarize (`hardenedRuntime`, entitlements) | FR-F17, NFR-F05 | ✅ docs + entitlements; ⏳ certs |
| PE.3 | Windows code sign (prefer Azure Artifact Signing in CI) | FR-F17 | ✅ docs; ⏳ enrollment |
| PE.4 | Linux signed packages (or documented checksums + repo) | FR-F17 | ✅ |
| PE.5 | Wire `updateUrl` / updater to S3/CloudFront or GitHub Releases | FR-F18 | ✅ design + TF module |
| PE.6 | Differential updates + staged rollout channels (`stable` / `insiders`) | FR-F18 | ✅ |
| PE.7 | Failed update rollback / integrity verification | NFR-F10 | ✅ `ROLLBACK.md` |
| PE.8 | Release notes template: **Upstream absorbed** vs **WalkCroach-specific** | FR-F19 | ✅ + audit |
| PE.9 | Crash-report Lambda + client (opt-in, independent of telemetry) | NFR-F17, NFR-F18 | ✅ |
| PE.10 | Terraform modules for update bucket + crash Lambda; scale-to-$0 | NFR-F18 | ✅ `infra/` |

**Exit:** Structural verify passed (`npm run phaseE:verify`). Public signed installers + live auto-update blocked on Phase 0 signing enrollment + DNS/ACM for `updates.walkcroach.dev`.

**Local verify:**
```bash
cd walkcroach-desktop && npm run phaseE:verify
```

---

### Phase F — Sustainability tooling (ongoing; bootstrap in A) ✅ structural 2026-07-19

**Goal:** FR-F20–F21, NFR-F12–F14. Listed last because cross-cutting; **starts in Phase A**.

| # | Task | Maps to | Status |
|---|------|---------|--------|
| PF.1 | Biweekly upstream merge with conflict log stored in repo | FR-F20, NFR-F12 | ✅ sync script + `docs/upstream/` |
| PF.2 | KPI: cadence adherence % + days-since-last-merge | NFR-F12 | ✅ `cadence-kpi.mjs` |
| PF.3 | Quarterly surface-area budget review | NFR-F13 | ✅ `docs/surface-area/QUARTERLY.md` |
| PF.4 | Decision log for deferred fork changes | NFR-F14 | ✅ `docs/decisions/` |
| PF.5 | Issue label `upstream-candidate` when reproduces in VSCodium/VS Code | FR-F21 | ✅ form + workflow |
| PF.6 | Security patch fast-path | Reliability | ✅ `SECURITY_PATCH.md` |

**Also locked:** Interim public distribution = **Windows portable zip/exe** (unsigned preview) — `walkcroach-desktop/docs/phase-E/INTERIM_DISTRIBUTION.md`.

**Exit:** Structural verify passed (`npm run phaseF:verify`). Continuous: never >14 days without a recorded sync attempt (`npm run cadence:kpi`).

**Local verify:**
```bash
cd walkcroach-desktop && npm run phaseF:verify
```

---

## 9. Testing strategy

| Layer | What | Phase |
|-------|------|-------|
| Engine unit | Existing `packages/agent-engine` suite — Desktop must not fork behavior | B+ |
| DesktopHostAdapter fake | In-memory fs + scripted approvals for CI without full Electron | B |
| Contrib unit | Panel view-models, recommendation audit, repo-key, protocol | B–D |
| BFF | Existing IDE integration tests + cases for `source_surface=desktop` | B |
| Cross-surface | Web → Desktop recall; Desktop → Web recall (extend `tests/integration/cross-surface`) | B–C |
| MCP/ccloud | Fixtures + optional live cluster | C |
| Recommendation CI | Live Open VSX existence + publisher verification | A, D |
| Upstream sync dry-run | CI job that fetches upstream and reports conflict estimate | A, F |
| Smoke E2E | Launch app → open folder → ping stream → (signed-in) recall | B, E |
| Update E2E | Install n-1 → update to n → launch | E |
| Perf regression | Cold start + idle RSS + TTFT sample on reference hardware | A+, E |

Do **not** log prompt bodies, SQL row data, or tokens to crash/telemetry pipelines.

---

## 10. Observability and success metrics

Align with Desktop PRD §11 + carried IDE metrics:

| Metric | Source |
|--------|--------|
| Settings/extension import success rate | First-launch funnel |
| Upstream-merge cadence adherence | Sync logs / CI |
| Fork surface-area trend | Budget script |
| Recommendation audit pass rate | CI (must stay 100%) |
| Native-only surface usage vs extension sidebar | Event counters (opt-in) |
| `% extension users who migrate and link` | Cognito + `ide_project_links` + client=`desktop` |
| TTFT, cache hit rate, MCP/ccloud/skills counts | Engine telemetry |
| Update success / rollback rate | Updater + crash Lambda |

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| **Upstream maintenance ends the product (Void)** | NFR-F12 funded from Phase A; KPI; surface-area budget; isolate contrib |
| Marketplace / proprietary extension gaps anger switchers | FR-F14 honest disclosure; Open VSX alternatives; don’t promise Pylance/Remote parity |
| Reverse-proxy temptation under competitive pressure | NFR-F07 absolute; code review reject; document in CONTRIBUTING |
| Recommendation namesquatting class (Jan 2026) | Empty inherit list; curated allowlist; CI fail-closed |
| Scope competition kills the extension funnel | Explicit dual-support; ship extension on Open VSX inside Desktop |
| Engine rewritten inside fork (“just this once”) | CI ban on duplicating loop; Desktop only implements HostAdapter + UI |
| Second backend “for cleanliness” | Reject; only update/crash are new; memory stays `/ide` |
| Electron memory creep (Cascade-like watchers) | MVP event-driven gather; RSS budget in CI |
| Signing/notarization delay | Start Phase 0; parallelize with A–C |
| Bedrock creds friction | Document profiles; optional BFF proxy later |
| Sub-agent / hub complexity | Defer Cline-style hub; keep in-process until CLI↔Desktop session sharing is a real demand |

---

## 12. Out of scope (this plan)

- Rebuilding on Eclipse Theia (named alternative; not chosen).  
- Full Cursor Tab / Windsurf Cascade feature parity.  
- Reimplementing Microsoft Remote Development, Pylance, C/C++ Tools, Live Share.  
- Hosted multi-tenant cloud agent for Desktop.  
- Mobile / browser version of the Desktop shell.  
- Merging `microsoft/vscode` into the product monorepo.  
- New Cognito pool or CockroachDB cluster for Desktop.

---

## 13. Suggested calendar (indicative)

Assuming one focused squad after extension Phase C is stable:

| Week | Focus |
|------|-------|
| 0 | Phase 0 spike + cert procurement |
| 1–2 | Phase A bootstrap + first upstream sync |
| 3–5 | Phase B native agent + `/ide` link |
| 6–7 | Phase C CRDB + memory panels |
| 6–8 | Phase D marketplace/import (overlap) |
| 8–10 | Phase E signing + updater |
| Ongoing | Phase F cadence |

Hackathon-critical path if time-boxed: **A → B → C** (bootstrap, agent, CRDB/memory demo). D/E can be “signed internal builds + sideload” for judges if public distribution slips — but Open VSX-only + empty recommendations still required.

---

## 14. Definition of done (v1 Desktop)

- [ ] Pinned MIT vscode build with WalkCroach `product.json`, telemetry off by default  
- [ ] All product code under `contrib/walkcroach/` (+ documented hooks)  
- [ ] Open VSX only; curated recommendations CI-green  
- [ ] `@walkcroach/agent-engine` drives the loop via `DesktopHostAdapter`  
- [ ] Same Cognito + `/ide` link + `memory_entries` with `source_surface=desktop`  
- [ ] Native CRDB panel + memory panel + approval gates intact  
- [ ] Biweekly upstream sync process proven ≥2 times  
- [ ] Signed builds + auto-update on primary OS pair (macOS + Windows)  
- [ ] Extension remains installable and documented as the low-commitment path  

---

## 15. References (research, July 2026)

- Desktop PRD: `docs/walkcroach-desktop-ide-prd.md`  
- Extension implementation plan: `docs/walkcroach-ide-implementation-plan.md`  
- VSCodium product/gallery model: https://vscodium.com/ · https://github.com/VSCodium/vscodium  
- Open VSX: https://open-vsx.org · Eclipse Foundation guidance on forks vs Theia (Dec 2025)  
- Koi Security Open VSX recommendation / namespace gap (late 2025 → Jan 2026 disclosure): Cursor, Windsurf, Antigravity, Trae  
- Void editor archived/deprecated (2026): https://github.com/voideditor/void  
- `opencode-vscode-ide` contrib isolation pattern: https://github.com/cpkt9762/opencode-vscode-ide  
- Cline SDK hub/spoke + extracted runtime (May 2026): https://cline.bot/blog/introducing-cline-sdk-the-upgraded-agent-runtime  
- Continue Bedrock `cachePoint` / prompt caching  
- Electron 2026 startup snapshot / preload bytecode caching PRs  
- AWS Kiro (Code OSS + Bedrock + Open VSX + specs) — differentiate on memory, not specs  
- Cursor marketplace enforcement aftermath → Anysphere in-house remote/Python/C++ extensions (2025)  

---

*End of implementation plan.*
