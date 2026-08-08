# WalkCroach Product Master Doc

**Audience:** Senior Product Managers, Business Analysts, QA  
**Compiled:** 2026-08-07  
**Companion (engineering depth):** [`walkcroach-master-doc.md`](./walkcroach-master-doc.md)

This document describes **what WalkCroach is, what each surface does, what is ready to sell or demo, what must not be claimed yet, and how to validate it**. It is written from a fresh review of the live codebases (`walkcroach/` and `walkcroach-desktop/`). Older PRDs and phase plans are often outdated — prefer this file and the engineering master doc when they conflict.

**How to use this doc**

| Role | Start here |
|---|---|
| **Product** | §§0–2 for status; §7 for claim rules; §10 for open decisions |
| **BA** | §§3–6 for capability catalogues; §8 for journeys and acceptance language |
| **QA** | §4 (per-surface “QA focus”); §9 for coverage honesty; §7 for forbidden claims |

Status labels used throughout:

| Label | Meaning |
|---|---|
| **Ready** | Built and usable for the intended audience (may still need secrets/ops for full production) |
| **Shipped / publishable** | Distribution path exists (store, npm, Open VSX, or hosted web) |
| **Gated** | Code exists but stays off or inert until secrets, entitlements, or ops steps land |
| **Preview / dogfood** | Works for internal use; not production-hardened or not signed |
| **Demo only** | UI looks real; data or backend is fake — **do not demo as live** |
| **Out of scope** | Explicitly not a product promise today |

---

## 0. One-page product summary

WalkCroach is an **agentic work platform**: AI that can help people build software, work across the browser, and keep durable project memory — not a single chatbot bolted onto one app.

**The product bet:** the same project memory follows the user across six surfaces (Web, Browser Extension, IDE Extension, CLI, SDK, Desktop IDE). An insight captured in Chrome can matter later in the IDE; a decision made while building on the Web can be recalled from the CLI. That shared memory is the moat competitors usually lack.

**What we do *not* claim:** that every surface is equally mature, that Desktop is a signed production IDE, that connectors work without OAuth setup, that creatives are unlimited, or that “time travel” through memory goes back years.

### 0.1 Status at a glance

| Surface | Who it’s for | Maturity | One-line product verdict |
|---|---|---|---|
| **Web** (App Builder + account home + developer portal) | Builders, PMs dogfooding apps, account owners, API developers | **Ready — richest surface** | Create projects, chat/build apps, creatives, billing, connect tools, manage API keys |
| **Browser Extension** (Chrome) | Knowledge workers / SMEs in the browser | **Shipped path (v0.6.1)** | Side-panel copilot: capture page context, ask/draft/save, recall into shared memory |
| **IDE Extension** | Developers in VS Code / compatible editors | **Publishable (Open VSX)** | Local coding agent with project link + shared memory |
| **CLI** | Developers / automation in the terminal | **Publishable (npm)** | Same coding agent as IDE, scriptable; browser sign-in for humans, token for CI |
| **SDK** | External (and first-party) developers integrating memory/content | **Built; portal exists; publish path for packages** | Memory + content APIs + keys — **not** “host a full coding agent in our cloud for you” as the public product |
| **Desktop IDE** | Developers who want a WalkCroach-native editor | **Preview / dogfood only** | Real agent + multi-agent window; Cockroach panels mostly **demo**; unsigned Windows preview |

### 0.2 What “good” looks like for WalkCroach (evaluation lens)

When judging a feature, demo, or release, ask:

1. **Does memory feel real?** — Does the system remember, update, and recall across surfaces — or is memory decorative?
2. **Is the agent useful in a real workflow?** — Would someone change how they work, or only be impressed once?
3. **Is trust designed in?** — Propose → confirm → execute for spend, destructive actions, and third-party writes?
4. **Is it production-honest?** — Secure enough, observable enough, and claims-aligned?
5. **Is there originality?** — Cross-surface memory and disciplined confirmation, not “another chat sidebar.”

---

## 1. Platform ideas in plain language

### 1.1 Six surfaces, one memory

Users should experience **one WalkCroach identity and one project memory graph**, reached from different tools:

