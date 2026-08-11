# Runtime secrets & Parameter Store

Manual ops reference for WalkCroach Web / Chrome / agent Lambda.

**Split (by design):**

| Store | What goes here |
|---|---|
| **Secrets Manager** `walkcroach/{env}/runtime` | Credentials, API keys, OAuth client secrets, Stripe secret/webhook/price ID |
| **SSM Parameter Store** + **Terraform `tfvars` / Lambda env** | Non-secret URLs, model IDs, credit grants, Cognito IDs (already published by TF) |

Terraform **looks up** the runtime secret; it does **not** create or overwrite its JSON values (`infra-backend/modules/secrets/main.tf`).

Secret name: `walkcroach/{environment}/runtime`  
(e.g. `walkcroach/dev/runtime`, `walkcroach/prod/runtime`)

Loader: `infra-backend/modules/lambda-agent/codes/src/secrets.ts`  
(`process.env` already set wins over secret values.)

---

## 1. Secrets Manager — add these JSON keys

Paste into the existing runtime secret JSON. Snake_case keys only.

### Core (required)

| JSON key | Maps to env | Notes |
|---|---|---|
| `crdb_connection_string` | `CRDB_CONNECTION_STRING` | **Required.** CockroachDB connection URI |
| `e2b_api_key` | `E2B_API_KEY` | App Builder cloud sandbox; omit only if intentional WC-only |
| `chrome_device_signing_key` | `CHROME_DEVICE_SIGNING_KEY` | Chrome device sessions; without it Chrome returns 503 |

### Usually present

| JSON key | Maps to env | Notes |
|---|---|---|
| `walkcroach_api_key` | `WALKCROACH_API_KEY` | Service / internal API key if used |
| `searxng_url` | `SEARXNG_URL` | Optional; enables `web_search` |
| `crdb_mcp_api_key` | `CRDB_MCP_API_KEY` | CockroachDB Managed MCP (Phase F1) |
| `crdb_mcp_cluster_id` | `CRDB_MCP_CLUSTER_ID` | Optional; sent as `mcp-cluster-id` header |
| `aws_bearer_token_bedrock` | `AWS_BEARER_TOKEN_BEDROCK` | **Local/dev only** — Lambda strips this and uses IAM |

### Phase F — connector OAuth apps (SME accounts)

Providers only appear in Settings → Connections when **both** client id and secret are set.

| JSON key | Maps to env | Provider |
|---|---|---|
| `google_oauth_client_id` | `GOOGLE_OAUTH_CLIENT_ID` | Calendar, Gmail, Sheets, **Drive** (shared Google app) |
| `google_oauth_client_secret` | `GOOGLE_OAUTH_CLIENT_SECRET` | |
| `google_api_key` | `GOOGLE_API_KEY` | Browser-restricted Google Picker key (Drive attach). Enable Drive API + Picker API on the Cloud project. |
| `slack_oauth_client_id` | `SLACK_OAUTH_CLIENT_ID` | Slack |
| `slack_oauth_client_secret` | `SLACK_OAUTH_CLIENT_SECRET` | |
| `stripe_oauth_client_id` | `STRIPE_OAUTH_CLIENT_ID` | **Connect** OAuth (user’s Stripe account for balance/payments tools) |
| `stripe_oauth_client_secret` | `STRIPE_OAUTH_CLIENT_SECRET` | Not WalkCroach Billing |
| `hubspot_oauth_client_id` | `HUBSPOT_OAUTH_CLIENT_ID` | HubSpot CRM — **not connectable yet.** HubSpot sunset legacy public apps in mid-2026; credentials now require their Projects framework (`hs project create` + deploy). Marked `comingSoon` in `providers.ts`, so setting these keys alone will NOT enable it — remove that flag too. |
| `hubspot_oauth_client_secret` | `HUBSPOT_OAUTH_CLIENT_SECRET` | |

**OAuth redirect URI** (register in each provider console):

