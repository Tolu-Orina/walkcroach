# WalkCroach docs

**Authority:** [`walkcroach-master-doc.md`](./walkcroach-master-doc.md) is the current codebase status audit. Prefer it over archived PRDs when docs conflict.

## Living docs

| Doc | Use when |
|-----|----------|
| [walkcroach-master-doc.md](./walkcroach-master-doc.md) | Ecosystem status, architecture facts, gaps |
| [runtime-secrets-and-ssm.md](./runtime-secrets-and-ssm.md) | Secrets Manager / SSM catalogue |
| [smoke-and-redirects.md](./smoke-and-redirects.md) | Weekend / prod smoke checklist |
| [web-claims-audit.md](./web-claims-audit.md) | Marketing/UI claims vs shipped behaviour |
| [walkcroach-chrome-threat-model.md](./walkcroach-chrome-threat-model.md) | Chrome / BFF / connector threats |
| [walkcroach-stdio-mcp-security-review.md](./walkcroach-stdio-mcp-security-review.md) | IDE/CLI stdio MCP — deferred decision |
| [color-system-research.md](./color-system-research.md) | Graphite Lumen token notes |
| [research/README.md](./research/README.md) | Pointer to upstream Anthropic skills (adapted code is in `skills/web/`) |

## Package docs (stay next to the code)

- `web/`, `chrome/`, `ide/`, `cli/` — README / INSTALL
- `chrome/store/` — CWS submission kit ([index](../chrome/store/README.md))
- `chrome/enterprise/` — managed policy notes
- `infra-backend/README.md`, `infra-backend/modules/lambda-creative/README.md`
- `skills/web/README.md`, `skills/web/NOTICE.md`

## Archive

Historical PRDs and the postponed Desktop plan live in [`archive/`](./archive/). They are **not** build truth.

Finished surface implementation plans (Web Modules, Chrome, CLI, master ecosystem) were removed once the work landed; status lives in the master doc.