```text
  Web ──┐
Chrome ─┼── shared project memory (who said what, decisions, captures, skills…)
   IDE ─┤
   CLI ─┤
   SDK ─┤
Desktop─┘
```

Each write is tagged with **which surface** it came from (web, chrome, ide, cli, sdk, desktop). That provenance matters for trust, audit, and demos (“this fact was captured in Chrome”).

### 1.2 Two kinds of agents (why behaviour differs by surface)

WalkCroach intentionally runs **two agent styles**:

| Style | Surfaces | What users feel |
|---|---|---|
| **Cloud agent** | Web, Browser Extension | Runs in WalkCroach’s cloud: creatives, connectors, hosted builder sandbox, shared credits |
| **Local coding agent** | IDE, CLI, Desktop | Runs on the user’s machine/editor: file edits, terminals, approvals, bring-your-own model key (BYOK) |

**Product implication:** do not promise identical features on every surface. Web creatives (images, slides, video) are a cloud product. IDE/CLI/Desktop are coding-agent products that **share memory** with the cloud, not a full copy of the creative studio.

### 1.3 Propose → confirm → execute

For actions that **spend money**, **change third-party systems**, or **do something hard to undo**, the agent should:

1. **Propose** what it wants to do  
2. Wait for the user to **confirm**  
3. Only then **execute**

This is a product rule, not a nice-to-have. Demos that skip confirmation for “wow” undermine the trust story — especially for regulated or enterprise buyers.

### 1.4 Memory behaviour users should understand

| Behaviour | Plain meaning | Product constraint |
|---|---|---|
| **Remember / recall** | Store and find project knowledge | Core promise |
| **Supersede** | Newer related facts retire older ones instead of silent overwrite | Provenance preserved |
| **Erase (governance)** | Legal / user erase leaves an auditable tombstone | Not “pretend it never existed” without trail |
| **asOf / timeline** | Short operational “what did we believe recently?” | **~25 hours** of database time-travel — **not** multi-year archive. Do not sell year-long replay yet |
| **Export / import** | Portability of memory envelopes | Supported in the SDK / portal story |

### 1.5 Credits, quotas, and entitlements

- **Credits** — shared pool (notably Web + Chrome) for metered usage.  
- **Hard quotas** — separate ceilings (especially creatives). **Credits alone do not remove hard caps.**  
- **Paid (~$20/mo via Stripe)** unlocks paid creative paths; free tier stays on lighter chat/builder — **not** full Canvas/Reel/Pro creative orchestration.

Exact creative caps that marketing and QA must keep true (paid):

- Images: **≤ 3 per owner per rolling 24 hours**  
- Video: **≤ 1 job, ≤ 30 seconds, per owner per rolling 72 hours**

---

## 2. Personas and jobs-to-be-done

| Persona | Primary surfaces | Jobs WalkCroach should win |
|---|---|---|
| **App builder / founder** | Web | Scaffold an app, iterate in chat/builder, deploy, keep project memory |
| **SME / researcher in browser** | Chrome (+ Web handoff) | Summarise pages, save insights, draft, recall later in a project |
| **Professional developer** | IDE, CLI, optionally Desktop | Agent-assisted coding with approvals, checkpoints, shared project memory |
| **Automation / CI user** | CLI (+ tokens), SDK | Scripted auth, memory ops, content publish without a GUI |
| **Platform / API developer** | Web developer portal + SDK | Create API keys, call memory/content APIs, read docs |
| **Internal dogfooder / evaluator** | All, especially Desktop preview | Validate cross-surface memory and trust gates before external claims |

**Not primary personas today:** end-customers of *generated* apps (custom domains / end-user auth for those apps remain out of scope), ops admins needing a full internal admin console (not built as a product surface).

---

## 3. Capability catalogue (cross-cutting)

### 3.1 Identity & access

| Capability | Status | Notes for BA/QA |
|---|---|---|
| Sign up / sign in (Web) | Ready | Cognito-backed account |
| Try / anonymous paths | Ready where product exposes them | Chrome device try → upgrade; Web try flows |
| Link IDE / CLI / Chrome from Web | Ready | Connect pages mint one-time handoffs with proof-of-possession (PKCE) |
| CLI browser sign-in | Ready | Loopback local listener; `--token` for CI |
| IDE paste-token fallback | Ready | Exists alongside Hosted UI |
| Desktop auth | Preview | Paste-token heavy; treat as dogfood UX |
| API keys (`wc_live_…`) | Ready in product/API | Create/list/revoke from developer portal; keys cannot mint other keys; **do not** put secret keys in browser apps |

