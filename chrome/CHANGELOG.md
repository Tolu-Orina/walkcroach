# Changelog

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
