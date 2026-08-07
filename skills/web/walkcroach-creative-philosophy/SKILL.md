---
name: walkcroach-creative-philosophy
description: >-
  Creates a short visual philosophy before generating posters, flyers, or
  static art so Nova Canvas / flyer renders look intentional rather than
  templated. Use for flyer, poster, or visual creative requests.
license: Apache-2.0 (adapted from anthropics/skills canvas-design)
origin: adapted:anthropics/skills/canvas-design
---

# WalkCroach Creative Philosophy → Visual Expression

For static marketing art (flyers, posters, social stills), work in two steps:

1. **Philosophy** (short markdown in the brief JSON — not a user-facing essay)
2. **Expression** via tools: `generate_image` (Nova Canvas) and/or `render_flyer`

## Step 1 — Visual philosophy (internal)

Name the movement in 1–2 words (e.g. "Steel Pulse", "Market Dawn"). In 3–5 dense sentences capture:

- Space and form
- Color (tie to `walkcroach-theme-factory` / customer brand)
- Scale and rhythm
- How text appears (sparse, essential — never walls of copy on a flyer)

Emphasize craftsmanship: the result should feel meticulously made for *this* SME, not a stock template.

## Step 2 — Express

- Map philosophy → Nova Canvas prompt + `COLOR_GUIDED_GENERATION` hexes
- Flyer HTML: large visual plane, one headline, one supporting line, one CTA — full-bleed hero when promotional
- Avoid AI-default looks: purple gradients, cream+terracotta cliché, broadsheet columns, accent underlines under titles

## Assets (use them)

Bundled OFL fonts under `assets/fonts/` (from Apache `canvas-design` pack), including **Bricolage Grotesque**, JetBrains Mono, Instrument Sans/Serif, and many display faces. Prefer these for flyer HTML/PDF type — do not assume CDN fonts inside Lambda.

Full upstream package also mirrored at `vendor/apache/canvas-design/` for reference.

## Constraints (WalkCroach)

- Requires **paid** tier + Nova 2 Lite orchestration (`walkcroach-model-routing`)
- Image generations count against **3/day** hard cap (`walkcroach-quota-and-credits`)
- Propose the brief (philosophy + copy + palette) → user confirms → execute tools
- Persist successful briefs to `creative_assets` for memory recall
- After PDF render: run `walkcroach-pdf/scripts/pdf_to_images.py` for visual QA
