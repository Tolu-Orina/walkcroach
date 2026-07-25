# Chrome Web Store submission checklist — Public CWS (v0.1.4)

Production endpoints (do not substitute localhost):

| Item | Value |
|------|-------|
| API | `https://awbcf4clij.execute-api.eu-west-2.amazonaws.com/v1` |
| Privacy | `https://walkcroach.conquerorfoundation.com/chrome-privacy.html` |
| Product | `https://walkcroach.conquerorfoundation.com` |
| Extension version | `0.1.4` |

## Why 0.1.4

v0.1.3 removed broad page hosts (good for review) but also omitted the **API** host permission.
Side-panel `fetch` then hit CORS (`ACAO` = web SPA only) → **Failed to fetch**.
0.1.4 adds only `https://awbcf4clij.execute-api.eu-west-2.amazonaws.com/*`.

## Engineering

- [x] Narrow API `host_permissions` in `wxt.config.ts`
- [x] Chrome BFF CORS reflects `chrome-extension://` (redeploy Lambda)
- [x] Bootstrap Retry + network error copy
- [x] Privacy + permission justifications updated
- [ ] Redeploy Web privacy page
- [ ] Redeploy Chrome Lambda (CORS)
- [x] `npm run zip:prod` → `walkcroachchrome-0.1.4-chrome.zip`
- [ ] Smoke unpacked: open panel → Connecting… → Page tabs (no Failed to fetch)
- [ ] Upload 0.1.4 to CWS (permission justification for API host)

## Smoke

1. Load `.output/chrome-mv3` unpacked (or wait for store update).
2. Open side panel → must connect without “Failed to fetch”.
3. Toolbar on https page → Summarize → Save → Recall.
4. Manifest: API host only; no `content_scripts`; no `https://*/*`.

## Dashboard

- Paste updated `PERMISSION_JUSTIFICATIONS.md` (include API host row)
- Remote code = **No**
- Package = `0.1.4` zip
