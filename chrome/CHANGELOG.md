# Changelog

## 0.5.0 — 2026-07-30

Phase E — workflow connectors. Built as a **cross-surface platform**, not a Chrome
feature: Web Chat, the Chrome side panel, the IDE and the CLI consume one package,
one schema, one action catalogue and one set of OAuth scopes.

**Shared platform (`@walkcroach/connectors`)**

- New workspace package. `providers.ts` (registry + scopes), `actions.ts` (the
  catalogue and its validation gate), `oauth.ts` (PKCE, authorize URLs, exchange,
  refresh), `vault.ts` (Secrets Manager), `store.ts` (persistence),
  `execute.ts` (the single confirmed-write path).
- Migration `020_connectors.sql`: `connectors`, `connector_oauth_states`,
  `workflow_runs`. Reconciles the two plans — master §3.3 says tokens are never in
  the table, web §6.2 lists `secret_ref`; both hold, because `secret_ref` is a
  Secrets Manager *name*. The schema is anchored on `owner_id` + `surface` rather
  than `session_id`, because Chrome has no `sessions` row and could not otherwise
  record a run.
- Scope minimisation is defined once: `calendar.events` not `calendar`,
  `gmail.compose` not `gmail.readonly`, Stripe `read_only`. A surface cannot
  request more than another.

**Security (E9)**

- **Deny by default.** An action absent from the catalogue cannot execute,
  whatever the model emits.
- **Arguments validated, not trusted.** Recipient format (a display-name wrapper
  like `Alex <a@b> , attacker@evil` is rejected), recipient count, field lengths,
  date sanity, and CR/LF rejected in single-line fields — that last one is what
  stops header injection appending a `Bcc:` to the RFC 822 message.
- **Unknown fields dropped**, so a model cannot append a provider parameter the
  catalogue never sanctioned.
- **Confirm carries no payload.** `execute` re-reads the proposal from storage and
  re-validates it, so confirming cannot substitute a different recipient between
  seeing the card and clicking it.
- **Exactly once.** The claim is a status-predicated UPDATE, so a double-clicked
  confirm cannot send twice.
- Declined and failed runs are retained — "what did the agent try to do on my
  behalf" is an audit question.

**Chrome surface (E1, E2, E4)**

- Chrome is deliberately thin: status and execute only. Connecting happens on
  WalkCroach Web, resolving the plan's open decision §9.2 — one redirect URI per
  provider instead of one per surface, and the extension is never an OAuth client.
- Connectors section in Account: connection state, account label, last error,
  the exact scopes granted, and disconnect. An account connected in Web Chat is
  immediately usable here, and disconnecting here applies everywhere.
- `ConfirmCard` gains an `irreversible` variant — ember edge and an explicit
  "This cannot be undone", distinct from the amber used for ordinary saves.
- Anonymous device sessions cannot reach a connector at all: a connection belongs
  to an account, not a browser.

**Tests** — 54 on the shared package, 16 on the Chrome routes. The Chrome suite
stubs only the network, leaving validation and the catalogue real, so a route that
tried to bypass the platform would fail.

**Not done, and honestly out of scope for this pass:** E3 (agent tool-calling, which
needs the shared harness from master §3A), E5 (page-aware connector prompts, which
depends on E3), E6 (Stripe is defined and validated but has no OAuth app), and E7
(credit debits — weights are declared per action, but the ledger from Part 1 §4
does not exist yet). The Web-side OAuth callback route (CX-B) is also still to
build; until it exists no account can actually be connected, so the whole feature
ships inert behind `configuredProviders()`.

## 0.4.0 — 2026-07-30

Phase D — sector depth and memory excellence. Three data-correctness bugs fixed
along the way, all of which produced plausible-looking wrong answers.

**Structured extraction hardened (D1)**

- Per-capture-type field rules replace one generic prompt. The most important is
  candidate `contact`: the model is now told to emit an email or phone **only if
  it appears verbatim**, and never to construct one from a name and company. This
  is the one field where a hallucination causes real-world harm — the user emails
  a stranger.
- `normalizeProposal` forces the response into exactly the requested keys, in
  order: unrequested keys dropped, missing keys filled with `""`, arrays joined
  (models return arrays for `skills` despite the prompt), non-finite numbers and
  objects discarded, control characters stripped, each field capped at 400 chars
  so a model cannot dump the page into `notes`.
