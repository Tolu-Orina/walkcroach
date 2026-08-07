# Changelog — @walkcroach/sdk

All notable changes to this package are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/) and `docs/VERSIONING.md`.

## [Unreleased]

### Added
- Durable run interrupt/resume (`threadId`, `interrupt`, `RunInterruptedError`, `RunHandle.resume`, OpenAPI `POST /v1/runs/{id}/resume`).

## [0.1.0] — 2026-08-07

### Added
- Public memory + content client for `/v1` (remember, recall, export/import, erase, audit, publish/runs).
- Default production origin: `https://api.walkcroach.rinegansolutions.com` (P5.1).
- Re-exports from `@walkcroach/memory-contracts` (kinds, export envelope, validateExport).
- `createHostMemoryBridge` for first-party IDE/CLI/Desktop hosts.

### Compatibility
- OpenAPI: `packages/sdk/openapi/v1.yaml` info.version `1.0.0` (HTTP contract major).
- Export format: `walkcroach-memory-export/1.x` (see memory-contracts).
