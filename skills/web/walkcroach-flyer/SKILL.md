---
name: walkcroach-flyer
description: >-
  Creates single-page marketing flyers (PDF/PNG) via Nova 2 Lite, Nova Canvas, and
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
 → Nova 2 Lite field map + Canvas hero
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

## Templates

HTML pack under `templates/` (baked into lambda-creative):

| File | Use |
|---|---|
| `sale.html` | Promotional / discount one-pager |
| `event.html` | Date-forward event split layout |
| `announcement.html` | Light-on-dark announcement |

Renderer fills Graphite Lumen tokens; Playwright produces PDF when Chromium is present, otherwise ReportLab twin (same field map) for local/CI.

## Credits

**10 credits**; images toward **3/day**; paid only.
