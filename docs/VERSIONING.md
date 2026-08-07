# Versioning policy (Phase P5.5)

## Packages

| Package | Public? | Version surface |
|---|---|---|
| `@walkcroach/sdk` | yes | npm SemVer; OpenAPI `info.version` tracks **HTTP major.minor** |
| `@walkcroach/sdk-mcp` | yes | npm SemVer; follows MCP protocol revisions in README |
| `@walkcroach/memory-contracts` | private | bump when kinds/export break; consumed in-repo |
| `@walkcroach/agent-engine` | **no** | not published (see ARCHITECTURE / Phase 6 gate) |

## OpenAPI vs npm

- **OpenAPI `info.version`** = public HTTP contract (`1.0.0` today). Breaking path/schema changes → bump **major**.
- **npm package version** may move independently for client-only fixes (`0.1.x` → `0.2.0` additions).
- Drift checks: `npm run check:openapi` and `npm run check:memory-contracts` in `packages/sdk`.

## Export format

- Envelope: `walkcroach-memory-export`
- Version: `1.0` (`EXPORT_VERSION` in memory-contracts)
- **1.x** remains readable; **2.0** would require a new major and dual-read window.
- Compatibility tests live in `memory-contracts` fixtures + `validateExport`.

## Release checklist (sdk + sdk-mcp)

1. P0–P2 exit criteria green (contract routes + first-party bridges).
2. CHANGELOG entry for the release.
3. `npm run build` + `npm test` in each package.
4. Manual workflow `.github/workflows/publish-sdk.yml` (workflow_dispatch only).
5. Tag `sdk-vX.Y.Z` / `sdk-mcp-vX.Y.Z`.