### 3.2 Projects & collaboration skeleton

| Capability | Status | Notes |
|---|---|---|
| Projects as the memory/tenant anchor | Ready | Most durable value is project-scoped |
| General / personal chat (no project) | Ready on Web | Distinct from project chat |
| GitHub connect / push-pull | Ready on Web | Subject to app permissions and env flags |
| Workspaces (Chrome) | Ready | Extension organisation of work |

### 3.3 Agentic chat & building (Web)

| Capability | Status | Notes |
|---|---|---|
| Chat modes / plan approve gate | Ready | Plan-then-approve is intentional |
| Builder sandbox | Ready | Prefer hosted E2B sandbox; browser WebContainer is fallback |
| Checkpoints / revert patterns | Ready on coding surfaces | IDE/CLI strong; Web has checkpoint concepts in product |
| Visual edit | Ready on Web | In-product editing aids |
| One-click deploy | Ready on Web | Ops/env dependent — smoke before claiming in a customer demo |
| RAG documents / code library / apps hub | Partial–Ready | Apps hub still shows “plugins coming soon” areas |

### 3.4 Creatives (Web-led)

| Capability | Status | Claim rules |
|---|---|---|
| Image generation (Nova family) | Ready when entitled + wired | Hard cap; confirm gate; **Amazon Nova only** for Web creatives |
| Slides / flyer / office-ish renders | Ready when creative worker live | Confirm gate; quota/credits |
| Video studio | Gated / ops-sensitive | Hard cap; stub paths may appear if video pipeline not fully wired — **QA must detect stub badges** |
| Free tier creatives | Restricted | Free ≠ Canvas/Reel/Pro orchestration |
| Unlimited creatives | **Forbidden claim** | Caps are margin and abuse controls |

### 3.5 Connectors (Web + Chrome)

Providers in product code: Google Calendar, Gmail, Google Sheets, Slack, Stripe Connect (read-oriented), HubSpot (**coming soon** in places).

| Rule | Why |
|---|---|
| Tokens live in server secrets — not in the browser | Security claim we must keep |
| Writes go through propose → confirm → execute | Trust |
| Without OAuth client secrets, connectors stay **inert** | Code-complete ≠ customer-ready |
| Do not market HubSpot (or any “coming soon”) as live | BA acceptance should fail the claim |

### 3.6 Billing

| Capability | Status | Notes |
|---|---|---|
| Stripe Checkout | Ready (needs live keys) | Paid plan ~$20/mo language in claims audit |
| Customer Portal | Ready (needs live keys) | Manage subscription |
| Shared credit pool Web↔Chrome | Ready | Usage surfaces should say shared where product shows it |
| Hard quotas independent of credits | Ready | Critical for QA and marketing |

**Ops footgun (product-visible failure mode):** platform Stripe billing keys and Stripe *Connect* OAuth keys are different. Wrong secret → Checkout broken **or** Connect silently dead. Escalate to eng/ops; do not “fix” by rewriting copy alone.

### 3.7 Memory & governance (all surfaces via shared layer)

| Capability | Status | Honest limits |
|---|---|---|
| Remember / recall across surfaces | Ready | Demo this early — it is the differentiator |
| Export / import | Ready via SDK/API paths | Portal docs cover developer use |
| Audit / erase | Ready in platform (governance) | Erase is tombstoned, auditable |
| Multi-year “as of date X” replay | **Out of scope** | ~25h operational window only |

### 3.8 Observability (product relevance)

Engineering has dashboards/alarms for **memory health** and **creative spend/budget**. That is **not** the same as full customer-facing status pages or complete “all services green” monitoring. For launch readiness, ask eng for the smoke checklist — do not assume silent success.

---

## 4. The six surfaces (detailed)

### 4.1 Web — App Builder, account home, developer portal

**Product job:** Be the home base — accounts, projects, building, creatives, billing, connections, and developer keys/docs.

