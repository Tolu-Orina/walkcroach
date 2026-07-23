# WalkCroach IDE

VS Code / Cursor extension (custom webview sidebar) + shared `@walkcroach/agent-engine`.

**Auth:** Sign In opens WalkCroach Web `/connect/ide` (reuses `/signin`). One-time authorization code → IDE BFF token exchange. Same Cognito SPA client as Web/Chrome — no Hosted UI, no second user pool.

**Ship path:** private VSIX first — see [INSTALL.md](./INSTALL.md).

## Prerequisites

- Node.js 20+
- VS Code 1.96+ (or Cursor)
- AWS credentials / `AWS_BEARER_TOKEN_BEDROCK` that can call Bedrock
- A **Trusted** workspace folder (NFR-D07)
- Optional: CockroachDB Cloud + WalkCroach Web account

## Setup (developers)

```bash
cd packages/agent-engine && npm install && npm test && npm run build
cd ../../ide && npm install && npm run build && npm run check:bundle
```

F5 → **Run WalkCroach IDE Extension**.

Prod defaults are baked into `package.json` (`apiBaseUrl`, `webAppUrl`, Cognito SPA client + pool).

## Commands

| Command | Purpose |
|---------|---------|
| WalkCroach: Ping / Open Panel | Smoke / focus |
| WalkCroach: Configure CockroachDB | MCP / ccloud secrets |
| WalkCroach: Sign In | Opens Web `/connect/ide` (shared account; OAuth-style code exchange) |
| WalkCroach: Paste Token | Advanced fallback |
| WalkCroach: Link / Unlink Project | Cross-surface link |
| WalkCroach: View Mirrored Memory | List/edit IDE-mirrored entries |

## Package VSIX

```bash
cd ide && npm run package:vsix
```

Produces `walkcroach-ide.vsix` for private distribution.

**Engine purity:** `@walkcroach/agent-engine` must never import `vscode`.

## CLI companion

See `../cli/README.md`.