- "N/A", "unknown", "not stated" and friends are read as empty, so the confirm
  card no longer offers to save the literal string "N/A".
- An all-empty extraction now says *"nothing on this page looks like a
  candidate"* instead of presenting a confirm card of blank inputs.

**Price tracking (D2)**

- **Duplicate history points fixed.** Every visit used to append a point, so
  re-opening a product page five times wrote five identical entries — flattening
  the sparkline, making "checks" a measure of browsing rather than price
  movement, and burning the 100-point cap with duplicates so genuine older
  movement was evicted. History now records *changes*; an unchanged price moves
  the last point's timestamp instead.
- **European decimal commas fixed.** `coercePrice` stripped every comma, turning
  "€45,50" into **4550** — a hundredfold error stored as a real price. Which
  separator is decimal is now decided by position, the way a person reads it.
- In-panel history reports changes rather than visits, adds the observed range,
  and flags when the current price is the lowest seen.

**Selection capture (D3 — FR-C05)**

- "Save selection to WalkCroach" on the right-click menu, shown only when text is
  selected. Prefers `window.getSelection()` over `info.selectionText`, which
  Chrome truncates near 1k characters — exactly clipping the long quote a user
  most wants to keep.
- Only the highlighted words leave the page, and the confirm card shows them
  back. Saved as its own `selection` capture type with its own hash space, so a
  highlight never collides with the page it came from.

**Recall shows its working (D5)**

- Recall now emits the captures an answer was built from, and the panel renders
  them numbered to match the `[2]` markers in the prose, with capture type,
  workspace, when it was saved, and an **also in Web** badge when the capture is
  mirrored into a linked project. Previously the model was asked to cite sources
  and the panel received only a count — so an answer was unauditable.

**Remote site profiles (D6)**

- Profiles can now be updated without a store review: a signed bundle served from
  our own API, verified in-extension with Ed25519 against a public key baked into
  the build, then schema-validated field by field and rejected whole if any entry
  is malformed. Host suffixes may not contain wildcards, paths or ports, so a
  bundle cannot widen matching beyond what its label implies. Version must
  increase, so a captured response cannot roll profiles backwards.
- Fails closed to the packaged bundle in every failure mode, including "no
  signing key configured" — which is the current state, so this ships inert.
- `npm run sign-profiles` generates keys and signs a bundle. Node-signs →
  WebCrypto-verifies interop is covered by a real test, not a mock.

**Screenshot-to-memory (D4)**

The backend slice this needed now exists, so the long-dormant
`page_captures.screenshot_s3_key` column is finally real.

- New shared `@walkcroach/storage` workspace package: S3 put/get/delete plus
  presigned PUT and GET, with the repo's usual `.local-artefacts` fallback so
  `npm run dev:chrome` works with no AWS credentials. (`lambda-agent` still has
  its own older copy of the get/put half; migrating it is a follow-up.)
- New Chrome BFF routes under `/captures/:id/screenshot` — `presign`, `commit`,
  direct `POST`, and a `GET` that returns a short-lived signed read URL.
  **Presigned PUT is the primary path**, so image bytes never traverse the
  Lambda; a direct POST through the BFF is the fallback for local development
  and for before bucket CORS names the published extension ID.
- Terraform: private, encrypted, versioning-off captures bucket with 90-day
  lifecycle expiry, CORS scoped to `chrome-extension://` origins, and an IAM
  policy scoped to the `chrome/*` prefix rather than the whole bucket.
- Keys are namespaced per account and checked on every read, so a signed URL can
  never be minted for another account's object. Uploaded bytes are verified as
  actual JPEG before storage — the content type is echoed back on download, so a
  mislabelled file would be an XSS vector.
- Client captures the **visible viewport only**, downscales to a 1200px long edge
  and re-encodes as JPEG in the service worker — a raw capture on a large monitor
  is 2–4MB, far too big to pass to the panel or the network.
- Strictly opt-in per save, gated behind the same per-site access as page reads,
  with the image shown back on the confirm card before it is stored, and deleted
  along with its capture. Offered only for page and selection captures — a price
  track re-checks a URL over time, so a snapshot of one visit would be noise.
- No new manifest permission: `captureVisibleTab` is covered by the per-site
  access the user already granted.

**Tests (D7)**

- `propose` (27), `price-track` (21), `link` + `upgrade` (15) on the Lambda —
  closing the audit's thin-coverage finding. The link/upgrade suite covers the
  security-relevant gates: who may link a Web project, and that the device key is
  looked up by hash and never accepted below 16 characters.
