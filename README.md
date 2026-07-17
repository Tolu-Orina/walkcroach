# WalkCroach

Agentic memory-first AI platform — one CockroachDB memory layer across a web builder, browser copilot, and IDE agent.

Built for the **CockroachDB × AWS Hackathon — Build with Agentic Memory**.

## Repo layout

```
walkcroach/
├── web/                              # SPA — own npm project
├── infra-backend/                    # Terraform + own npm workspaces
│   ├── packages/{db,agent-harness}
│   └── modules/lambda-agent/codes/   # Lambda handlers
├── infra-web/                        # Terraform: S3, CloudFront, COOP/COEP
└── ci-cd/                            # CodePipeline CloudFormation templates
```

`web/` and `infra-backend/` install dependencies **separately** (no root npm workspace).

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
```

## Licence

MIT — see [LICENSE](./LICENSE).

**Third-party:** StackBlitz WebContainer (`@webcontainer/api`) is proprietary; used under its published terms. Not vendored into this MIT codebase.
