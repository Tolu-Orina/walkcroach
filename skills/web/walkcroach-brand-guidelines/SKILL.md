---
name: walkcroach-brand-guidelines
description: >-
  Applies WalkCroach Graphite Lumen brand colors and typography to creatives,
  slides, flyers, UI snippets, and chat artefacts. Use when brand colors, visual
  identity, WalkCroach look-and-feel, or company design standards apply.
license: Apache-2.0 (adapted from anthropics/skills brand-guidelines examples)
origin: adapted:anthropics/skills/brand-guidelines + walkcroach web/src/index.css
---

# WalkCroach Brand Styling — Graphite Lumen

## Overview

Use this skill whenever an artefact should look like WalkCroach — not a generic AI template and not Anthropic/Claude branding.

**Keywords:** branding, Graphite Lumen, WalkCroach identity, slides, flyers, chat UI chrome, marketing creatives

## Brand tokens (source of truth: `web/src/index.css`)

### Colors

| Role | Token | Hex | Use |
|---|---|---|---|
| Ink | `--color-ink` | `#0b0c0f` | Primary text on light; dark canvas base |
| Panel | `--color-panel` | `#14161b` | Surfaces, cards on dark |
| Raised | `--color-raised` | `#1c1f26` | Elevated panels |
| Line | `--color-line` | `#2e333c` | Borders, hairlines |
| Mist | `--color-mist` | `#9198a4` | Secondary / muted text |
| Paper | `--color-paper` | `#f2f3f5` | Light backgrounds, text on dark |
| Signal (CTA) | `--color-signal` | `#f0b429` | Amber — ≤10% of visual weight; primary CTAs only |
| Steel | `--color-teal` | `#6b9eff` | Memory, eyebrows, secondary accents (token name kept as teal) |
| Ember | `--color-ember` | `#f07167` | Errors, destructive |

### Typography

| Role | Face | Fallback |
|---|---|---|
| Display | Bricolage Grotesque | ui-sans-serif, system-ui |
| UI / body | Source Sans 3 | ui-sans-serif, system-ui |
| Code / data | JetBrains Mono | ui-monospace, monospace |

For PowerPoint-safe decks (LibreOffice QA), prefer **Calibri/Arial body** and **Cambria titles** when embedding fonts is unavailable; keep brand hex colors exact.

### Atmosphere

- Prefer cool graphite canvas with amber CTA — not purple-on-white, not warm cream + terracotta, not broadsheet hairline newspaper layouts.
- Gradients / soft atmosphere over flat single-color fills when designing branded surfaces.
- Brand wordmark is a hero-level signal on marketing surfaces; never demote WalkCroach to a tiny eyebrow while a generic headline dominates.

## Application rules

1. **Dominance:** graphite (60–70%) + steel secondary + amber accent (sharp, sparse).
2. **Contrast:** paper text on ink/panel; ink text on paper. Never mist-on-line low contrast for body copy.
3. **Customer brand override:** when the user supplies a brand palette (from memory or brief), those hexes win for *their* creative; WalkCroach chrome around the artefact still uses Graphite Lumen.
4. **Nova Canvas:** pass 1–10 brand hex codes via `COLOR_GUIDED_GENERATION` so imagery matches palette.
5. **Do not** apply Anthropic orange/Poppins/Lora or other third-party brand kits.

## Features checklist

- [ ] Hex colors match table above (or customer brand when specified)
- [ ] Display vs body type roles respected
- [ ] Amber used only for primary action / key highlight
- [ ] Memory / recall affordances use steel (`#6b9eff`)
- [ ] Errors use ember, not red-from-memory
