# Chrome Web Store — privacy practices form (PD.2)

Align every checkbox with the shipping manifest and the live privacy policy.

**Privacy policy URL (paste exactly into the CWS dashboard Privacy practices tab):**  
https://walkcroach.rinegansolutions.com/chrome-privacy.html

Source file (must be redeployed with Web before submit):  
`web/public/chrome-privacy.html`

Google crawls **the dashboard field**, not the URL baked into the zip. Before
`publish`, confirm the live page returns 200:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://walkcroach.rinegansolutions.com/chrome-privacy.html
```

If publish fails with `400 Publish condition not met: Privacy policy link is not
reachable`, the zip is fine — fix the dashboard URL (or the live page), then
re-run `.github/workflows/publish-chrome.yml` with **`publish_only: true`**.
Do not re-tag; CWS rejects a second upload of the same version.

Reference: [CWS Privacy practices](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## Single purpose

See `PERMISSION_JUSTIFICATIONS.md`.

## Remote code

Select: **No, I am not using remote code.**

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

The live privacy policy includes the required affirmative Limited Use statement.

## Manifest alignment checklist

Before upload, verify the dashboard permissions list matches the built manifest:

- `storage`, `activeTab`, `scripting`, `sidePanel`, `identity`, `contextMenus` —
  all six, each justified in `PERMISSION_JUSTIFICATIONS.md`
- **One** install-time host in production: `https://api.walkcroach.rinegansolutions.com/*`
  (Chrome BFF + public memory `/v1` share that origin; local builds may add
  `localhost:3003` for the IDE API)
  (legacy execute-api host may appear in older builds during cutover)
  (or the baked `WALKCROACH_API_BASE` / `WALKCROACH_IDE_API_BASE` origins)
- **Optional** host permissions: the broad http/https wildcards are expected and
  correct — see below
- **No** `<all_urls>` anywhere, no `tabs`, no `content_scripts`

> **Correction (2026-08-01).** This section previously listed only four
> permissions — omitting `identity` and `contextMenus`, both of which the
> extension has requested since 0.2.0 — and told you to verify there were *no*
> broad page hosts at all. That second instruction conflated two different
> manifest fields, and filling the dashboard form from it would have
> under-declared what the extension actually asks for:
>
> | Field | Granted | Broad value means |
> |---|---|---|
> | `host_permissions` | at **install** | "read and change all your data on all websites", held whether used or not. Must stay narrow — API host only. |
> | `optional_host_permissions` | at **use**, per origin, revocable | "may *ask* about any site". Broad here is the documented side-panel pattern, and is what avoids the install-time warning. |
>
> The same confusion was baked into `scripts/zip-prod.mjs`, where it made a
> store build impossible — fixed the same day. `tests/manifest.test.ts` asserts
> the six-permission list, so this document and the shipped zip cannot drift
> apart silently again.
