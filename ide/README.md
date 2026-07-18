# WalkCroach IDE

VS Code extension (custom webview sidebar) + shared `@walkcroach/agent-engine`.

**Phase C:** local agent + CockroachDB MCP/skills/ccloud + optional Cognito link for cross-surface memory via thin `/ide` BFF. Unlinked Phase A/B behaviour is unchanged.

## Prerequisites

- Node.js 20+
- VS Code 1.96+ (or Cursor / compatible host)
- AWS credentials that can call Bedrock in `eu-west-2` (or your `AWS_REGION`)
- A **Trusted** workspace folder open (NFR-D07)
- Optional: CockroachDB Cloud cluster + service-account API key (MCP / ccloud)
- Optional: WalkCroach Cognito account + local IDE BFF (`npm run dev:ide` in `infra-backend`)

### AWS / Bedrock credentials

The extension host uses the default AWS SDK credential chain (local Bedrock). Do **not** put secrets in `settings.json`.

| Variable | Default |
|----------|---------|
| `AWS_REGION` / `BEDROCK_REGION` | `eu-west-2` |
| `BEDROCK_NOVA_MODEL_ID` | `global.amazon.nova-2-lite-v1:0` |

## Setup

```bash
# Engine + extension
cd packages/agent-engine && npm install && npm test && npm run build
cd ../../ide && npm install && npm run build && npm run check:bundle

# IDE BFF (Phase C)
cd ../infra-backend
npm install
npm run migrate                    # applies 008_ide_links.sql
npm run package:lambda:ide
npm run dev:ide                    # http://localhost:3003
```

## Run (F5)

1. Trust the workspace folder.
2. F5 → **Run WalkCroach IDE Extension**.
3. Set `walkcroach.ide.apiBaseUrl` to `http://localhost:3003` (default).
4. Optional Cognito:
   - **WalkCroach: Sign In** (PKCE Hosted UI — set `cognitoHostedUiUrl` + `cognitoClientId`), or
   - **WalkCroach: Paste Token** (local/dev).
5. **WalkCroach: Link Project** → pick a Web project.
6. Run a task that uses `recall_project_memory` / `mirror_project_memory`.

## Phase C behaviour

| Feature | Behaviour |
|---------|-----------|
| BFF | `/ide/v1/*` Cognito JWT (or `Bearer dev:<ownerId>` when `ALLOW_DEV_AUTH`) |
| Link | `ide_project_links` maps `local_repo_key` → `project_id` |
| Memory | Same `memory_entries` + Titan embed / C-SPANN as Web/Chrome; `source_surface='ide'` |
| Tools | `recall_project_memory`, `mirror_project_memory` only when linked |
| Secrets | Cognito + MCP/ccloud keys in SecretStorage only |
| Unlinked | Full Phase A/B local agent; no account required |

## Commands

| Command | Purpose |
|---------|---------|
| WalkCroach: Ping / Open Panel | Smoke / focus |
| WalkCroach: Configure CockroachDB | MCP / ccloud secrets |
| WalkCroach: Sign In / Paste Token / Sign Out | Cognito |
| WalkCroach: Link / Unlink Project | Cross-surface link |
| WalkCroach: View Mirrored Memory | List/edit IDE-mirrored entries (FR-D10) |

## Package VSIX

```bash
cd ide && npm run package:vsix
```

**Engine purity:** `@walkcroach/agent-engine` must never import `vscode`.

## CLI companion (Phase D)

Same engine, terminal host + optional Ink TUI:

```bash
cd ../cli && npm install && npm run build
npm start -- doctor
npm start -- run "Add a health helper"   # TUI on a TTY
npm start -- --json run --yes --plain "…"  # CI
```

See `cli/README.md`.
