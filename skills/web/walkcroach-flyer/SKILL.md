---
name: walkcroach-flyer
description: >-
  Creates single-page marketing flyers (PDF/PNG) via Nova Pro, Nova Canvas, and
  headless HTML-to-PDF, then runs check_flyer_pdf + pdf_to_images for
  deterministic QA. Use for flyers, posters, one-pagers. Paid-only.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach Flyer Studio

## Pipeline

```
load walkcroach-creative-philosophy
 → propose → confirm
 → Nova Pro field map + Canvas hero
 → render_flyer (HTML → PDF)
 → python ../walkcroach-pdf/scripts/pdf_to_images.py out.pdf /tmp/pages
 → python scripts/check_flyer_pdf.py out.pdf --max-pages 1
 → creative_assets kind=flyer
```

## Scripts

| Script | Purpose |
|---|---|
| `scripts/check_flyer_pdf.py` | Page count, placeholder text scan |
| `../walkcroach-pdf/scripts/pdf_to_images.py` | Rasterize pages for Pro/CI visual QA and Chat preview |

## Layout rules

Full-bleed hero, brand-level name, one headline, one support line, one CTA. Use OFL fonts under `walkcroach-creative-philosophy/assets/fonts/` when rasterizing type into the HTML template (Bricolage Grotesque is already in that pack — aligns with Graphite Lumen).

## Credits

**10 credits**; images toward **3/day**; paid only.
