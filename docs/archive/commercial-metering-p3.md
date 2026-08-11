# Commercial metering — P3 (SKU A)

**Status:** Accepted · 2026-08-11  
**Reversibility:** Two-way door until a separate Developer Stripe Product ships  
**Companion:** dual-funnel plan P3 · portal `/app/developer/ops`

## Decision

**SKU A — one shared monthly credit pool per account.**

| Debits the pool | Does **not** debit the pool |
|---|---|
| Web creatives / agent turns (ledger `CREDIT_COSTS`) | IDE / CLI / Desktop **BYOK** Bedrock inference |
| Chrome metered actions that call `debitCredits` | Local tool execution on coding hosts |
| Public SDK `/v1` memory / content / graph (`wc_live_` or Cognito) | |

There is **no** separate “developer plan” product or Stripe Price for API-only usage in this phase.

## Source of truth

1. **`@walkcroach/ledger`** — `credit_balances` + `usage_ledger` (atomic debit).  
2. **Stripe Billing Meter** `walkcroach_credits` — best-effort, async, idempotent on `usage_ledger.id`. Never blocks a debit.  
3. Do **not** introduce Metronome unless enterprise commits / prepaid credits / dimensional contracts are signed demand.

## Soft vs hard quota

| Layer | Behaviour | Where |
|---|---|---|
| **Soft** | UI warning when remaining &lt; 15% of monthly allotment | Overview, Ops, CreditPoolBar |
| **Hard** | `debitCredits` refuses → HTTP **429** `QUOTA_EXCEEDED` + `Retry-After` | `chargeOr429` / content / graphs |
| **Throttle** | Monthly credits *are* the primary throttle; no separate per-key RPS product control yet | Documented honesty |

Abuse controls today: scopes on keys, Cognito-only key mint, SDK browser apiKey refusal, hard credit ceiling. Per-key RPS limits remain a revisit trigger (see below).

## Invoice explainability (customer view)

Portal **Ops** must answer: “What am I paying for?”

1. **Subscription / plan allotment** — monthly credits on the plan (Free / Starter / Pro).  
2. **Pool burn this month** — `used` / `monthlyCredits` (shared).  
3. **API-attributed burn** — rows in `usage_ledger` with `metadata.keyId`, broken down by action (`memory_*`, `content_publish`, `graph_run`).  
4. **Stripe meter (if configured)** — each successful debit may emit `walkcroach_credits` with `value = credits` and `identifier = usage_ledger.id`. Invoice lines reflect that meter only when a metered Price is attached; otherwise the customer pays the flat plan that includes the allotment.

Interactive Cognito calls (no `keyId`) still debit the pool but are **not** listed under per-key usage — they appear in the overall pool bar.

## Explicit non-goals

- Metering BYOK Bedrock tokens through WalkCroach Stripe.  
- Parallel SoR besides the ledger.  
- Separate developer SKU (SKU B) without a product decision.

## Revisit triggers

Reopen SKU B (developer plan + overage) if:

- ≥3 paying customers ask for API-only billing separate from creatives, **or**
- API-key burn routinely starves Web creatives for the same owner.

Reopen per-key RPS limits if a single key causes availability or cost incidents despite the hard credit ceiling.

Reopen Metronome if Stripe Meter + prepaid credit contracts are insufficient for an enterprise deal.

## Fitness

- Every metered `/v1` write path calls `debitCredits` with `metadata.keyId` when auth is an API key.  
- `GET /v1/keys/usage` returns per-key **and** by-action aggregates for the current month.  
- Isolation test: exhausted credits → 429 + `Retry-After`.  
- SDK: `429` → `QuotaError` with `retryAfterMs`.
