# WalkCroach

Agentic memory-first AI platform — one CockroachDB memory layer across **six surfaces**:
a web builder, a browser copilot, an IDE extension, a CLI, an SDK, and a native Desktop IDE.

| Surface | State |
|---|---|
| Web · Chrome · IDE extension · CLI | Shipped |
| **SDK** (`@walkcroach/sdk`, `sdk-mcp`, `sdk-host`) | Built; agent path not yet run end-to-end |
| **Desktop IDE** (Code OSS fork, native agent) | In build — see [plan](./docs/walkcroach-desktop-implementation-plan.md) |

Built for the **CockroachDB × AWS Hackathon — Build with Agentic Memory**.

## Repo layout

```
walkcroach/
├── web/                              # SPA — own npm project
├── chrome/                           # Manifest V3 extension (WXT) — own npm project
├── ide/                              # VS Code extension — own npm project
├── cli/                              # CLI (same agent engine as IDE) — own npm project
├── packages/agent-engine/            # Shared agent loop — IDE, CLI, SDK, Desktop (no vscode imports)
├── packages/sdk/                     # @walkcroach/sdk — memory client
├── packages/sdk-mcp/                 # MCP server (2026-07-28) over the memory layer
├── packages/sdk-host/                # Programmatic HostAdapter — the loop, driven by API
├── packages/templates/               # Shared project templates
├── skills/web/                       # WalkCroach Agent Skills (Web)
├── infra-backend/                    # Terraform + own npm workspaces
│   ├── packages/{db,agent-harness}
│   └── modules/lambda-{agent,chrome,ide,creative}/
├── infra-web/                        # Terraform: S3, CloudFront, COOP/COEP
├── ci-cd/                            # CodePipeline CloudFormation templates
├── tests/                            # Cross-surface integration + Playwright E2E
└── docs/                             # Status audit, ops runbooks, archive
```

`web/`, `chrome/`, `ide/`, `cli/`, `packages/agent-engine/`, `infra-backend/`, and `tests/` install dependencies **separately** (no root npm workspace).

See [docs/README.md](./docs/README.md) for documentation index and [docs/walkcroach-master-doc.md](./docs/walkcroach-master-doc.md) for current codebase status.

## Prerequisites

- Node.js 20+
- CockroachDB Cloud cluster + connection string
- AWS account with Bedrock access (Nova 2 Lite + Titan Embeddings V2)

## Install

Try the agent without building anything:

```bash
# CLI
npx @walkcroach/cli@latest auth login
npx @walkcroach/cli@latest run "explain this repo"
```

**IDE extension** — install `walkcroach.walkcroach-ide` from
[Open VSX](https://open-vsx.org/extension/walkcroach/walkcroach-ide) (VS Code,
Cursor, VSCodium, Windsurf), or from the `.vsix` in
[Releases](https://github.com/Tolu-Orina/walkcroach/releases).

Both sign in against the same account as the web app, and share one CockroachDB
memory layer — a decision recorded in one surface is recalled in the others.

## Quick start

Building from source:

```bash
cp .env.example .env
# fill in CRDB_CONNECTION_STRING and AWS credentials

# Backend packages + Lambda
cd infra-backend
npm install
npm run build:packages
npm run smoke:memory

# Web SPA (separate)
cd ../web
npm install
npm run dev

# Chrome extension (separate) — needs Chrome BFF on :3002
cd ../infra-backend && npm run dev:chrome
cd ../chrome && npm install && npm run dev

# IDE extension
cd ../packages/agent-engine && npm install && npm test && npm run build
cd ../../ide && npm install && npm run build
# then Run "Run WalkCroach IDE Extension" (see ide/README.md)

# CLI
cd ../cli && npm install && npm run build
```

## Licence

MIT — see [LICENSE](./LICENSE).

**Third-party:** StackBlitz WebContainer (`@webcontainer/api`) is proprietary; used under its published terms. Not vendored into this MIT codebase.
