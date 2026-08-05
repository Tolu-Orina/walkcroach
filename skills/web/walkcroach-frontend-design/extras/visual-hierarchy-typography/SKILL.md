---
name: visual-hierarchy-typography
description: Establishes clear visual hierarchy and a disciplined typographic scale so interfaces guide the eye instead of making everything compete for attention. Use this skill whenever a UI "feels flat," "has no flow," has everything the same visual weight, or whenever setting up typography/heading structure for a new build or page.
---

# Visual Hierarchy & Typography

When everything on a screen is styled with equal weight, nothing stands out and users don't know where to look first. Hierarchy isn't decoration — it's the mechanism that tells the user what matters most on this screen right now.

## One primary action per screen

Every screen should have exactly one primary call-to-action, styled distinctly (the one place the primary accent color/filled button style is used). Every other action is secondary (outline/ghost/text-only button style) or tertiary (plain text link). A screen with three or four equally-weighted "primary-looking" buttons forces the user to guess what matters, which is a hierarchy failure even if every individual button is well-built.

## Deliberate variation, not uniform weight

Real hierarchy comes from making the important thing bigger, closer, and heavier, and letting the secondary things recede — not from giving every card the same padding, same radius, and same font weight. If every element "shouts" at the same volume (same size, same weight, same color intensity), the page reads as flat regardless of how clean the individual components are.

## Type scale — fix it, don't improvise it

Define a fixed set of sizes/weights and never deviate:
- A typical scale: 12px (caption/meta), 14px (body small/labels), 16px (body default), 20px (subheading), 24–28px (section heading), 32–40px (page title), 48px+ (hero, marketing only).
- Limit to 2 font weights in most interfaces (regular + semibold/bold) — a third weight (light) is optional for large display type only. Avoid weight creep where five different weights are scattered through a build.
- Line height: body text ~1.5x font size for readability; headings can go tighter (~1.1–1.3x).
- One typeface for UI text (a second, display-only typeface is acceptable for large marketing headlines, never for body/UI copy).

## Hierarchy levers, in order of strength

When something needs to stand out, reach for these in priority order rather than defaulting to "make it bigger":
1. **Position** — first/top-left/most prominent placement reads as most important before any styling is applied.
2. **Size** — a meaningfully larger size (not a 1–2px bump; make the jump clear, e.g. 16px → 24px, not 16px → 18px).
3. **Weight** — bold vs. regular.
4. **Color/contrast** — higher contrast against the background draws the eye; muted/lower-contrast color recedes.
5. **Space** — more surrounding whitespace makes an element feel more important by isolating it.

Avoid stacking every lever on one element (huge AND bold AND bright-colored AND isolated) — pick one or two; overdoing it reads as shouting rather than emphasis.

## Pre-ship checklist
- [ ] Exactly one primary-styled action exists per screen; all others are visually secondary/tertiary
- [ ] Every text size/weight on the page comes from the defined type scale — no ad hoc `font-size: 15px` or `font-weight: 550`
- [ ] The most important element on each screen is distinguishable at a glance, before reading any text (via position, size, weight, or contrast)
- [ ] No more than 2 font weights are used across the UI (excluding an optional light weight for large display type)
- [ ] The squint test passes: shrink the page to thumbnail size — the eye should still land on the right element first