**Users can (Ready):**

- Sign up / sign in; open dashboard and projects  
- Chat with the cloud agent; use builder with sandbox  
- Attach documents / use project memory  
- Run creatives within entitlements and caps (when infra secrets/workers are live)  
- Connect GitHub; deploy (env-dependent)  
- Manage billing (Checkout / Portal when Stripe configured)  
- Open **Developer** area: overview, API keys, ops, governance, docs  

**Still incomplete / gated:**

- Plugins marketplace language (“coming soon”)  
- Some connector UI still marked coming soon; HubSpot incomplete  
- Generated apps’ own end-user auth and custom domains — out of scope  
- Marketing claims need sign-off in the claims audit (Product row may still be open)

**QA focus**

- Auth + connect handoffs to IDE/CLI/Chrome  
- Plan approve and creative/connector **confirm cards**  
- Quota pill / upgrade modal language vs real 403/deny behaviour  
- Billing happy path + webhook-driven entitlement (staging)  
- Memory remember on Web → recall on another surface  
- Developer portal: create key once, copy secret once, revoke, rejected mint-with-key  
- Failure copy when video/creative is stubbed or quota denied  

**Versions:** Web app package `0.1.0` (private hosted product). Hosted at the WalkCroach web origin (prod domain family under `rinegansolutions.com` — see eng master doc for exact hostnames).

---

### 4.2 Browser Extension (Chrome)

**Product job:** Meet the user where they browse — capture, ask, draft, and save into the **same** memory graph.

**Users can (Ready / shipped path):**

- Use a **side panel** copilot (not a floating FAB as the primary UX)  
- Extract page context; selection capture  
- Summarise / ask / draft / save  
- Recall project memory  
- Workspaces; price track; credits awareness  
- Device try experience with upgrade to full account  
- Hand off into Web chat  

**Version:** **0.6.1** (package and store kit aligned).

**Gated / do not overclaim:**

- Connectors without OAuth secrets  
- Remote signed site profiles without keys/bundles  
- Screenshot upload paths that need store-ID CORS  
- Any claim that the extension includes full Web creative studio  

**QA focus**

- Permissions / page-access messaging  
- Auth: device → Cognito upgrade; PKCE handoff  
- Confirm cards for connector-like actions  
- Recall sources UI honesty  
- Store listing vs actual permissions and privacy policy pages  
- Regression: side panel opens; context menu paths; selection save  

**Distribution:** Chrome Web Store publish workflow exists; whether a given build is **live in the store today** is an ops fact — confirm with the store console before customer communication.

---

### 4.3 IDE Extension

**Product job:** Coding agent inside the editor the developer already uses, linked to WalkCroach projects and memory.

**Users can (Ready / publishable):**

- Sign in (Hosted UI + PKCE; paste-token fallback)  
- Link a project  
- Run local agent turns with **approvals** for risky actions  
- Use checkpoints / attachments / skills patterns  
- Read/write project memory via the shared bridge  
- Bring their own Bedrock/model credentials for the coding loop (BYOK)  

**Version:** **0.2.0**. Distribution emphasis: **Open VSX**. Microsoft Marketplace publish is **not** enabled in the release workflow yet — do not promise Marketplace listing.

**QA focus**

- Sign-in and project link  
- Approval prompts appear for destructive/shell actions  
- Memory mirror/recall with `ide` as source surface  
- BYOK missing/invalid key → clear error, no silent hang  
- Extension activate on clean VS Code / compatible host  

**Known thin spot:** fewer automated UI tests than CLI/Chrome — favour exploratory + checklist testing on webview flows.

---

### 4.4 CLI

**Product job:** Same local coding agent for terminal-native developers and scripts.

**Users can (Ready / publishable):**

- `auth` via browser loopback (human) or token (CI)  
- `link` projects; `run` agent turns; approvals in TUI  
- `memory`, `skills`, `mcp`, `secrets`, `create`, `revert` style workflows  
- JSON / pipe-friendly output for automation  

**Version:** **0.3.0** on the npm publish path (`@walkcroach/cli`).

**QA focus**

