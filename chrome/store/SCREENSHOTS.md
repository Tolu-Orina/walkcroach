# Screenshot runbook (Phase 1 — required for Public CWS)

Chrome Web Store prefers **1280×800** (or 640×400). This repo ships store-ready PNGs rendered from the real side-panel CSS fixture.

## Generated assets (ready to upload)

| File | Scene |
|------|--------|
| `01-summarize.png` | Page tab + streamed summary |
| `02-trust.png` | Trust tab + privacy link + session (activeTab-only copy) |
| `03-workspaces.png` | Workspaces + capture list |
| `04-sector.png` | Retail track-price proposal |
| `05-recall.png` | Recall answer |

All are **1280×800** PNG.

## Regenerate

```bash
# from repo root (requires Playwright Chromium from tests/)
cd tests && npx playwright install chromium   # once
cd ..
node chrome/store/screenshots/capture.mjs
```

Fixture: `_fixture.html` (matches `entrypoints/sidepanel/style.css` tokens).

## Optional: live extension captures

For strictly live UI (toolbar + real Wikipedia), install `npm run zip:prod` unpacked and replace these PNGs. Fixture shots are acceptable for first public submit when they accurately represent the product UI.

## Status

- [x] `01-summarize.png`
- [x] `02-trust.png`
- [x] `03-workspaces.png`
- [x] `04-sector.png`
- [x] `05-recall.png`

## Stale after v0.3.0 (Phase C redesign)

Every screenshot in this directory predates the Graphite Lumen redesign and shows
the old green utility panel with the four-tab nav. **They must all be recaptured
before the next store upload** — a listing that does not match the shipped UI is a
review risk and a conversion problem.

Recapture must cover, per plan F2:

| Shot | State |
|---|---|
| 1 | Page surface, populated — brand header, context, one amber CTA |
| 2 | In-context site grant — Chrome's own prompt naming a single site |
| 3 | Confirm card — "Save this page?" showing exactly what gets written |
| 4 | Recall — cross-surface memory answer |
| 5 | Account & sites — real allowed-site list with Revoke |

Notes:
- The panel now follows the browser colour scheme. Capture in **dark**, which
  matches WalkCroach Web's default and the store listing artwork.
- Capture at ~360px (Chrome's default panel width). The layout also adapts at
  250px and 480px via container queries, but a 250px shot reads as cramped in a
  listing.
- The first-run coach mark only appears once per profile; clear
  `wc_coach_seen_v1` from extension storage to capture it.
