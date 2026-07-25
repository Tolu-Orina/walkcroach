# Changelog

## 0.1.4 — 2026-07-25

Hotfix — restore API connectivity after Public CWS approval:

- Add **narrow** `host_permissions` for the WalkCroach API host only (fixes side-panel `Failed to fetch` when CORS ACAO is the web SPA origin)
- Chrome BFF CORS reflects `chrome-extension://` Origins (defense in depth; requires Lambda redeploy)
- Bootstrap Retry + clearer network error copy
- Insert-into-page reports focus failure; Copy clipboard fallback
- Side panel behavior set on every service-worker start
- Store justifications / privacy: distinguish API host vs page hosts

## 0.1.3 — 2026-07-23

Chrome Web Store review path B — activeTab-only:

- Removed optional host permissions (`http://*/*`, `https://*/*`) and content scripts / FAB
- Page extract and draft insert via `scripting.executeScript` after toolbar open
- Trust tab explains toolbar-only access (no origin revoke list)
- Store justifications and listing updated for no host permissions

## 0.1.2 — 2026-07-23

Public Chrome Web Store Phase 1 packaging:

- Production `npm run zip:prod` (HTTPS API + privacy bake, localhost refused)
- Privacy policy finalized for live host (no draft placeholders)
- Store kit updated with production URLs; listing soft-pedals Web account linking for v1
- Screenshot capture runbook under `store/SCREENSHOTS.md`

## 0.1.1 — 2026-07-18

Security and reliability review fixes (post Phase D):

- Draft stream ownership check (IDOR)
- Cognito upgrade requires deviceKey proof-of-possession
- Mirrored Web memory cleaned on capture/workspace delete and unlink; refreshed on patch
- FAB `sidePanel.open` stays in user-gesture turn; extract via `scripting.executeScript` fallback
- Permission requested before extract; draft gated like summarize/save
- Stream auth failures return HTTP 401; device/LLM rate limits; price history capped
- Cognito expiry fallback to device session; NDJSON parse hardening

## 0.1.0 — 2026-07-18

First store-candidate packaging of WalkCroach Chrome.

- Phase 0–C: device session, summarize/ask/draft/recall, workspaces/captures, sector profiles, Web project link
- Phase D: privacy policy (`web/public/chrome-privacy.html`), store submission kit under `store/`, enterprise policy stub, permission telemetry