```text
{WEB_APP_URL}/app/settings/connections/callback
```

Example: `https://app.walkcroach.com/app/settings/connections/callback`

Per-user access tokens are **not** in this JSON — they are written at connect time under  
`walkcroach/{env}/connectors/*` (Secrets Manager namespace; Lambda IAM already scoped).

### Phase G — WalkCroach subscription billing (Free / Starter / Pro)

Different from connector Stripe OAuth above.

| JSON key | Maps to env | Notes |
|---|---|---|
| `stripe_secret_key` | `STRIPE_SECRET_KEY` | Platform secret key (`sk_live_…` / `sk_test_…`) |
| `stripe_webhook_secret` | `STRIPE_WEBHOOK_SECRET` | Signing secret `whsec_…` for Checkout/subscription events |
| `stripe_price_id_starter` | `STRIPE_PRICE_ID_STARTER` | Stripe Price ID for Starter (`price_…`), ~$12/mo |
| `stripe_price_id_pro` | `STRIPE_PRICE_ID_PRO` | Stripe Price ID for Pro (`price_…`), ~$20/mo |
| `stripe_price_id_paid` | `STRIPE_PRICE_ID_PAID` | **Legacy alias for Pro** — used if `stripe_price_id_pro` is unset |

**Stripe Dashboard webhook** endpoint:

```text
{API_BASE}/webhooks/stripe
```

Subscribe at least to: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `customer.deleted`.

| Event | Effect |
|---|---|
| `checkout.session.completed` | Apply Starter/Pro from session metadata / price |
| `customer.subscription.created` / `updated` | Sync plan from price (or free if not active/trialing) |
| `customer.subscription.deleted` | Downgrade to free |
| `invoice.payment_failed` | Dunning — revoke paid entitlements (restore on next successful `subscription.updated`) |
| `customer.deleted` | Clear `stripe_customer_id`, plan free |

Checkout success/cancel URLs use `WEB_APP_URL` (Lambda env / TF var), not the secret JSON:

- Success: `{WEB_APP_URL}/app/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`
- Cancel: `{WEB_APP_URL}/app/settings?billing=cancel`

On success, the SPA calls `POST /billing/confirm` with the session id so the plan updates immediately (webhook remains the async source of truth).

### Example fragment (merge into existing JSON)

```json
{
  "crdb_connection_string": "postgresql://…",
  "e2b_api_key": "e2b_…",
  "chrome_device_signing_key": "…",
  "crdb_mcp_api_key": "…",
  "crdb_mcp_cluster_id": "…",
  "google_oauth_client_id": "….apps.googleusercontent.com",
  "google_oauth_client_secret": "…",
  "slack_oauth_client_id": "…",
  "slack_oauth_client_secret": "…",
  "stripe_oauth_client_id": "ca_…",
  "stripe_oauth_client_secret": "…",
  "hubspot_oauth_client_id": "…",
  "hubspot_oauth_client_secret": "…",
  "stripe_secret_key": "sk_live_…",
  "stripe_webhook_secret": "whsec_…",
  "stripe_price_id_starter": "price_…",
  "stripe_price_id_pro": "price_…"
}
```

After editing the secret, **redeploy is not required** for key changes that are only read via `ensureRuntimeSecrets` on cold start — force a new Lambda invocation (or bounce the function) so warm containers reload.

---

## 2. Parameter Store / Terraform — non-secret config

### Already published by `modules/ssm` (web SPA build)

Prefix: `/{name_prefix}/{environment}/web/…`  
(default name_prefix `walkcroach`)

| Parameter | Source |
|---|---|
| `/walkcroach/{env}/web/api_url` | TF `api_url` |
| `/walkcroach/{env}/web/cognito_user_pool_id` | Cognito module |
| `/walkcroach/{env}/web/cognito_client_id` | Cognito module |
| `/walkcroach/{env}/web/cognito_region` | Cognito region |
| `/walkcroach/{env}/web/web_url` | TF `web_app_url` (when set) |

