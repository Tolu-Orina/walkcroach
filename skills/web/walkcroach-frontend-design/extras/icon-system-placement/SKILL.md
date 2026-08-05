---
name: icon-system-placement
description: Enforces a single, disciplined icon system — one library, fixed grid sizes, consistent alignment and spacing — for enterprise UI builds. Use this skill whenever adding, arranging, reviewing, or fixing icons in any interface, toolbar, nav, button, table, or card, especially when icons look "misaligned," "inconsistent," "random," or "off." Also use proactively any time a UI build includes icons at all, since icon problems are almost always spacing/placement problems rather than shape problems.
---

# Icon System & Placement

Icons fail almost entirely because of spacing and alignment, not because the shapes are bad. A single misaligned or oddly-spaced icon makes an otherwise polished screen look unfinished.

## One library, no exceptions

Choose exactly one icon library for the entire product (e.g. Lucide, Phosphor, Heroicons, or a custom set) and never mix styles. Mixing outline + filled + duotone icons, or icons from two different libraries, is one of the fastest ways to make a UI look assembled rather than designed. If a needed icon doesn't exist in the chosen library, either commission/build one in the same style or substitute a close match from the same set — never reach for a different library "just this once."

## Fixed grid sizes

Build and place icons only at standard grid sizes: **16px, 20px, 24px, or 32px**. Pick the smallest set of sizes that covers the product (most products need only 16px for dense UI like tables/inline text, and 24px for buttons/nav) — do not let arbitrary sizes like 18px or 22px creep in. Never scale an icon non-uniformly (different width/height ratio) to fit a space; resize the container instead.

## Alignment rules

- **Baseline alignment**: icons placed next to text must align to the text's optical center or baseline, not just to the bounding box — a technically-centered icon can still look visually low or high next to text; nudge by 1px if needed for optical balance.
- **Consistent icon-to-label gap**: use one fixed gap value (from the spacing scale — typically 8px) between an icon and its adjacent label, everywhere in the product. Do not let this vary button-to-button.
- **Center-justify icons, left-justify text**: in rows of buttons or list items, keep icons center-justified within their own slot while text stays left-justified — this is what makes a list of mixed icon+text rows feel orderly.
- **Equal-width interactive targets**: icon-only buttons (e.g. in a toolbar) should share one fixed square size (commonly 32x32 or 40x40px) regardless of the icon's natural proportions, so a row of icon buttons lines up perfectly.

## Semantic discipline

Maintain a short "do not reuse" list for icons prone to meaning-drift: bell, star, flag, eye, gear, heart, and arrows (which can mean direction, motion, expansion, or external link depending on context). Once an icon is assigned a meaning in the product (e.g., bell = notifications), never reuse it elsewhere for a different action.

## Accessibility requirement

Never convey information through an icon alone. Pair every meaningful icon with a text label, tooltip, or `aria-label` — an icon-only button with no accessible name fails both usability and WCAG. Icon-only UI is acceptable only when the icon is universally understood (e.g. a close "X") AND has a proper `aria-label`.

## Pre-ship checklist
- [ ] Every icon in the build comes from the same single library/style
- [ ] Every icon is placed at one of the approved grid sizes — no ad hoc scaling
- [ ] Icon-to-text gap is identical across every button, nav item, and list row
- [ ] Icon-only buttons share one fixed square hit-target size across the whole UI
- [ ] Every icon-only element has an accessible label
- [ ] No icon with high ambiguity risk (bell, star, flag, etc.) is reused for a second, different meaning elsewhere in the product
