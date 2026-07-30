---
name: walkcroach-pdf
description: >-
  PDF utilities for WalkCroach creatives and document workflows: rasterize for
  QA/preview, structural checks. Use whenever a .pdf must be created, previewed,
  or validated in Web Modules.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach PDF Utilities

Document skills need **code**, not only prompts: rasterizing and validating PDFs
in Lambda is cheaper and more reliable than asking Nova to invent pixel checks.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/pdf_to_images.py` | PDF → PNG pages (`pdftoppm` or `pdf2image`) for QA grids and Chat previews |

## Typical callers

- `walkcroach-flyer` after `render_flyer`
- Future quote/invoice PDF flows (`walkcroach-docx` export → PDF via soffice)

```bash
python skills/web/walkcroach-pdf/scripts/pdf_to_images.py /tmp/flyer.pdf /tmp/pages
```

## Dependencies (lambda-creative image)

`poppler-utils` (pdftoppm) **or** `pdf2image` + poppler; Pillow.
