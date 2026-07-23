# Versioning (PD.5)

WalkCroach Chrome uses **semver** in `package.json` → WXT embeds it in the extension manifest.

| Bump | When |
|------|------|
| **MAJOR** | Breaking permission changes, storage schema wipe, or incompatible API |
| **MINOR** | New user-facing features (e.g. sector actions, project link) |
| **PATCH** | Fixes, copy, store-asset-only updates |

## Rules

1. Bump version **before** every Chrome Web Store upload (same version cannot be re-uploaded).
2. Record changes in `CHANGELOG.md`.
3. CI zip artifact must match the version you submit.
4. Production builds must set `WALKCROACH_API_BASE` to the live API stage URL (never localhost).
5. Use `npm run zip:prod` for store uploads (fail-closed HTTPS bake + localhost scan).

**Current store-candidate line: `0.1.2`** (Phase 1 public-CWS prep — not yet published).
