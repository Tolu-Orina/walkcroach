# Changelog — @walkcroach/sdk-mcp

## [Unreleased]

## [0.2.1] — 2026-08-11

### Changed
- Depends on `@walkcroach/sdk` `^0.2.1` (semver-compatible with 0.2.0 API).

## [0.2.0] — 2026-08-07

### Changed
- Depends on published `@walkcroach/sdk` `^0.2.0` (no `file:` dependency).
- Bin path + shebang gate so npm keeps `walkcroach-mcp` on publish.

## [0.1.0] — 2026-08-07

### Added
- Streamable HTTP MCP server for WalkCroach memory tools (loopback by default).
- Claude Code / Cursor HTTP host configuration docs.
- Default API origin aligned with `api.walkcroach.rinegansolutions.com`.

### Non-goals
- stdio transport (deliberately unsupported).
