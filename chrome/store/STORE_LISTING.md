# Chrome Web Store listing copy — v0.6.0

Rewritten from the v0.1.4 copy, which described the `activeTab`-only model
("open WalkCroach from the toolbar; it only reads the page you act on"). That is
no longer how access works, and shipping it would misdescribe the product to
reviewers and users alike.

Read `SUBMISSION_CHECKLIST.md` §1 before adding anything: connectors are in the
package but inert until an OAuth app is registered, and must not appear here yet.

## Store name

**WalkCroach**

## Short description (≤132 characters)

Summarize pages, draft replies, and remember what you save — a trust-first browser copilot for small businesses.

*(110 characters.)*

## Detailed description

WalkCroach works from the page you are already on — a job board, a supplier quote,
a product listing, a support inbox — and helps you act on it without building
automations or learning a new tool.

**What it does**

- Summarize the page you are on, and ask follow-up questions about it
- Draft a short reply you can insert or copy
- Save a page, or just the part you highlighted, into a workspace you control
- Recall what you saved later, in plain language, with the sources shown
- Track a price and see how it has moved since you started watching
- Sector shortcuts on matched sites — candidate and lead summaries, listings

**How page access works**

WalkCroach asks for permission one site at a time, the first time you use it
there. There is no site-wide access at install, and nothing is read until you
click an action. Every site you have allowed is listed under **Account**, and you
can withdraw any of them in one click — which also clears anything WalkCroach had
cached for that site.

**What it does not do**

- It does not read pages in the background, or on sites you have not allowed
- It does not browse, click, or submit forms on your behalf
- It does not save anything without showing you first — every save is a
  confirmation, not a side effect

**Your account is optional**

WalkCroach works straight away on this device. Signing in is only needed to share
what you save with WalkCroach on the web, and anything you saved beforehand moves
across with you.

**Privacy**

https://walkcroach.conquerorfoundation.com/chrome-privacy.html
Allowed sites, your session, and the privacy policy are all under **Account** in
the side panel.

**Homepage / support**

https://walkcroach.conquerorfoundation.com

## Category

Productivity

## Language

English

## Single-purpose wording for reviewers

"A side-panel copilot for small-business operators: summarize, ask about, draft
from, and save the page you are on, then recall it later. Not an automation
builder, not a scraper, and not a general browsing agent."

## Store icon (required)

`icon-128.png` — exactly 128×128 PNG (RGBA). Source: `docs/walkcroach-icon.png`.
Toolbar icons (16/32/48/128) live in `chrome/public/` and ship with
`npm run zip:prod`.

## Screenshots

Five 1280×800 captures in `store/screenshots/`, generated from the **real built
extension** by `npm run screenshots` — not from a mock, so they cannot drift from
the shipped UI.

| # | File | Shows |
|---|------|-------|
| 1 | `01-page.png` | Page surface: brand, context, one primary action |
| 2 | `02-grant.png` | Per-site access request, naming a single site |
| 3 | `03-confirm.png` | Confirm card — exactly what will be saved |
| 4 | `04-recall.png` | Recall answer with its cited sources |
| 5 | `05-account.png` | Account: allowed sites, revoke, connections |

## Promotional images

Optional: small tile 440×280, marquee 1400×560 for featured placement.

## Listing video (not produced)

The plan asks for a 30s walkthrough: grant → summarize → confirm save → recall.
Screen recording with narration is not something this repo can generate; it needs
a person and a screen recorder. The five screenshots above cover the same beats in
the same order if you record it.

## Copy rules for future edits

- Do not claim connectors, remote profiles, or presigned screenshot upload until
  `SUBMISSION_CHECKLIST.md` §1 says they are reachable.
- Do not describe access as "opens from the toolbar" — it is per-site permission.
- Keep "Trust tab" out of the copy; the surface is called **Account**.
