# Screenshot runbook (Phase 1 — required for Public CWS)

Chrome Web Store requires at least one screenshot. Capture **from the `0.1.2` prod zip** (not localhost).

## Prep

```bash
cd chrome
npm run zip:prod
# Load unpacked: chrome/.output/chrome-mv3
# Or pack from the generated .zip in Chrome Developer Dashboard after capture
```

1. Install the **prod** build (API = `awbcf4clij…/v1`).
2. Open a normal https content page (e.g. a Wikipedia article or product listing).
3. Click the **WalkCroach toolbar icon** (FAB may be absent until host permission is granted).
4. On first Summarize, **Allow** site access when Chrome prompts.

## Required shots (1280×800 preferred; 640×400 accepted)

Save as PNG under `chrome/store/screenshots/`:

| File | Content |
|------|---------|
| `01-summarize.png` | Side panel with a streamed page summary visible |
| `02-trust.png` | Trust tab showing granted origin + revoke + privacy link |
| `03-workspaces.png` | Workspaces tab with at least one capture listed |
| `04-sector.png` *(optional)* | Sector proposal / editable fields before save |
| `05-recall.png` *(optional)* | Recall answer after a prior save |

## Capture tips

- Hide personal emails / tokens from the Trust tab if visible.
- Prefer a non-sensitive demo page.
- Do not show localhost errors or “Connecting…” failure states.

## Status

- [ ] `01-summarize.png`
- [ ] `02-trust.png`
- [ ] `03-workspaces.png`
- [ ] Optional extras

Operator action: take screenshots locally; binaries are gitignored by default.
