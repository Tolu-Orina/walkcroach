# WalkCroach

Agentic memory-first AI platform — one CockroachDB memory layer across a web builder, browser copilot, and IDE agent.

Built for the **CockroachDB × AWS Hackathon — Build with Agentic Memory**.

## Repo layout

```
walkcroach/
├── web/                              # SPA — own npm project
├── chrome/                           # Manifest V3 extension (WXT) — own npm project
├── ide/                              # VS Code extension — own npm project
├── packages/agent-engine/            # Shared IDE/CLI agent engine (no vscode imports)
├── infra-backend/                    # Terraform + own npm workspaces
│   ├── packages/{db,agent-harness}
│   ├── modules/lambda-agent/codes/   # Web builder Lambda
│   └── modules/lambda-chrome/codes/  # Chrome BFF Lambda
├── infra-web/                        # Terraform: S3, CloudFront, COOP/COEP
└── ci-cd/                            # CodePipeline CloudFormation templates
```

`web/`, `chrome/`, `ide/`, `packages/agent-engine/`, and `infra-backend/` install dependencies **separately** (no root npm workspace).

See [docs/plan1.md](./docs/plan1.md) for the full phased implementation plan.

## Prerequisites

- Node.js 20+
- CockroachDB Cloud cluster + connection string
- AWS account with Bedrock access (Nova 2 Lite + Titan Embeddings V2)

## Quick start

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

# IDE extension (Phase 0) — F5 Extension Development Host
cd ../packages/agent-engine && npm install && npm test && npm run build
cd ../../ide && npm install && npm run build
# then Run "Run WalkCroach IDE Extension" (see ide/README.md)
```

## Licence

MIT — see [LICENSE](./LICENSE).

**Third-party:** StackBlitz WebContainer (`@webcontainer/api`) is proprietary; used under its published terms. Not vendored into this MIT codebase.
