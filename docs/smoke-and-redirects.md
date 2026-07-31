# WalkCroach Web — smoke + prod redirects (REV-30 / REV-31)

Manual weekend pass. Check each box on **local** then **prod**.

## Deploy prerequisites (blockers)

Before promoting backend + web:

1. Apply DB migrations through **025** (`npm run migrate -w @walkcroach/db` against prod CRDB). Required for modern Web: `010`–`019` (docs/sessions/RAG/skills), **`020`–`025`** (connectors, creatives, video jobs, workflow/vector). Legacy note: Builder E2B needs at least `014`.
2. Runtime secret `walkcroach/{env}/runtime` must include at least:
   - `crdb_connection_string`
   - `e2b_api_key` (Builder cloud sandbox; omit only if intentional WC-only)
   - `chrome_device_signing_key` (Chrome device sessions; otherwise Chrome returns 503)
   - Full key catalogue (connectors + Stripe Billing): [`runtime-secrets-and-ssm.md`](./runtime-secrets-and-ssm.md)
3. Confirm CloudFront still sends COOP/COEP (WebContainer fallback).
4. Smoke: Chat new thread, Project docs create, Builder prompt → preview, Deploy (optional).

## REV-30 — Six-surface smoke

| # | Path | Expect |
|---|------|--------|
| 1 | `/app` | Redirects to `/app/chat` |
| 2 | `/app/chat` | Composer + rail; can send a message |
| 3 | `/app/projects` | Project list; open one |
| 4 | `/app/projects/:id` | Home: instructions / docs / remembered |
| 5 | `/app/projects/:id/builder` | Preview boots; Terminal **closed**; Code/Terminal open from status bar |
| 6 | Deploy (optional) | Ship or header Deploy → status updates |
| 7 | `/app/apps` | Deployments list (or empty state) + products |
| 8 | `/app/code` | Artefacts list (or empty); open detail if any |
| 9 | `/app/settings` | Account, appearance, usage, connections |
| 10 | Rail avatar | Opens `/app/settings` |

**Builder Metaphor A:** first visit does not require opening Terminal to see preview after prompt/boot.

**Builder runtime:** Prefer **E2B** when the API has `E2B_API_KEY` (status bar
shows “E2B cloud”). Otherwise the client uses **local WebContainer** preview
(“Local preview”) — same agent tool protocol; COOP/COEP still required for WC.

## REV-31 — Redirect verification (prod)

| URL | Expect |
|-----|--------|
| `/` | Marketing landing |
| `/app` | → `/app/chat` |
| `/dashboard` | → `/app/projects` |
| `/project/:id` | → `/app/projects/:id` |
| `/app/projects/:id/builder` | Builder (auth) |
| `/signin` / `/signup` | Auth cards |
| `/connect/ide` | IDE connect flow |
| `/connect/chrome` | Chrome extension connect flow |
| `/app/chat?handoff=&q=` | Chrome → Web Chat context handoff |

After CodePipeline / infra deploy:

1. Hit each redirect on the CloudFront (or custom) domain.
2. Confirm COOP/COEP still set (required for WebContainer fallback; harmless for E2B).
3. Confirm API `GET /health` on the API domain.
4. With `E2B_API_KEY`: Builder status shows E2B; without it: Local preview boots.

## Cut this weekend
- PF-23 export/delete account
- PF-24 social auth
- Stripe Customer Portal (usage + “billing soon” only)
- AP-13 share-link

## Related
- Demo narration: [`demo-script-web-6-surfaces.md`](./demo-script-web-6-surfaces.md)
- Plan: [`walkcroach-web-revamp.md`](./walkcroach-web-revamp.md) §6 Phase F
