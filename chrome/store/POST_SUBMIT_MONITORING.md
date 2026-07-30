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

## Suggested alarms (staging → prod)

- Error rate on chrome Lambda > baseline for 15m
- Summarize p50 TTFB > 2.5s sustained (smoke threshold from plan §10)
- **Sign-in success ratio < 0.7 over 1h** (≥10 starts) — Bug B regression
- **Any `redirectUri is not allowed` 400s** after a release
- Sudden drop in `chrome.capture.save` after update (possible UX / extract / permission regression)
