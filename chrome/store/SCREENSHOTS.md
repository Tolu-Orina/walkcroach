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

## Regenerating (v0.5.1+)

```bash
cd chrome && npm run build && npm run screenshots
```

`capture.mjs` loads the **real built extension** in Chromium and photographs the
actual panel, then composites it onto a branded 1280×800 backdrop with a caption.
It replaced a hand-written `_fixture.html` mock, which had already drifted from
the shipped UI — the failure mode store screenshots are most prone to, and the one
a reviewer notices fastest.

Only two things are stubbed: the BFF (so captures need no deployed backend) and
`chrome.runtime.sendMessage` (so a page-access state can be posed — Chrome will
not grant a real site permission to an automated run). All layout, tokens, fonts
and copy are the shipped code.

| # | File | Scene |
|---|------|-------|
| 1 | `01-page.png` | Page surface — brand, context, one primary action |
| 2 | `02-grant.png` | Per-site permission request naming a single site |
| 3 | `03-confirm.png` | Confirm card — exactly what will be saved, screenshot opt-in |
| 4 | `04-recall.png` | Recall answer with numbered cited sources |
| 5 | `05-account.png` | Account — allowed sites, revoke, connections |

The connectors list is stubbed **empty** on purpose: connectors are inert until an
OAuth app is registered, and a screenshot must not imply otherwise
(`SUBMISSION_CHECKLIST.md` §1).

The script exits non-zero if any capture is suspiciously small, which is what an
empty panel looks like when the stubs have drifted from the app.
