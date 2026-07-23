# Post-submit monitoring (PD.7)

Trust proxy: watch summarize/save success and error rates after listing (v0.1.3+ has no host grant/revoke).

## CloudWatch (backend)

Log group: `walkcroach/chrome/{env}` (or the Lambda log group for `walkcroach-{env}-chrome`).

| Metric / log event | Meaning |
|--------------------|---------|
| `chrome.permission.grant` | Origin granted (telemetry) |
| `chrome.permission.revoke` | Origin revoked (telemetry) |
| `chrome.summarize.ttfb_ms` | Summarize time-to-first-byte |
| `chrome.ask.ttfb_ms` | Ask TTFB |
| `chrome.recall.latency_ms` | Recall latency |
| `chrome.capture.save` | Explicit save |
| `chrome.stream.error` / route errors | Failures without page body |

**Never** alert on or log `extractedText` / draft bodies.

## Extension crashes

Chrome Web Store / Chrome Enterprise may surface crash rates. Locally: check `chrome://crashes` during QA. Investigate any spike after a version bump.

## Trust proxy (product)

From PRD (updated for activeTab-only): healthy early signal is ≥2 distinct capture saves / summarize actions in the first 7 days after install (not origin grants—host grants are no longer used).

## Suggested alarms (staging → prod)

- Error rate on chrome Lambda > baseline for 15m
- Summarize p50 TTFB > 2.5s sustained (smoke threshold from plan §10)
- Sudden drop in `chrome.capture.save` after update (possible UX / extract regression)