- Loopback auth race: only the process that holds the verifier can spend the code  
- CI token path documented and tested  
- Approval deny/allow behaviour  
- Packaging smoke (`walkcroach --help`, doctor/diagnostics)  
- Cross-surface: CLI remember → Web/Chrome recall  

---

### 4.5 SDK (and developer portal)

**Product job:** Let developers (external or internal) integrate **WalkCroach memory and content** programmatically.

**What the SDK is**

- Create clients that **remember / recall / export / import / erase / audit** memory  
- Publish **content** and track **runs** (wait / resume / cancel patterns)  
- Manage **API keys** (with a user login — keys cannot create keys)  
- Optional **MCP** adapter for memory tools (list/recall/remember/timeline)

**What the SDK is *not* (important for Product copy)**

- It is **not** “Cursor-as-a-service” or a public hosted coding agent you fully control via one SDK call  
- Local/programmatic agent hosting exists internally (`sdk-host`) but is **not** the marketed public package set  

**Developer portal (Web):** `/app/developer` — overview, keys, ops, governance, docs/quickstart.

**QA / BA focus**

- Portal key lifecycle + scope enforcement  
- OpenAPI / docs examples match behaviour  
- Retention messaging: short asOf window disclosed  
- Forbidden: implying multi-year time travel or browser-embedded secret API keys  
- Integration tests may skip without live credentials — ask eng which suites ran for a release  

**Package versions:** `@walkcroach/sdk` **0.2.0**, `@walkcroach/sdk-mcp` **0.2.0** (publish workflows exist).

---

### 4.6 Desktop IDE

**Product job:** A WalkCroach-native desktop editor (fork of VS Code / Code OSS) with a first-class multi-agent experience and shared memory.

**Maturity: Preview / dogfood — not production-signed.**

**Works in dogfood (when set up):**

- Chat / Plan / Agent modes with Bedrock key  
- Approvals and questions  
- **Agents Window** with multiple agent tabs/grid (soft cap **6**, with force)  
- Settings UI; theme/branding  
- Online project memory when signed in and project-linked  
- Unsigned Windows portable / Setup.exe **packaging tooling** (operator builds the artifact)

**Demo-only or incomplete — do not sell as live:**

| Area | Truth |
|---|---|
| CockroachDB schema / query / cloud-admin style panels | **Demo fixtures** |
| Skills auxiliary lists | **Demo content** |
| Offline durable memory buffer | Not wired into the product path |
| Secrets storage on disk | Effectively plaintext today — dogfood risk |
| Auto-update / code signing / notarization | Deferred |
| macOS / Linux as production channels | Not the interim promise |

**Distribution policy (product language):**

- Channel: **insider / preview**  
- Windows unsigned Setup.exe / zip — users may see SmartScreen (“More info → Run anyway”)  
- Extensions gallery: **Open VSX only** (never Microsoft Marketplace proxy)  
- First public Release is still an **operator step**, not “automatically shipping from CI as a signed installer”

**QA focus (Desktop)**

- Label builds **Preview** in test reports  
- Agent turn + approval + fleet with 2–3 parallel agents  
- Confirm memory pane shows live data only when linked; otherwise demo fallback is obvious  
- Never mark CRDB panels as passed “integration” if they only show fixtures  
- Packaging: checksum (`SHA512SUMS`) present for any shared build  
- Regression watch: approvals applying to the **wrong** agent tab (known risk area)

---

## 5. End-to-end journeys (BA acceptance language)

Use these as scenario outlines. Pass/fail should cite the surface and whether a gate (secrets, entitlement) applied.

### Journey A — Cross-surface memory (core differentiator)

1. User creates/opens a **project** on Web and saves a clear decision via chat or memory UI.  
2. Same user, in Chrome on a relevant page, asks to recall project context — sees the decision (or a clear empty/denied state).  
3. Same user in IDE or CLI recalls or mirrors memory — provenance shows prior surfaces.  
**Pass:** Recall is correct and attributable. **Fail:** Surface-local-only memory, silent miss without explanation, or cross-user leak.

### Journey B — Trust gate on spend / connector

1. Agent proposes a paid creative or connector write.  
2. UI shows confirm card; user cancels — **no** side effect / no charge beyond any documented peek.  
3. User confirms — action executes; quota/credits update honestly.  
**Pass:** Cancel is safe; confirm is required. **Fail:** Auto-execute on propose; quota UI lies.

