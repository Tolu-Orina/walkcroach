# Chrome Web Store submission checklist (PD.5–PD.6)

## Build artifact

```bash
cd chrome
npm ci
npm run typecheck
npm run test
npm run zip
# → chrome/.output/*.zip (WXT store zip)
```

CI (`chrome/buildspec.yml`) already runs typecheck, test, build, and zip.

## Versioning (semver)

See `../VERSIONING.md`. Bump `chrome/package.json` `version` before every store upload.

## Pre-submit

- [ ] Privacy policy live on HTTPS (`/chrome-privacy.html` on Web host)
- [ ] Dashboard privacy practices filled from `PRIVACY_PRACTICES.md`
- [ ] Permission justifications pasted from `PERMISSION_JUSTIFICATIONS.md`
- [ ] Remote code = No
- [ ] Listing copy from `STORE_LISTING.md`
- [ ] ≥1 screenshot uploaded
- [ ] `WALKCROACH_API_BASE` baked into the zip points at production API (not localhost)
- [ ] Manifest has no required host permissions / no `<all_urls>` at install
- [ ] Smoke: install unpacked → summarize → save → revoke origin

## Submit (operator action)

1. Chrome Web Store Developer Dashboard → Upload new package (zip from `npm run zip`)
2. Distribution: start **Unlisted** or **Trusted testers**, then Public when ready
3. **Buffer:** first publisher account often **7–14 business days**; otherwise often **2–5** (NFR-C17)
4. Do not schedule a hard demo on “submit day”

## After approval

- Follow `POST_SUBMIT_MONITORING.md`
- Optional: distribute `../enterprise/policies.json` stub to IT evaluators
