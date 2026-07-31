# WalkCroach Web — claims & privacy audit (Phase H3)

Keep marketing copy, Settings, UpgradeModal, and Chrome Web Store adjacent claims aligned with shipping behaviour.

**Privacy policy URL (Web):** `/privacy.html`  
Source: `web/public/privacy.html`  
**Chrome policy (separate):** `/chrome-privacy.html` · `chrome/store/PRIVACY_PRACTICES.md`

## Product claims that MUST remain true

| Claim | Evidence |
|---|---|
| Native Amazon Nova only for Web creatives (Lite / Pro / Canvas / Reel) | agent-harness Bedrock IDs; no third-party LLM vendors in creative path |
| Images ≤3 / owner / rolling 24h (paid) | `HARD_QUOTAS.image_gen_daily` + `consumeHardQuota` |
| Video ≤1 × ≤30s / owner / rolling 72h (paid) | `peekVideoQuota` / `video_jobs` status filter |
| Free: no Canvas / Reel / Pro creative orchestration | `getEntitlement` gates + UpgradeModal |
| Propose → confirm → execute for paid creatives & connector writes | ConfirmCard / connector execute REST |
| Connector tokens in Secrets Manager, not the browser | `walkcroach/{env}/connectors/*` |
| Shared Web/Chrome credit pool | `@walkcroach/ledger` + `/me/usage` `sharedPool` |
| Paid ~$20/mo via Stripe Checkout / Customer Portal | Phase G handlers |

## Claims that MUST NOT appear

| Forbidden claim | Why |
|---|---|
| Unlimited images/video | Hard caps are margin controls |
| “Canva” / Autofill for self-serve | Explicitly out of scope |
| Free tier includes video or Nova Canvas | Free is Lite chat/builder only |
| Credits alone remove hard caps | Caps apply even on paid |
| Auto-refund of all video credits on any failure | Mid-pipeline Reel/compose failures keep the debit (v1); **pipeline start** failures refund |
| Background scraping / always-on page upload (Chrome bleed) | Chrome policy only; Web must not inherit |

## UI surfaces to re-check before release

- [ ] `web/src/features/billing/UpgradeModal.tsx` — creatives + caps language
- [ ] `web/src/app/SettingsPage.tsx` — billing + connectors copy
- [ ] `web/src/features/chat/ImageQuotaPill.tsx` — 3/24h and 1/72h
- [ ] Chat ConfirmCard / VideoJobCard failure copy
- [ ] Chrome store listing does not claim Web-only creatives as extension features without gating

## Privacy copy checklist

- [ ] `privacy.html` deployed with SPA hosting
- [ ] Settings footer links to `/privacy.html`
- [ ] Stripe / OAuth provider consoles use the live Web origin for redirects
- [ ] No secret values in client bundles (NFR scan includes connector paths)

## Sign-off

| Role | Date | Notes |
|---|---|---|
| Eng | | Phase H3 doc landed |
| Product | | |