### Journey C — Builder to deploy (Web)

1. Scaffold or open project; agent/builder makes a visible change.  
2. Preview runs in sandbox.  
3. Deploy path attempted in a known-good env.  
**Pass:** Failure modes are explicit. **Fail:** Silent deploy “success” with no URL / wrong project.

### Journey D — Developer key

1. Signed-in user opens Developer portal, creates key, copies secret once.  
2. SDK client with key can recall/remember within scope.  
3. Revoke key — subsequent calls fail cleanly.  
**Pass:** Secret shown once; revoke sticks. **Fail:** Key creatable with another API key; secret re-shown later.

### Journey E — Extension try → upgrade

1. New Chrome user tries device session features within policy.  
2. Upgrade to Cognito account preserves or merges expected data without orphaning captures.  
**Pass:** No stranded data; clear prompts. **Fail:** Lost captures or duplicate confused identity.

### Journey F — Desktop preview honesty

1. Installer/preview build launches; Agent completes a turn with key present.  
2. Tester opens CRDB panels — records **demo** in the report unless eng certifies live wiring.  
**Pass:** Preview labelled; agent path works. **Fail:** Report calls Desktop “production ready” or CRDB “live.”

---

## 6. Feature flags of the real world (gates)

These are the practical “feature flags” Product/BA/QA hit — even when no UI toggle exists:

| Gate | Surfaces affected | If missing, users see |
|---|---|---|
| Stripe billing secrets | Web | Checkout/Portal fail |
| Connector OAuth client secrets | Web, Chrome | Connectors inert / errors |
| Creative worker image / video pipeline | Web | Stub badges, failed jobs, or disabled paths |
| Bedrock / model access | All agent surfaces | Agent cannot run |
| BYOK on IDE/CLI/Desktop | Coding surfaces | Local agent blocked until key set |
| Cognito / API URL config | All | Auth or API failures |
| CWS / npm / Open VSX publish performed | Chrome, CLI, IDE | Code ready but users cannot install that version |
| Desktop operator package + CDN upload | Desktop | No downloadable preview binary |

**Rule of thumb:** *Code complete* ≠ *Customer reachable*. Release notes and sales decks must track **gates**, not only **merged PRs**.

---

## 7. Claims & messaging rules

### 7.1 Claims that must remain true

- Shared memory across Web / Chrome / IDE / CLI / SDK / Desktop (when linked to the same project/account).  
- Propose → confirm → execute for paid creatives and connector writes.  
- Connector tokens stored server-side, not in the browser.  
- Native **Amazon Nova** family for Web creatives (not a multi-vendor creative LLM story).  
- Paid creative hard caps as listed in §1.5.  
- Free tier does **not** include full Canvas / Reel / Pro creative orchestration.  
- Shared Web/Chrome credit pool where the product surfaces it.  
- Desktop interim builds are **unsigned preview**.  
- Public SDK is a **memory/content/keys** product.

### 7.2 Claims that must not appear

| Forbidden | Why |
|---|---|
| Unlimited images/video | Hard caps exist on purpose |
| “Canva” / autofill for self-serve creatives | Out of scope |
| Credits remove hard caps | False |
| Always-on background scraping (as a Web claim) | Chrome policy is separate; do not bleed |
| Desktop is signed / notarized / auto-updating | Not true today |
| Multi-year memory time travel | Only ~25h operational asOf |
| SDK = full hosted coding agent for everyone | Misstates the product |
| All six surfaces are equally production-mature | False — Desktop preview; gates elsewhere |
| Microsoft Marketplace listing for IDE (unless workflow enabled) | Not enabled |
| HubSpot connector “live” while UI/code say coming soon | False |

### 7.3 Sign-off artefacts

- Web: [`web-claims-audit.md`](./web-claims-audit.md) — Product sign-off row may still be empty; treat as a release gate.  
- Chrome: store listing + privacy practices under `chrome/store/`.  
- Smoke: [`smoke-and-redirects.md`](./smoke-and-redirects.md).

---

## 8. Prioritisation guidance for Product

