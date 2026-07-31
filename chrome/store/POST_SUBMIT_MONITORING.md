# Post-submit monitoring (PD.7)

**Scope note (v0.2.0):** rewritten for the Phase A/B permission and auth model. Earlier
revisions listed `chrome.permission.grant` / `chrome.permission.revoke` as backend metrics;
those were never emitted by any handler. Site grants live in Chrome's own permission store,
client-side — see "What we deliberately cannot measure".

## What changed and why it matters here

| Before (v0.1.5) | Now (v0.2.0) |
|---|---|
| `activeTab`-only; no host grants at all | Per-origin optional host permissions, granted in-panel |
| Sign-in redirected to a non-web-accessible `auth.html` (silently blocked by Chrome) | `chrome.identity.launchWebAuthFlow` + `chromiumapp.org`, tab flow as fallback |
| A summarize failure was indistinguishable from a permission failure | Page-access state is explicit, and resolved client-side |

Headline consequence: **a drop in summarize volume can now mean "users declined the site
prompt"**, which is a product signal rather than an outage. Read the two together.

## CloudWatch (backend)

Log group: `walkcroach/chrome/{env}` (or the Lambda log group for `walkcroach-{env}-chrome`).

| Metric / log event | Meaning |
|--------------------|---------|
| `chrome.summarize.ttfb_ms` | Summarize time-to-first-byte |
| `chrome.ask.ttfb_ms` | Ask TTFB |
| `chrome.recall.latency_ms` | Recall latency |
| `chrome.capture.save` | Explicit save |
| `chrome.oauth.session_code` (`ok`) | Web issued a one-time connect code — sign-in **started** |
| `chrome.oauth.token` (`ok`) | Extension redeemed the code — sign-in **completed** |
| `chrome.oauth.refresh` (`ok`) | Cognito refresh proxy result |
| `chrome.stream.error` / route errors | Failures without page body |
| `chrome.propose.ok` / `.empty` / `.parse_failed` | Structured extraction outcome (D1) |
| `chrome.capture.price_append` (`changed`) | Price re-check; `changed:false` means the price held |
| `chrome.screenshot.presign` (`mode`) | `put` = direct-to-S3, `direct` = falling back through Lambda |
| `chrome.screenshot.upload` / `.commit` | Screenshot stored |
| `chrome.screenshot.key_mismatch` | **Should never fire.** A stored key outside the owner's namespace |
| `chrome.connector.propose` / `.execute` / `.decline` | Connector lifecycle (E) |
| `chrome.connector.unknown_action` | Model or client proposed an action outside the catalogue |
| `chrome.profiles.served` / `.unconfigured` | Signed site-profile bundle |

**Never** alert on or log `extractedText` / draft bodies.

### Sign-in success rate — the Bug B regression guard

```
sign_in_success = count(chrome.oauth.token       ok=true)
                / count(chrome.oauth.session_code ok=true)
```

This ratio detects exactly the failure that shipped in v0.1.5: Web issued codes
(`session_code` fired) that the extension could never redeem (`token` never fired), because
Chrome blocked the redirect into a non-web-accessible `auth.html`. Nothing errored server-side,
so nothing alarmed.

**A sustained ratio well below 1 means the redirect path is broken again.** Check
`redirectUri is not allowed` 400s on `/chrome/v1/oauth/token` first, then the shipped extension
ID against `CHROME_REDIRECT_PATTERN`.

Alarm: ratio < 0.7 over 1h with ≥10 starts.

### Redirect allowlist rejections

400 `redirectUri is not allowed` on `/chrome/v1/oauth/session-code` or `/oauth/token` should be
~zero in steady state. A spike after a release means the extension ID drifted (see
`VERSIONING.md` → Extension ID) or a build shipped without `identity` while the allowlists moved
on.

## What we deliberately cannot measure

Site grants and revocations happen entirely inside Chrome's permission UI. WalkCroach does
**not** report them to the backend: an event saying "user granted example.com" is browsing data
we have promised in the store listing not to collect.

Use the **grant proxy** instead — a granted site is a precondition for `chrome.summarize.*` and
`chrome.capture.save` on that site, so distinct-owner summarize volume is the closest honest
measure of grant health. Do not add grant telemetry without changing the privacy disclosure
first.

## Extension crashes

Chrome Web Store / Chrome Enterprise may surface crash rates. Locally: check `chrome://crashes`
during QA. Investigate any spike after a version bump.

## Trust proxy (product)

Healthy early signal is ≥2 distinct capture saves / summarize actions in the first 7 days after
install. If installs look healthy but summarize volume is near zero, suspect the site-grant
step: users are seeing the prompt and declining, or the panel is stuck in the `unknown`
page-access state. Both are panel UX problems, not backend faults.

## Phase D–F additions

### Extraction quality

`chrome.propose.parse_failed` and `chrome.propose.empty` separate two different
problems that used to look identical. `parse_failed` is a model or prompt
regression; `empty` means the user ran a sector action on the wrong kind of page,
which is a profile-matching question, not a model one. A rise in `empty` on one
host usually means a site profile needs its `pathIncludes` tightened.

### Screenshot upload path

`chrome.screenshot.presign` reports `mode`. Steady state after the store ID is
added to bucket CORS should be overwhelmingly `put`. Sustained `direct` means CORS
is wrong or the extension ID changed, and every screenshot is being pushed through
Lambda — it still works, but it costs invocation time and API Gateway payload.

### Connectors

```
connector_success = count(chrome.connector.execute ok=true)
                  / count(chrome.connector.execute)
```

Watch alongside the Web equivalent: a gap between the two surfaces for the same
account means a Chrome-specific regression, since both call the identical shared
`executeRun`. `chrome.connector.unknown_action` should be flat at zero — a
non-zero rate means something is proposing actions the catalogue does not define,
which is either a prompt regression or an attempt at one.

### Security signals that should never fire

| Metric | Meaning if it appears |
|---|---|
| `chrome.screenshot.key_mismatch` | A capture row referenced an object outside its owner's namespace. Investigate immediately — corrupt data or tampering. |
| `chrome.connector.unknown_action` | Deny-by-default caught a proposal outside the catalogue. |
| `redirectUri is not allowed` 400s | Extension ID drift, or a forged redirect. |

## Suggested alarms (staging → prod)

- Error rate on chrome Lambda > baseline for 15m
- Summarize p50 TTFB > 2.5s sustained (smoke threshold from plan §10)
- **Sign-in success ratio < 0.7 over 1h** (≥10 starts) — Bug B regression
- **Any `redirectUri is not allowed` 400s** after a release
- Sudden drop in `chrome.capture.save` after update (possible UX / extract / permission regression)
- **Any** `chrome.screenshot.key_mismatch` — page a human
- **Any** `chrome.connector.unknown_action` sustained over an hour
- Connector execute success ratio < 0.8 over 1h with ≥10 attempts
- `chrome.screenshot.presign mode=direct` > 20% once bucket CORS is deployed
