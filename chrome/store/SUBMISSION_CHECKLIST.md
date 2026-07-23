# Chrome Web Store submission checklist — Public CWS (v0.1.3)

Production endpoints (do not substitute localhost):

| Item | Value |
|------|-------|
| API | `https://awbcf4clij.execute-api.eu-west-2.amazonaws.com/v1` |
| Privacy | `https://walkcroach.conquerorfoundation.com/chrome-privacy.html` |
| Product | `https://walkcroach.conquerorfoundation.com` |
| Extension version | `0.1.3` |

## Phase 1 — engineering (this release)

- [x] Privacy policy copy finalized (no draft placeholders) in `web/public/chrome-privacy.html`
- [ ] **Redeploy Web** so live `/chrome-privacy.html` matches repo (operator / pipeline)
- [x] `npm run zip:prod` script (HTTPS bake + localhost scan)
- [x] Version `0.1.3` — **activeTab-only** (no optional hosts / content_scripts) for faster CWS review
- [x] Store kit URLs + permission justifications updated
- [x] Run `npm run zip:prod` and keep the emitted `.zip`
  - Artifact: `chrome/.output/walkcroachchrome-0.1.3-chrome.zip`
- [ ] Smoke unpacked prod build (below)
- [x] Capture screenshots per `SCREENSHOTS.md` (Trust UI changed in 0.1.3)

## Smoke (unpacked prod build)

1. Load `chrome/.output/chrome-mv3` as unpacked extension.
2. Open an https page → click WalkCroach **toolbar** icon → Summarize (no “grant site access” prompt).
3. Save to a workspace → open Recall → confirm answer references the save.
4. Trust tab → privacy link opens live HTTPS policy (no revoke-origins list).
5. Confirm DevTools Network calls go to `awbcf4clij.execute-api…` (not localhost).
6. Confirm unpacked manifest has **no** `content_scripts`, **no** `optional_host_permissions` / host patterns.

## Dashboard (paste before upload)

- [ ] Privacy policy URL = live HTTPS above
- [ ] Privacy practices from `PRIVACY_PRACTICES.md`
- [ ] Permission justifications from `PERMISSION_JUSTIFICATIONS.md` (**no host-permission field**)
- [ ] Remote code = **No**
- [ ] Listing from `STORE_LISTING.md`
- [ ] ≥3 screenshots uploaded (`store/screenshots/01`–`05`)
- [ ] Store icon **128×128** uploaded — `store/icon-128.png`
- [ ] Package = `0.1.3` zip from `zip:prod`
- [ ] Manifest: no host permissions / no `<all_urls>` / no content_scripts

## Submit (Phase 2 — operator)

1. Chrome Web Store Developer Dashboard → Upload package (`0.1.3` zip).
2. Prefer brief **Unlisted / Trusted testers** smoke, then set **Public**.
3. Buffer **2–5** business days (or **7–14** if first publisher account). Broad-host in-depth review should **not** apply to this package.
4. Do not schedule a hard launch on submit day.

## After approval

- Follow `POST_SUBMIT_MONITORING.md`
- Put real extension id into `../enterprise/policies.json`
