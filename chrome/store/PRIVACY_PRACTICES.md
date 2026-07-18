# Chrome Web Store — privacy practices form (PD.2)

Align every checkbox with the shipping manifest and [privacy policy](../../web/public/chrome-privacy.html)
(HTTPS URL after web deploy: `https://<your-web-host>/chrome-privacy.html`).

Reference: [CWS Privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## Single purpose

See `PERMISSION_JUSTIFICATIONS.md`.

## Remote code

Select: **No, I am not using remote code.**

## Privacy policy URL

`https://<your-web-host>/chrome-privacy.html`  
(Ship `web/public/chrome-privacy.html` with the Web app before submission.)

## Data usage disclosures (typical CWS checkboxes)

Check only what you collect on explicit user action:

| Disclosure | Collect? | Notes |
|------------|----------|-------|
| Personally identifiable information | Yes (account) | Cognito subject / email when signed in; device session id when anonymous |
| Health information | No | |
| Financial and payment information | No | Price *track fields* are product prices the user saves, not payment instruments |
| Authentication information | Yes | Short-lived access tokens in extension storage for API calls |
| Personal communications | Conditional | Support *drafts* are generated text the user may paste; we do not read Gmail/inbox APIs |
| Location | No | |
| Web history | No | Only the active page when user acts—not browsing history |
| User activity | Yes | Feature usage metrics (route, latency, error code)—not page bodies |
| Website content | Yes | Extracted page text / fields when user summarizes, asks, drafts, or saves |

## Certifications (Limited Use)

Affirm that you:

- Use data only to provide/improve the single purpose
- Do not sell or use data for personalized ads
- Do not allow humans to read user data except policy exceptions
- Transfer only as needed for the product (e.g. Bedrock inference, CockroachDB storage)

The privacy policy page includes the required affirmative Limited Use statement.

## Manifest alignment checklist

Before upload, verify dashboard permissions list matches:

- `storage`, `activeTab`, `scripting`, `sidePanel`
- Optional hosts only: `http://*/*`, `https://*/*`
- No required `<all_urls>` / host permissions at install