- Chrome: selection normalisation, profile schema, signature interop, recall
  sources, price history copy, screenshot sizing. Screenshot handler guards on
  the Lambda cover ownership, JPEG validation, and size limits.
  **263 chrome + 101 lambda.**

## 0.3.0 — 2026-07-30

Phase C — visual and interaction redesign. The panel now reads as WalkCroach
rather than as a green utility drawer, and every write is confirmed.

**Graphite Lumen (C1)**

- Design tokens lifted verbatim from `web/src/index.css` so the two surfaces cannot
  drift, with a contrast suite (`tokens.test.ts`) parsing the real stylesheet.
- Follows the browser colour scheme via `prefers-color-scheme`, mirroring Web's own
  `resolveTheme()`. A side panel is framed by browser chrome that is itself light or
  dark; a hard-coded slab reads as broken next to half the web. `[data-theme]`
  overrides win in both directions.
- **Three deliberate light-mode divergences from Web, all accessibility fixes**, same
  hue and saturation: steel `#3b6fd4`→`#3067d2` (was 4.48:1 under 10.5px eyebrow
  text), ember `#c2410c`→`#c0400c` (4.45:1 on `--raised`), and a new `--focus`
  token `#b47f09` because `#c48a0a` was 2.83:1 against paper, under the 3:1 that
  non-text UI requires. Everything now clears WCAG AA on every surface in both modes.
- Self-hosted Bricolage Grotesque / Source Sans 3 / JetBrains Mono, latin-subset
  woff2 only — the aggregate `@fontsource` entrypoints shipped ~900kB of cyrillic,
  greek and vietnamese plus legacy `.woff`. Bundle: 1.23MB → **479kB**.
- The auth page is themed too; it was the last green surface in the flow.

**Components and IA (C2, C3)**

- `App.tsx` decomposed into `BrandHeader`, `ContextHeader`, `AccessNotice`,
  `PrimaryActions`, `Stream`, `ConfirmCard`, `PriceHistory`, `NavRail`, `CoachMark`,
  `CreditMeter`, `SitesPanel`, `EmptyState`, plus an inline SVG icon set (no icon
  dependency).
- Page-first: brand → context → one obvious action → results. Secondary navigation
  is a bottom rail with ARIA tab semantics and roving tabindex.
- The wordmark is display-weight and the largest text in the panel, so the brand test
  passes with the nav stripped.

**Bottom-docked composer**

The first cut of the redesign followed the plan's §3.2 sketch literally and put the
Ask field with the page actions at the top. That was wrong, and it shipped a real
bug: the field and the **Stop** control both lived inside the scrolling region, so
after a long summary a follow-up question meant scrolling back up, and cancelling
mid-generation could scroll out of reach entirely.

- New `Composer`, docked in the shell grid (`auto 1fr auto auto`) so only the
  content row scrolls. Verified in Chrome: the composer is a direct shell child,
  not a descendant of `.wc-main`.
- The send control becomes **Stop** while generating — one control, two states,
  the convention every chat surface uses.
- `textarea` with `field-sizing: content` (Chromium 123+, so no JS measuring
  loop), capped at ~5 lines. Enter sends, Shift+Enter breaks the line, and IME
  composition is not interrupted mid-character.
- One composer serves the panel, relabelled per pane: Page asks about the page,
  Recall asks the memory, Saved and Account render none. The web-search toggle
  moved here, since it only ever modified Ask.
- Page verbs (sector action / Summarize / Draft / Save) deliberately stay at the
  top: they are one-shot actions *about the page*, and they belong beside the page
  context they operate on.
- Send is **not** amber, and the composer does not autofocus on the Page pane —
  both caught by looking at the rendered panel. An amber send competed with the
  page CTA for the one-amber-per-screen rule, and autofocus on mount jumped a
  screen reader straight past the site-access notice. Recall still autofocuses,
  since arriving there is a deliberate navigation to a query surface.

**Propose → confirm → execute (C4)**

- **Two silent writes fixed.** `track_price` called `trackPrice()` the instant the
  model's proposal arrived, and plain Save committed immediately. Both now route
  through a single `PendingWrite` state and `ConfirmCard`; nothing reaches
  CockroachDB without an explicit confirm.
- Save shows a read-only summary of exactly what will be stored (page, source, text
  length, destination workspace) rather than a bare button.
