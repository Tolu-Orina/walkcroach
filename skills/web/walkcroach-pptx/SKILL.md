---
name: walkcroach-pptx
description: >-
  Creates professional PowerPoint decks for SME users via Nova Pro brief +
  Nova Canvas imagery + server-side render_pptx, then deterministic script QA
  (validate_pptx, thumbnail_pptx, add_hd_image). Use for slides, pitch decks,
  presentations, or .pptx. Paid-only.
license: WalkCroach original scripts + skill body
origin: walkcroach:web-modules
---

# WalkCroach PPTX (Creative Studio — Slides)

Skills are **instructions + executable scripts**. Nova Pro plans; scripts enforce
quality deterministically inside `lambda-creative` (do not rely on the model to
"notice" corrupt OOXML or overflow).

## Pipeline

```
propose brief → confirm
 → Nova Pro: structured brief JSON
 → Nova Canvas images (quota!)
 → render_pptx (server)
 → python scripts/validate_pptx.py deck.pptx --json
 → python scripts/thumbnail_pptx.py deck.pptx /tmp/grid --cols 3
 → (optional) Pro critiques thumbnail grid, fixes, re-validate
 → creative_assets + download
```

## Scripts (run these — do not reimplement in prose)

| Script | Purpose |
|---|---|
| `scripts/validate_pptx.py` | ZIP/OOXML structure, Content_Types, placeholder/lorem scan, literal `•` detect, optional python-pptx size checks. Exit 1 on errors. |
| `scripts/thumbnail_pptx.py` | LibreOffice → PDF → JPEG grid labeled per slide for visual QA without loading XML into context. |
| `scripts/add_hd_image.py` | HD-enforcement helper: refuse placing an image larger than native pixels; `max_fit_box` for safe layout. |

Invoke from the creative worker cwd where this skill is mounted, e.g.:

```bash
python skills/web/walkcroach-pptx/scripts/validate_pptx.py /tmp/out.pptx --json
python skills/web/walkcroach-pptx/scripts/thumbnail_pptx.py /tmp/out.pptx /tmp/thumbs --cols 3
```

## Coordinate system

- Design canvas **1920×1080**
- PPTX **12,192,000 × 6,858,000 EMU** (16:9)
- **6350 EMU/px** exact
- Always call HD helper before `add_picture`

## Design QA (model + scripts)

**Scripts catch:** broken package, missing slides, lorem, literal bullets, wrong slide size.  
**Model + thumbnail catch:** overlap, low contrast, accent-bar AI tells, uneven gaps.

**Never**

- Accent underlines / sidebar stripes as filler
- Shipping without `validate_pptx.py` exit 0
- Upscaling images past native resolution

## Credits & caps

- Deck **20 credits**; images count toward **3/day**
- Paid + Nova Pro orchestration only

## Memory

Persist brief + palette + s3_key embedding for “another deck like X”.

## Progressive references

- Brand: `load_skill` → `walkcroach-brand-guidelines`
- Themes: `walkcroach-theme-factory` (+ `assets/themes/`)
- Fonts for raster overlays: `walkcroach-creative-philosophy/assets/fonts/` (OFL)
