---
name: walkcroach-docx
description: >-
  Creates and lightly validates Word documents for SME ops (proposals, SOWs,
  letters) using server-side tooling. Use for .docx requests in Chat. Paid for
  heavy generation; reading extracts may use Lite.
license: WalkCroach original (capability pattern informed by public Agent Skills
  practice; does not vendor Anthropic proprietary docx scripts)
origin: walkcroach:web-modules
---

# WalkCroach DOCX

## Why scripts matter here

OOXML Word files fail silently (missing rels, broken content types). Generation
must end with a deterministic open/round-trip check in `lambda-creative`.

## v1 scope

- Generate from Nova Pro brief → `python-docx` render tool `render_docx`
- Validate: file opens, has ≥1 paragraph, no lorem
- Optional: export PDF via LibreOffice for preview (`walkcroach-pdf`)

## Scripts (expand in Phase B+)

Place validators under `scripts/` as they land (`validate_docx.py`). Until then,
fail closed if `python-docx` cannot open the output.

## Do not

Copy or redistribute Anthropic proprietary `docx/scripts/**` — implement WalkCroach-owned helpers only.