When choosing the next bet, prefer work that strengthens the **evaluation lens** in §0.2:

| Priority theme | Why | Examples |
|---|---|---|
| **1. Make the differentiator undeniable** | Wins demos and reviews | Cross-surface memory polish, provenance clarity, portal docs honesty |
| **2. Trust & money paths** | Enterprise and margin | Confirm gates, quota UX, Stripe/Connect secret hygiene, claims sign-off |
| **3. Finish gated “almost live” features** | Avoid code-complete theatre | Connector secrets, creative/video pipeline authenticity |
| **4. Desktop honesty + hardening** | Prevent false “sixth surface shipped” narrative | Label preview; fix approval/fleet risks; encrypt secrets; replace demo panes or mark them |
| **5. New surface scope** | Lowest leverage while gates remain | Avoid until 1–4 are healthier |

**Explicit non-goals (for now):** merging the two agent styles into one for neatness; publishing the internal coding engine as “the SDK”; Marketplace proxy on Desktop; multi-year asOf marketing.

---

## 9. QA strategy & coverage honesty

### 9.1 Where automation is relatively strong

- Local coding agent core behaviour  
- Cloud agent loop unit coverage  
- Chrome library / many sidepanel components  
- CLI auth, packaging, surface contracts  
- SDK client unit tests; IDE API contract tests when databases/credentials available  

### 9.2 Where humans must lean in

| Area | Why |
|---|---|
| Large Web SPA pages | Fewer tests relative to complexity |
| Money paths (billing webhooks, entitlements) | High impact; env-dependent |
| Deploy / video pipelines | Ops wiring; stub risk |
| IDE webview UX | Thin automated UI net |
| Desktop agent UI | Little/no unit test net on the webview bundle |
| Store/marketplace listings | Human review of permissions + copy |
| Cross-surface golden paths | Often need live credentials; may be skipped in CI |

### 9.3 Suggested release test packs

**P0 — every candidate release**

- Auth sign-in on Web  
- One remember → recall across **two** surfaces  
- One confirm-cancel and one confirm-execute on a gated action (or documented skip if secrets absent)  
- Quota deny messaging if creatives enabled in that env  
- Claims checklist spot-check (§7)

**P1 — surface owners**

- Chrome: install fresh profile, side panel, upgrade path  
- IDE: install VSIX/Open VSX build, link, one approved file change  
- CLI: pack or installed binary, loopback auth, one run  
- SDK: portal key + one memory call  
- Desktop: preview build only; agent turn; **explicit demo-panel notes**

**P2 — regression / soak**

- Fleet multi-agent on Desktop  
- Connector OAuth round-trip in a secrets-rich env  
- Video job success/fail copy  
- Erase/audit governance path for a test project  

### 9.4 Bug triage hints (product-visible)

| Symptom | Likely class | Product action |
|---|---|---|
| Connector buttons do nothing useful | Missing OAuth secrets (gated) | Don’t file as “agent dumb”; track as ops gate |
| Video shows stub / odd failure | Pipeline not fully wired | Don’t claim studio live |
| Desktop CRDB empty/fake | Demo fixtures | Not a Sev-1 “database down” unless eng says live path |
| Checkout fails, Connect works (or reverse) | Wrong Stripe secret family | Ops, not copy tweak |
| Memory missing across surfaces | Wrong project link / auth | Check project + account before “memory broken” epic |

---

## 10. Open product decisions & risks

| # | Item | Owner lens | Recommendation |
|---|---|---|---|
| 1 | When to call Desktop “available” | Product | Only with Preview badge + unsigned disclosure + no CRDB-live claims |
| 2 | Chrome store live version vs repo 0.6.1 | Product + Ops | Confirm console before press/sales |
| 3 | Claims audit Product sign-off | Product | Block external creative/connector campaigns until signed |
| 4 | Connector launch set (which 2–3 first) | Product | Ship fewer live connectors over many inert ones |
| 5 | SDK external launch readiness | Product | Portal + key UX exist; finish usage/billing story before heavy outbound |
| 6 | IDE on Microsoft Marketplace | Product | Decide consciously; today Open VSX only |
| 7 | Free vs paid creative messaging | Product + QA | Keep UpgradeModal/Settings/store aligned every release |
| 8 | Admin/ops portal for customers | Product | Still **not built** — don’t sell it |
| 9 | Multi-year memory audit expectations | Product + BA | Sell governance/erase/audit; don’t sell year-scale asOf |
| 10 | Desktop fleet approval correctness | Eng + QA | Known risk; treat parallel-agent bugs as trust Sev |

