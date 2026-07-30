# WalkCroach Web Agent Skills

Progressive Agent Skills for WalkCroach Web Modules — **instructions + assets + executable scripts**.

## Read first

- [NOTICE.md](./NOTICE.md) — why scripts matter, Apache vs proprietary split  
- [docs/walkcroach-web-modules-imp-plan.md](../../docs/walkcroach-web-modules-imp-plan.md) — §2 / skills-as-code  

## Layout

```
skills/web/
  walkcroach-*/SKILL.md     # progressive instructions (Nova-oriented)
  walkcroach-*/scripts/     # deterministic utilities (run in lambda-creative)
  walkcroach-*/assets/      # fonts, themes, showcase PDF
  walkcroach-slack-gif/     # Apache GIF core (importable Python)
  walkcroach-internal-comms/
  vendor/apache/            # full attributable Apache mirrors
  requirements-creative.txt
```

## Principle

Do not ask Nova to validate OOXML or count PDF pages in tokens. **Run the script.**  
Do not ship Anthropic proprietary document skill code. **Ship WalkCroach-owned equivalents.**
