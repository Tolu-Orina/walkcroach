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
