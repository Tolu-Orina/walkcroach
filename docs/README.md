# WalkCroach docs

**Authority:** Prefer living docs below over archived PRDs. Refreshed **2026-08-07** from `walkcroach/` + `walkcroach-desktop/` source.

| Audience | Start here |
|-----|----------|
| **PM / BA / QA** | [`walkcroach-product-master-doc.md`](./walkcroach-product-master-doc.md) |
| **Engineering / architecture** | [`walkcroach-master-doc.md`](./walkcroach-master-doc.md) |

## Living docs

| Doc | Use when |
|-----|----------|
| [walkcroach-product-master-doc.md](./walkcroach-product-master-doc.md) | **Product master** — six surfaces, maturity, journeys, claims, QA packs (PM/BA/QA) |
| [walkcroach-master-doc.md](./walkcroach-master-doc.md) | **Engineering master** — dual loops, versions, migrations, infra, gap IDs |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Dual-loop non-goals, contract fitness, revisit triggers |
| [adr/](./adr/) | ADR-0001 retention · ADR-0002 erase · ADR-0003 engine production bar |
| [walkcroach-desktop.md](./walkcroach-desktop.md) | Desktop IDE pointer — detail in sibling `walkcroach-desktop/docs/` |
| [hackathon-submission.md](./hackathon-submission.md) | Draft submission write-up — verify against master doc before shipping claims |
| [walkcroach-sdk-implementation-plan.md](./walkcroach-sdk-implementation-plan.md) | Historical SDK plan — **status superseded by master doc §7 + ARCHITECTURE.md** |
| [runtime-secrets-and-ssm.md](./runtime-secrets-and-ssm.md) | Secrets Manager / SSM catalogue |
| [smoke-and-redirects.md](./smoke-and-redirects.md) | Weekend / prod smoke checklist (migrations through **037**) |
| [web-claims-audit.md](./web-claims-audit.md) | Marketing/UI claims vs shipped behaviour |
| [walkcroach-chrome-threat-model.md](./walkcroach-chrome-threat-model.md) | Chrome / BFF / connector threats |
| [walkcroach-stdio-mcp-security-review.md](./walkcroach-stdio-mcp-security-review.md) | IDE/CLI stdio MCP — security gate |
| [color-system-research.md](./color-system-research.md) | Graphite Lumen token notes |
| [research/README.md](./research/README.md) | Pointer to upstream Anthropic skills (adapted code is in `skills/web/`) |

## Package docs (stay next to the code)

- `web/`, `chrome/`, `ide/`, `cli/` — README / INSTALL
- `packages/sdk/` — public SDK README + OpenAPI
- `chrome/store/` — CWS submission kit ([index](../chrome/store/README.md))
- `chrome/enterprise/` — managed policy notes
- `infra-backend/README.md`, `infra-backend/modules/lambda-creative/README.md`
- `skills/web/README.md`, `skills/web/NOTICE.md`
- `walkcroach-desktop/docs/{ARCHITECTURE,STATUS,SHIPPING}.md` — Desktop truth

## Archive

Historical PRDs live in [`archive/`](./archive/). They are **not** build truth.

The archived Desktop PRDs and multi-doc plans live under [`archive/`](./archive/) (`walkcroach-desktop-*`). Living Desktop truth: [`walkcroach-desktop.md`](./walkcroach-desktop.md) plus `walkcroach-desktop/docs/{ARCHITECTURE,STATUS,SHIPPING}.md`.

Finished surface implementation plans (Web Modules, Chrome, CLI, master ecosystem) were removed once the work landed; status lives in the master doc.