---

## 11. Maturity roadmap language (for planning, not dates)

Use stages in planning docs so status cannot silently inflate:

| Stage | Meaning | Surfaces roughly here |
|---|---|---|
| **S0 — Prototype** | Works on a laptop for authors | — |
| **S1 — Dogfood** | Internal users daily; sharp edges OK | Desktop |
| **S2 — Closed preview** | Friendly externals; explicit limitations list | SDK early adopters, selective Desktop |
| **S3 — General availability** | Supportable, claims-signed, gated features either live or hidden | Web (near), Chrome/IDE/CLI (distribution-ready with ops) |
| **S4 — Scale / enterprise pack** | Admin, SSO depth, retention productisation, signed desktop, full SLOs | Aspirational |

Promoting a surface a stage requires **evidence** (smoke + claims sign-off + gates), not optimism.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Surface** | A user-facing product entry point (Web, Chrome, IDE, CLI, SDK, Desktop) |
| **Shared memory** | Durable project knowledge stored once, recalled from many surfaces |
| **Source surface** | Tag for where a memory write originated |
| **Cloud agent** | Agent running in WalkCroach backends (Web/Chrome) |
| **Local coding agent** | Agent running with the user’s editor/CLI/Desktop tools |
| **BYOK** | Bring your own key — user-supplied model credentials for local coding agents |
| **Propose → confirm → execute** | Mandatory human confirmation before sensitive actions |
| **Credits** | Metered usage balance |
| **Hard quota** | Absolute cap that credits cannot bypass |
| **Connector** | OAuth integration to an external system (email, calendar, Slack, …) |
| **Creative** | Image / document / video generation features on Web |
| **Developer portal** | In-Web area for API keys, docs, governance |
| **SDK** | Programmatic client for memory/content/keys |
| **MCP** | Model Context Protocol — tool bridge; our public MCP focus is memory |
| **Open VSX** | Open extension marketplace used by Desktop/IDE distribution |
| **Preview / insider** | Non-production Desktop quality channel |
| **Gate** | External dependency (secret, entitlement, publish) without which a feature is inert |
| **Demo fixture** | Fake UI data — must not be accepted as integration success |
| **asOf** | Point-in-time memory view — short window only today |
| **Supersede** | Retire an older memory in favour of a newer related one |
| **Erase tombstone** | Erase that remains auditable rather than silent hard-delete of history |

---

## 13. Document map (where to go next)

| Need | Document |
|---|---|
| Engineering depth, versions, infra, gap IDs | [`walkcroach-master-doc.md`](./walkcroach-master-doc.md) |
| Dual-agent policy & non-goals | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Web marketing/privacy claim checklist | [`web-claims-audit.md`](./web-claims-audit.md) |
| Prod smoke steps | [`smoke-and-redirects.md`](./smoke-and-redirects.md) |
| Chrome threat / abuse angles | [`walkcroach-chrome-threat-model.md`](./walkcroach-chrome-threat-model.md) |
| Desktop detail | [`walkcroach-desktop.md`](./walkcroach-desktop.md) + Desktop `STATUS` / `SHIPPING` |
| Docs index | [`README.md`](./README.md) |

---

## 14. Decision / Ask

**This document’s product assertion:** WalkCroach is a **six-surface platform with shared memory and strict confirmation on sensitive actions**, at **uneven maturity**. Web is the richest Ready surface; Chrome/IDE/CLI are distribution-ready with ops gates; SDK is a real developer product centred on memory/content; Desktop is **Preview**.

**Ask of PM / BA / QA readers:**

1. Use **§0 and §7** before any external narrative.  
2. Write acceptance criteria that name **gates** (secrets, entitlements, preview).  
3. Fail demos that present **demo fixtures** or **unsigned Desktop** as GA.  
4. When engineering status and this doc disagree, escalate — then update **this file** so Product truth does not drift again.
