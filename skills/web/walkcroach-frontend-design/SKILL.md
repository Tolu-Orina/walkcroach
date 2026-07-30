---
name: walkcroach-frontend-design
description: >-
  Opinionated UI design for WalkCroach Web Builder scaffolds and generated app
  UIs. Use when creating or restyling pages, landing sections, or app shells so
  they avoid generic AI-template looks and respect Graphite Lumen when on-brand.
license: Apache-2.0 (adapted from anthropics/skills frontend-design)
origin: adapted:anthropics/skills/frontend-design + walkcroach frontend rules
---

# WalkCroach Frontend Design

Approach Builder output as a small studio: distinctive, subject-grounded, not templated.

## Ground it

Pin subject, audience, and the page's single job before coding. Prefer project memory and prior brand choices.

## Hard rules (WalkCroach product surfaces)

- One composition in the first viewport (not a dashboard unless it is a dashboard)
- Brand-first on branded pages; Graphite Lumen tokens when WalkCroach-branded
- Expressive fonts (not Inter/Roboto/Arial defaults) — Bricolage + Source Sans 3 when WalkCroach
- Atmospheric backgrounds (gradient/pattern), not flat single fills
- Full-bleed hero on landing/promo; no inset hero cards or floating collage
- Hero budget: brand, one headline, one support line, one CTA group, one dominant image
- No hero overlays (badges, chips, stickers)
- Cards only when they contain interaction; default no cards
- One job per section
- 2–3 intentional motions max
- Avoid purple AI clichés, cream+terracotta defaults, broadsheet layouts, dark-mode-by-default bias, emoji decoration

## Process

1. Compact token plan: 4–6 hexes, display+body faces, layout concept, one signature element
2. Self-critique: if it looks like any generic AI landing page, revise
3. Build from tokens; keep CSS specificity clean
4. Mobile + keyboard focus + `prefers-reduced-motion`

## Copy

Active voice, plain verbs, sentence case. Errors explain how to fix. Empty states invite one action.
