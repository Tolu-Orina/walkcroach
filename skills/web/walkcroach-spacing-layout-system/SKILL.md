---
name: walkcroach-spacing-layout-system
description: Enforces a strict 4/8px spacing scale and proximity-based layout rhythm for all UI builds. Use this skill whenever building, reviewing, or fixing any web/app interface, dashboard, landing page, or component — especially when spacing, padding, margins, or "cramped/off/inconsistent" layout is mentioned, or before shipping any generated UI. This is a foundational skill that should be consulted on nearly every UI task, since ambiguous spacing is the single most common cause of AI-generated interfaces looking unpolished.
---

> WalkCroach Web skill — companion to `walkcroach-frontend-design`. Prefer Graphite Lumen tokens when the surface is WalkCroach-branded; customer brand tokens win for customer creatives.
# Spacing & Layout System

Ambiguous spacing is the #1 reason AI-built UIs look "off." The fix is mechanical, not aesthetic: pick one scale, snap everything to it, and use spacing itself to communicate grouping.

## The scale (non-negotiable)

Use only these values for padding, margin, and gap: **4, 8, 12, 16, 24, 32, 48, 64, 96px**. Never output 13px, 18px, 37px, or any value outside this set. If a design tool or framework default doesn't match, override it — do not let a library's default padding slip through unchecked.

- 4px = micro-adjustment inside tight components (icon-to-text gap, badge padding)
- 8/12px = internal component padding (button, input, chip)
- 16/24px = space between related components inside a card/section
- 32/48px = space between distinct sections
- 64/96px = space between major page regions (hero, footer, top-level page sections)

## The proximity rule

**Space around a group must be clearly larger than space within it.** This is the single rule that makes a label bind visually to its field, and a card separate visually from the one next to it. If internal and external spacing are close in value, the eye can't tell what belongs together — this reads as "generic AI layout" even when every individual value is on-scale.

Concretely: if a form label sits 8px from its input, the gap between that field and the next field must be at least 16–24px. If cards have 16px internal padding, the gap between cards should be 24–32px, never 16px or less.

## Section rhythm — vary it on purpose

Do not give every section the same padding. A hero section, a content section, and a CTA section should NOT all use identical vertical spacing — that flatness is a giveaway. Let the hero breathe more (64–96px), content sections use a consistent mid-value (48–64px), and let intentional variation signal hierarchy between sections.

## One primary alignment per section

Mixing left, center, and right alignment within the same section/card reads as chaos. Pick one alignment per section and hold it. Left-align text-heavy content and forms (most readable for LTR). Reserve center alignment for short, isolated content (hero headline + one CTA). Related elements — a label and its input, an icon and its caption — must share the same edge alignment.

## Build-time enforcement checklist

Before calling any UI "done," check:
- [ ] Every margin/padding/gap value is from the scale above — grep for arbitrary pixel values in code (`padding: 13px`, `gap: 22px`, etc.) and fix them
- [ ] Groups that belong together have visibly less internal space than the space separating them from other groups
- [ ] No section uses identical top/bottom padding to the section directly above or below it, unless intentionally forming a visual pair
- [ ] Only one text/content alignment is used within any given section
- [ ] Run the "squint test": shrink the rendered page to thumbnail size — if every section reads as the same undifferentiated box, spacing rhythm has failed

## Common failure mode to catch

A model given a "card" component will often set 18px or 20px padding by default, drawn from common tutorial code. Always audit generated components against the scale above rather than trusting the first output — this is where most spacing drift enters a build.