- Edited proposal fields win over the model's originals on commit, and fields lock
  while a write is in flight so the payload cannot change mid-request.

**Adaptive layout and motion (C5)**

- Container queries against `.wc-shell`, not viewport media queries — the panel's
  width has nothing to do with the monitor. Verified in real Chrome at 250 / 340 /
  420px: rail labels appear at ≥340px, the rail turns horizontal and type scales up
  at ≥400px, and the action row collapses to a single column under 290px.
- Three interaction motions (mount fade, confirm entrance, streaming caret) plus a
  bootstrap skeleton shimmer, all collapsed under `prefers-reduced-motion`.

**Teaching states (C6)**

- One first-run coach mark explaining the per-site permission model, dismissed
  permanently to a versioned storage key.
- Empty states name the action that fills them instead of reporting absence.

**Credits (C7)**

- `CreditMeter` renders only once `fetchCredits` returns real data. The endpoint does
  not exist yet and returns `null`, so nothing shows — a fabricated balance in a
  trust-first product is worse than no balance. It lights up when Part 1 §4 ships,
  with no client change.

**Accessibility**

- Streaming announces coarse status (`Generating…` / `Response complete`) rather than
  every token, which would flood a screen reader and make the panel unusable.
- Focus order follows visual order; focus rings meet 3:1 on every surface; the price
  sparkline is `aria-hidden` behind a text delta; the credit bar is a `meter` with
  `aria-valuetext`.

**Tests**

- 30 component tests (jsdom + Testing Library) across `ConfirmCard`, the access gate,
  and stream cancellation — including that Insert/Copy are withheld mid-stream so half
  a draft cannot be pasted, and that a confirm cannot double-execute.
- 16 token contrast tests covering both modes and pinning the Web-parity values.
- Dropped `@vitejs/plugin-react`: esbuild already handles JSX from tsconfig, and the
  plugin dragged in a second `vite` whose Plugin type broke `tsc`.

**Note for the store:** every screenshot in `store/screenshots` predates this redesign
and must be recaptured before the next upload (see `store/SCREENSHOTS.md`).

## 0.2.0 — 2026-07-29

Phase A (unblock) + Phase B (auth hardening, Trust honesty) of the Chrome evolution plan.
Both live user-blocking bugs are fixed.

**Bug A — page access from the side panel**

Chrome does not activate `activeTab` for clicks *inside* a side panel (only toolbar action,
context menu, commands shortcut, and omnibox qualify). The `activeTab`-only model therefore
could never support "open the panel once, then Summarize as you browse" — clicking Summarize
returned "no active tab — click the WalkCroach toolbar icon on the page first", and doing so
did not help, because the next in-panel click still did not qualify.

- Added `optional_host_permissions` for `http(s)://*/*` — **no install-time warning**. The
  panel requests one origin at a time via `chrome.permissions.request` from the click that
  needs it, which *is* a qualifying gesture (`lib/permissions.ts`, revived from a stub).
- New page-access state machine (`lib/page-access.ts`): `ready` / `needs-grant` / `restricted` /
  `unknown` / `no-tab`. Each state names the one action that resolves it, so the panel renders
  a button instead of an apology. Restricted pages disable the actions rather than failing.
- Toolbar warm-cache: on panel open, any live `activeTab` window is spent once and the extract
  cached per tab in `chrome.storage.session` (`lib/extract-cache.ts`), dropped on navigation,
  tab close, and site revocation.

**Bug B — sign-in blocked by Chrome**

`auth.html` was not web-accessible, so Chrome blocked WalkCroach Web's redirect back into the
extension (`ERR_BLOCKED_BY_CLIENT`). Web issued a valid connect code that could never be
redeemed, and nothing errored server-side.

- Sign-in now completes through `chrome.identity.launchWebAuthFlow` with a
  `https://<id>.chromiumapp.org/auth` redirect — no web-accessible resource involved, and
  cancellation is observable. Web's custom Cognito pages are unchanged (no Hosted UI/Amplify).
- `auth.html` added to `web_accessible_resources`, scoped to the WalkCroach Web origin only,
  retaining the tab flow as a rollout fallback.
- `chrome.runtime.id` is validated before any redirect URI is built — no more
  `chrome-extension://invalid/...`.
