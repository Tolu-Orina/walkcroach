---
name: walkcroach-xlsx
description: >-
  Creates spreadsheets for SME pricing, inventories, and simple models via
  server-side tooling. Use for .xlsx requests. Prefer formulas over baked
  values when recalculation is required.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach XLSX

## v1 scope

- Nova Pro → structured sheet spec → `openpyxl` / formula-aware render
- Sanity script: open workbook, assert sheets exist, spot-check formulas

## Scripts

Add `scripts/validate_xlsx.py` in Phase C of Web Modules (open + formula presence).
Do not vendor Anthropic proprietary xlsx scripts.

## Connectors

When Sheets connector is live, prefer writing via connector ConfirmCard for live Google Sheets; use xlsx export when the user needs a downloadable file.
