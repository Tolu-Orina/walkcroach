---
name: walkcroach-theme-factory
description: >-
  Curated color/font themes for WalkCroach creatives (slides, flyers, HTML
  pages). Prefer customer brand from memory when available; otherwise offer a
  theme or generate a custom one. Use when styling decks, flyers, or marketing
  pages.
license: Apache-2.0 (adapted from anthropics/skills theme-factory)
origin: adapted:anthropics/skills/theme-factory
---

# WalkCroach Theme Factory

## Purpose

Apply a cohesive palette + type pairing to slides, flyers, and HTML creatives. Prefer:

1. **Customer brand** recalled from `creative_assets` / `memory_entries` / project prefs
2. **WalkCroach Graphite Lumen** (`load_skill` → `walkcroach-brand-guidelines`) when the artefact is WalkCroach-branded
3. A **preset theme** from `references/theme-factory-themes/` when the user wants variety
4. A **custom theme** generated for the brief (name it, show hexes, confirm)

## Preset themes (assets — load on demand)

- Markdown specs: `assets/themes/*.md` (also `vendor/apache/theme-factory/themes/`)
- Visual showcase PDF: `assets/theme-showcase.pdf` — show/link when the user needs to pick visually

1. Ocean Depths  
2. Sunset Boulevard  
3. Forest Canopy  
4. Modern Minimalist  
5. Golden Hour  
6. Arctic Frost  
7. Desert Rose  
8. Tech Innovation  
9. Botanical Garden  
10. Midnight Galaxy  

**Progressive disclosure:** read only the chosen theme file into context — not all ten.

## Process

1. If memory has a prior creative brief with palette → propose reuse ("use the summer-sale palette?").
2. Else show 3–5 short theme options (name + 3 hex swatches in text) — do not dump all 10 unless asked.
3. Wait for confirm (propose→confirm).
4. `read` the selected `assets/themes/<name>.md` and apply hex/fonts consistently.
5. Pass confirmed hex list into Nova Canvas `COLOR_GUIDED_GENERATION` (max 10).

## Custom theme

When presets do not fit: invent a 1–2 word name, 4–6 hex roles (bg, ink, muted, accent, highlight), display+body faces, one-sentence mood. Confirm before render.

## Anti-patterns

- Equal-weight rainbow palettes
- Defaulting every deck to blue-on-white
- Mixing two presets on one artefact
- Ignoring customer brand already in memory