- Chrome BFF and Web redirect allowlists accept both forms, still bound to `[a-p]{32}`.
- Extension ID pinnable via manifest `key` (`WALKCROACH_EXTENSION_KEY`); `scripts/extension-id.mjs`
  generates and verifies one. Store builds reject a local key.

**Gesture ownership — closes the residual gaps in the two fixes above**

`setPanelBehavior({ openPanelOnActionClick: true })` made Chrome swallow the toolbar click, so
`action.onClicked` never fired and we never observed the one moment `activeTab` is guaranteed.
That is why the warm cache was best-effort and why a page's URL could stay invisible.

- The action click is now handled directly: `sidePanel.open()` first (it needs the live gesture),
  then extract-and-cache on the `activeTab` grant that same click produced. That grant persists
  on the tab until it navigates, so the panel keeps the URL for the whole visit.
- Click-to-toggle preserved via `sidePanel.close()` (Chrome 141+), feature-detected so older
  Chrome falls back to re-opening rather than throwing. Panel liveness is tracked by a
  heartbeat port, which also keeps the worker alive so close is observed.
- Added a `contextMenus` item and an `Alt+Shift+W` `commands` shortcut — both are on Chrome's
  activeTab list, and both route through the same handler.
- Remaining `unknown` case is now only "switched to a brand-new tab with the panel already
  open and no gesture", where the on-screen instruction is finally truthful: that one click
  both opens the panel and resolves the state. `tabs` (and its browsing-history warning) is
  still not requested.

**Verification**

- `chrome/tests/manifest.test.ts` (`npm run test:manifest`, wired into CI after `build`) asserts
  the built artifact against the store packet — the drift that left `SUBMISSION_CHECKLIST.md`
  stranded on 0.1.4 now fails the build.
- `tests/e2e/chrome/page-access.spec.ts` drives real Chrome: `extractor.js` returns Readability
  content from a live page with nav/footer stripped, cache is per-tab, `chrome://` injection
  genuinely rejects, and the install-time API host cannot be revoked.
- The manual pre-upload gate drops from eight steps to two: the native permission prompt and the
  live OAuth round-trip, neither of which is automatable.

**Also**

- Mozilla Readability is finally the shipped extraction path: `entrypoints/extractor.ts` is a
  bundled unlisted script injected with `executeScript({ files })`. The old inline heuristic
  remains as a fallback only. No `content_scripts` declared.
- Trust tab rebuilt as **Account**: a real list of allowed sites with working per-site revoke
  (`chrome.permissions.remove`), replacing FR-C15 copy that described capabilities the
  `activeTab`-only build did not have.
- `store/POST_SUBMIT_MONITORING.md` rewritten — dead `chrome.permission.grant/revoke` metrics
  retired; added a sign-in success ratio that would have caught Bug B.
- Tests: `permissions`, `page-access`, `extract-cache`, redirect-URI/callback parsing, message
  contract, and `chromiumapp.org` allowlist cases on the Lambda.

## 0.1.5 — 2026-07-25

Unreleased batch since 0.1.4 (deploy as one package):

**P0 — Web Cognito login (IDE-style)**
- Trust → Sign in with WalkCroach → `/connect/chrome` → `auth.html` one-time code
- Merges device session via `/auth/upgrade`

**P1 — Web Chat bridge**
- Ask: optional Include web search (SearXNG pre-ground)
- Open in Web Chat via one-time handoff (`/app/chat?handoff=`)

**P2 — Shared memory**
- Project Remembered: Chrome filter/badge for `source_surface=chrome`
- Draft injects linked project standing instructions + memory summary

**Review fixes (pre-deploy)**
- No device-session remint loop on side-panel bootstrap
- Cognito re-connect after sign-out; refresh via `/oauth/refresh`
- OAuth consume validates state+redirect atomically
- Chat handoff owner-bound + StrictMode-safe; Open in Web Chat requires Cognito
- Draft linked-project hint only when a workspace is selected

Also from 0.1.4 line: narrow API `host_permissions`, CORS echo for extensions, Retry UX, new icons.

## 0.1.4 — 2026-07-25

Hotfix — restore API connectivity (narrow API host permission).

## 0.1.3 — 2026-07-23

ActiveTab-only (no broad page hosts / content scripts).

## 0.1.2 — 2026-07-23

Public CWS Phase 1 packaging.

## 0.1.1 — 2026-07-18

Security/reliability review fixes.

## 0.1.0 — 2026-07-18

First store-candidate packaging.
