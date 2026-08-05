---
name: landing-page-conversion-patterns
description: Patterns for distinctive, high-converting marketing and landing pages that avoid the generic "AI slop" template — purple gradient hero, three feature cards, generic pricing table. Use this skill specifically for marketing surfaces (landing pages, product pages, pricing pages, waitlists) — distinct from enterprise-dashboard-patterns, which covers internal/app UI. Use whenever building or reviewing any public-facing marketing page.
---

# Landing Page & Conversion Patterns

There's a specific, recognizable fingerprint to AI-generated marketing pages: purple-to-blue gradient hero, three feature cards in a row with rounded corners and generic icons, a pricing section with the middle plan elevated, an FAQ accordion, and an indigo CTA button. Once you can spot it, you can't unsee it — and neither can visitors. This skill exists to build something distinctive instead.

## Escape the default template

The reason AI defaults to this pattern is that public training data is dominated by tutorials and starter templates using the same structure. Deliberately break at least 2–3 of these defaults on every build:
- Replace the centered gradient hero with an asymmetric layout, a product screenshot/demo embedded directly in the hero, or a split-screen layout.
- Vary card layouts — not every feature needs an identical rounded card; try alternating layouts, a bento-grid, or a list-with-inline-icon pattern instead of three uniform boxes.
- Choose a distinctive, brand-specific color palette rather than the default blue/indigo/purple that every AI-generated SaaS page reaches for first.

## Content-first, not layout-first

Design with the actual copy the product needs, not lorem ipsum. A real headline, real feature descriptions, and real pricing numbers reveal actual layout problems (text wrapping, uneven card heights, awkward line breaks) that placeholder text hides. Write or gather real content before finalizing layout.

## The hero must do one job clearly

The hero section's only jobs are: communicate what the product is/does in one clear headline, and present exactly one primary CTA. Avoid diluting this with multiple competing CTAs, a busy background animation that competes with the headline, or vague headline copy ("Reimagine the future of X") that doesn't say what the product actually does.

## Pricing section specifics

- Highlight exactly one plan (usually the middle/recommended tier) — highlighting more than one dilutes the signal.
- Show what's different between tiers clearly (feature diffs), not just price — a wall of identical checkmarks across all plans gives the user no decision-making information.
- Include the actual currency/billing cadence clearly (monthly vs. annual toggle if relevant) — ambiguous pricing is a conversion killer.

## Social proof and trust signals

For enterprise-facing marketing (which is common for Blessyn's ventures), trust signals matter more than flashy animation: logos of real customers/partners (only if actually true — never fabricate), specific outcome numbers over vague claims ("cut onboarding time by 40%" beats "trusted by industry leaders"), and clear security/compliance signals (SOC2, data residency, GDPR) where relevant to the audience (especially important for HealthTech/FinTech).

## Reference grounding for marketing pages specifically

Before building, gather 2–3 reference screenshots of marketing pages in the actual category/quality bar being targeted (not generic "SaaS landing page" examples) — e.g., for an EdTech or HealthTech product, reference other credible products in that specific space rather than generic startup templates, since audience expectations differ by industry.

## Pre-ship checklist
- [ ] The hero avoids the default purple/indigo gradient + centered headline + generic CTA pattern
- [ ] Feature/benefit sections use varied layout, not three identical rounded cards
- [ ] All copy is real, final content — not lorem ipsum or placeholder feature names
- [ ] Exactly one CTA is the clear primary action in the hero and repeated consistently through the page
- [ ] Pricing (if present) highlights exactly one recommended tier and shows real feature differentiation
- [ ] Any trust/social-proof claims shown are real and verifiable, never fabricated
