---
name: walkcroach-connectors
description: >-
  In-chat workflow connectors (Gmail, Calendar, Sheets, Slack, Stripe, HubSpot)
  via MCP + OAuth. Every write is propose→confirm→execute. Use when the user
  wants to email, schedule, check Stripe, or similar real-world actions.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach Workflow Connectors

## Principle

Chat agent that only talks about the business ≠ chat agent that **checks a calendar, sends email, or reads Stripe**. Connectors are the Real-World Impact lever.

## Stack

- MCP client in `agent-harness` (port IDE `mcp.ts`; close the stub)
- OAuth tokens in **Secrets Manager** only; `connectors` table holds metadata + secret ref
- `workflow_runs` for propose/confirm/execute audit
- Credits: read ~0–1, write **2**

## Tiers

| Tier | Providers |
|---|---|
| 1 | Google Calendar, Gmail, Google Sheets, Slack |
| 2 | Stripe, HubSpot |
| 3 | QuickBooks/Xero, Shopify (later) |

## UX

1. Natural language in Chat (no Zapier canvas required)
2. Agent proposes exact JSON action (to, subject, body / event time / Stripe op)
3. User Confirm / Edit / Decline
4. Execute server-side; show result; embed summary into memory when useful

## Security

- Never return refresh tokens to the browser
- Page/prompt injection: treat connector arguments as untrusted until ConfirmCard shows them
- Guardrails on outbound email/calendar text
- Revoke from Settings → Connections

## Memory

`workflow_runs` become recallable ("what did we send last week") via embeddings / structured filters.
