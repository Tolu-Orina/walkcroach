# Chrome Web Store kit (Phase D / Public CWS Phase 1)

| Doc | Purpose |
|-----|---------|
| [SUBMISSION_CHECKLIST.md](./SUBMISSION_CHECKLIST.md) | Ordered path to Public submit (v0.6.2) |
| [PRIVACY_PRACTICES.md](./PRIVACY_PRACTICES.md) | Dashboard privacy tab + reachability gate |
| [PERMISSION_JUSTIFICATIONS.md](./PERMISSION_JUSTIFICATIONS.md) | Per-permission justifications |
| [STORE_LISTING.md](./STORE_LISTING.md) | Name, description, single-purpose |
| [SCREENSHOTS.md](./SCREENSHOTS.md) | Capture runbook |
| [POST_SUBMIT_MONITORING.md](./POST_SUBMIT_MONITORING.md) | CloudWatch / trust proxy |

**Live privacy policy:** https://walkcroach.rinegansolutions.com/chrome-privacy.html  
**Source:** `../../web/public/chrome-privacy.html` (redeploy Web after edits)  
Paste that exact URL into the CWS **Privacy practices** tab — Google checks the
dashboard field on `publish`, not the zip. If publish fails with “Privacy policy
link is not reachable”, fix the dashboard and re-run with `publish_only: true`.

**Prod zip:** from `chrome/`, run `npm run zip:prod`  
**Release:** tag `chrome-v*` → `.github/workflows/publish-chrome.yml`
