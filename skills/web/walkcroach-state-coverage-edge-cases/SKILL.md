---
name: walkcroach-state-coverage-edge-cases
description: Ensures every UI screen or component covers its full set of states — loading, empty, error, partial, and success — not just the happy path with sample data. Use this skill whenever building any screen that loads data, submits a form, or depends on an external action, and whenever reviewing a build for production-readiness. AI-generated UI reliably nails the happy path and skips everything around it; this skill exists specifically to catch that gap before it reaches users.
---

> WalkCroach Web skill — companion to `walkcroach-frontend-design`. Prefer Graphite Lumen tokens when the surface is WalkCroach-branded; customer brand tokens win for customer creatives.
# State Coverage & Edge Cases

AI-generated interfaces are consistently strong on the happy path and weak everywhere else. What's skipped is invisible in a single screenshot and is exactly where user trust is won or lost: the empty state before there's data, the loading state, the error when a request fails, and the moment input is invalid.

## The required state set for anything that loads or submits data

For every screen or component backed by an API call, async data, or user submission, design and build all of these — not just the "data loaded successfully" state:

1. **Loading** — a skeleton screen or spinner that matches the eventual layout's shape (skeleton loaders read as more polished than generic spinners for content-heavy screens). Never leave a blank white screen during load.
2. **Empty** — what does the user see the very first time, before any data exists? This state must tell them what to do next (e.g., "No projects yet — create your first one" with a clear CTA), not just show a blank table or "0 results."
3. **Partial/low data** — how does the layout hold up with 1 item instead of 20? Cards, tables, and grids designed only against dense sample data often break or look sparse and unfinished with realistic small datasets.
4. **Error** — what happens when the request fails (network drop, server error, permission denied)? Show a clear message and, where possible, a retry action — never fail silently or show a raw error/stack trace to the user.
5. **Validation/invalid input** — inline, specific feedback at the field level (not just a generic banner) when a form input is wrong, including what would fix it.
6. **Success/confirmation** — explicit feedback that an action completed (toast, inline confirmation, updated UI state) — don't leave the user guessing whether their submit actually worked.

## Design with realistic content, not lorem ipsum

Content shapes layout. A transaction value of "$4.99" occupies different space than "$12,847.32"; a name of "Jo" behaves differently than "Alexandra Konstantinidis." Build and test every state against realistic data — including the longest plausible values (longest name, largest number, longest error message) — rather than only placeholder text, since layouts that only work for short/tidy sample data break in production.

## Where this matters most

Prioritize full state coverage for: any list/table view, any form (especially multi-step), any screen depending on a third-party integration or network call, and any dashboard widget pulling live data. These are the surfaces most likely to be seen empty, loading, or errored by real users on day one.

## Pre-ship checklist
- [ ] Every data-dependent screen has a designed loading state, not a blank flash
- [ ] Every list/table has a designed empty state with a clear next action, not just "no data"
- [ ] Layouts were checked against both minimal (1 item) and maximal (long strings, large numbers) realistic content
- [ ] Every network/API-backed action has a visible, specific error state with no raw technical error shown to the user
- [ ] Every form has field-level validation messaging, not only a top-level banner
- [ ] Every successful submit/action gives explicit confirmation feedback
