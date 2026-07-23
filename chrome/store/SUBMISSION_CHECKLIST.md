# Chrome Web Store submission checklist — Public CWS (v0.1.2)

Production endpoints (do not substitute localhost):

| Item | Value |
|------|-------|
| API | `https://awbcf4clij.execute-api.eu-west-2.amazonaws.com/v1` |
| Privacy | `https://walkcroach.conquerorfoundation.com/chrome-privacy.html` |
| Product | `https://walkcroach.conquerorfoundation.com` |
| Extension version | `0.1.2` |

## Phase 1 — engineering (this release)

- [x] Privacy policy copy finalized (no draft placeholders) in `web/public/chrome-privacy.html`
- [ ] **Redeploy Web** so live `/chrome-privacy.html` matches repo (operator / pipeline)
- [x] `npm run zip:prod` script (HTTPS bake + localhost scan)
- [x] Version `0.1.2` in `package.json` / `CHANGELOG.md` / `VERSIONING.md`
- [x] Store kit URLs updated (`PRIVACY_PRACTICES.md`, `STORE_LISTING.md`)
- [x] Run `npm run zip:prod` and keep the emitted `.zip`
  - Artifact: `chrome/.output/walkcroachchrome-0.1.2-chrome.zip`
- [ ] Smoke unpacked prod build (below)
- [ ] Capture screenshots per `SCREENSHOTS.md`

## Smoke (unpacked prod build)

1. Load `chrome/.output/chrome-mv3` as unpacked extension.
2. Open an https page → toolbar WalkCroach → Summarize → grant site access.
3. Save to a workspace → open Recall → confirm answer references the save.
4. Trust tab → privacy link opens live HTTPS policy → revoke origin.
5. Confirm DevTools Network calls go to `awbcf4clij.execute-api…` (not localhost).

## Dashboard (paste before upload)

- [ ] Privacy policy URL = live HTTPS above
- [ ] Privacy practices from `PRIVACY_PRACTICES.md`
- [ ] Permission justifications from `PERMISSION_JUSTIFICATIONS.md`
- [ ] Remote code = **No**
- [ ] Listing from `STORE_LISTING.md` (Chrome-only lead; soft-pedal Web linking)
- [ ] ≥3 screenshots uploaded
- [ ] Package = `0.1.2` zip from `zip:prod`
- [ ] Manifest: no required host permissions / no `<all_urls>` at install

## Submit (Phase 2 — operator)

1. Chrome Web Store Developer Dashboard → Upload package (`0.1.2` zip).
2. Prefer brief **Unlisted / Trusted testers** smoke, then set **Public**.
3. Buffer **2–5** business days (or **7–14** if first publisher account).
4. Do not schedule a hard launch on submit day.

## After approval

- Follow `POST_SUBMIT_MONITORING.md`
- Put real extension id into `../enterprise/policies.json`