### GitHub App (manual SSM; optional)

Prefix: `/walkcroach/{env}/github/*` (or `github_ssm_prefix` override)  
Used for Builder → Ship GitHub connect — not Web Modules Phase F/G.

### Lambda agent env (set via Terraform / `tfvars`, not Secrets Manager)

These are wired in `modules/lambda-agent/main.tf`. Prefer **tfvars** over hand-editing Lambda console.

| Env var | Typical source | Notes |
|---|---|---|
| `WEB_APP_URL` | `var.web_app_url` | **Required for OAuth redirects + Stripe Checkout return URLs** |
| `CRDB_MCP_URL` | `var.crdb_mcp_url` | Default `https://cockroachlabs.cloud/mcp` |
| `FREE_MONTHLY_CREDITS` | `var.free_monthly_credits` | Default `100` |
| `STARTER_MONTHLY_CREDITS` | `var.starter_monthly_credits` | Default `250` |
| `PRO_MONTHLY_CREDITS` | `var.pro_monthly_credits` | Default `500` |
| `PAID_MONTHLY_CREDITS` | `var.pro_monthly_credits` | Legacy alias of Pro grant (margin-calibrated) |
| `CONNECTOR_SECRET_PREFIX` | TF literal | `walkcroach/{env}/connectors` |
| `RUNTIME_SECRET_ARN` | secrets module | Points at runtime JSON |
| `CORS_ALLOW_ORIGIN` | usually `web_app_url` | SPA origin |
| `BEDROCK_REGION`, `NOVA_*`, guardrail IDs, buckets, Cognito IDs | TF | Infra-managed |

**tfvars you should set for Phases F/G:**

```hcl
web_app_url = "https://your-spa-origin.example"
# optional overrides:
# free_monthly_credits    = 100
# starter_monthly_credits = 250
# pro_monthly_credits     = 500
```

If `web_app_url` is empty, OAuth callback falls back to `CORS_ALLOW_ORIGIN` / localhost — fine for local, wrong for prod.

---

## 3. Checklist — new keys for Phases F + G

Add to Secrets Manager JSON when enabling each feature:

- [ ] Connectors (Google): `google_oauth_client_id`, `google_oauth_client_secret`
- [ ] Connectors (Slack): `slack_oauth_client_id`, `slack_oauth_client_secret`
- [ ] Connectors (Stripe Connect): `stripe_oauth_client_id`, `stripe_oauth_client_secret`
- [ ] Connectors (HubSpot): `hubspot_oauth_client_id`, `hubspot_oauth_client_secret`
- [ ] Cockroach MCP: `crdb_mcp_api_key` (+ optional `crdb_mcp_cluster_id`)
- [ ] Billing Checkout/Portal: `stripe_secret_key`, `stripe_webhook_secret`, `stripe_price_id_starter`, `stripe_price_id_pro`

Set in TF / Parameter Store path:

- [ ] `web_app_url` (SPA origin) so Connections + Checkout redirects work
- [ ] Stripe webhook URL pointing at API `/webhooks/stripe` (must be Cognito-free)
- [ ] OAuth redirect URIs in Google / Slack / Stripe Connect / HubSpot consoles
- [ ] Create two Stripe Prices (~$12 Starter, ~$20 Pro) and paste IDs into Secrets Manager

---

## Related

- Loader: `infra-backend/modules/lambda-agent/codes/src/secrets.ts`
- Catalog: `infra-backend/packages/ledger/src/plans.ts`
- Checkout/webhooks: `infra-backend/modules/lambda-agent/codes/src/handlers/stripeBilling.ts`
- Secret lookup (no values): `infra-backend/modules/secrets/main.tf`
- Web SSM: `infra-backend/modules/ssm/main.tf`
- Status: `docs/walkcroach-master-doc.md`; connector/billing keys documented above
