---
name: walkcroach-creative-a11y
description: >-
  Basic accessibility checks for WalkCroach creatives — PPTX image alt
  (cNvPr descr/title), flyer HTML img alt, and brief.altText when stills
  are estimated. Fail-closed in lambda-creative after render.
license: WalkCroach original
origin: walkcroach:web-modules
---

# Creative a11y (Phase E3)

## Script

```bash
python scripts/check_creative_a11y.py deck.pptx --brief brief.json
python scripts/check_creative_a11y.py flyer.html
```

Exit `0` = pass, `1` = findings (fail closed for render).

## Rules

1. Every PPTX picture must have non-empty `cNvPr` `descr` or `title`.
2. Every flyer `<img>` must have a meaningful non-empty `alt`.
3. If `estimatedImages > 0`, brief must include `altText`.

Nova 2 Lite briefs should invent short alt text when stills are planned.
