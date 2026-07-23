# Install WalkCroach IDE (private VSIX)

For invited users this week. Open VSX / Marketplace comes after publisher enrollment.

## Prerequisites

1. **VS Code 1.96+** or **Cursor**
2. **AWS Bedrock access** in `eu-west-2` (or set `AWS_REGION` / `BEDROCK_REGION`)
   - Use an AWS profile / env credentials, **or**
   - Set `AWS_BEARER_TOKEN_BEDROCK` in the environment that launches the IDE
3. A **trusted** workspace folder (VS Code Workspace Trust)
4. Optional: WalkCroach Web account for Sign In + project memory
5. Optional: CockroachDB Cloud cluster for MCP / `ccloud`

There is **no Bedrock key field inside the extension UI** today — credentials must be available to the IDE process via the normal AWS SDK chain.

## Install from VSIX

1. Get `walkcroach-ide.vsix` from your WalkCroach contact / release drop.
2. In VS Code or Cursor:
   - Extensions view → `…` → **Install from VSIX…** → select the file  
   - or CLI: `code --install-extension walkcroach-ide.vsix`
3. Reload the window if prompted.
4. Open a folder and **trust** it.
5. Click the WalkCroach activity-bar icon.

## First run

1. Command palette → **WalkCroach: Ping** (smokes Bedrock).
2. Optional account (same WalkCroach login as Web / Chrome):
   - **WalkCroach: Sign In** opens the Web app.
   - Sign in normally if needed (same `/signin`).
   - Web issues a one-time connect code; your IDE exchanges it for tokens (tokens never appear in the browser URL).
   - Allow the `vscode://` protocol prompt.
   - Fallback: **WalkCroach: Paste Token** (advanced).
3. **WalkCroach: Link Project** to attach cross-surface memory.
4. **WalkCroach: Configure CockroachDB** for Managed MCP / `ccloud`.

## Defaults baked into this build

| Setting | Default |
|---------|---------|
| `walkcroach.ide.apiBaseUrl` | `https://awbcf4clij.execute-api.eu-west-2.amazonaws.com/v1` |
| `walkcroach.ide.webAppUrl` | `https://walkcroach.conquerorfoundation.com` |
| `walkcroach.ide.cognitoClientId` | Web SPA client (shared Cognito) |
| `walkcroach.ide.cognitoUserPoolId` | `eu-west-2_iKk1NYkcQ` |
| `walkcroach.ide.cognitoRegion` | `eu-west-2` |

Override in Settings only if you are targeting a non-prod environment.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Ping / agent fails with AccessDenied | Fix AWS/Bedrock credentials for the IDE process |
| Sign In does nothing | Allow the protocol handler; ensure Web is reachable |
| Link / memory 401 | Sign in again; confirm API base URL |
| Tools disabled | Trust the workspace folder |
| MCP errors | Re-run Configure CockroachDB |

## After Open VSX enrollment

```bash
cd ide
npm run package:vsix
npx ovsx publish walkcroach-ide.vsix -p "$OVSX_PAT"
```

Users can then install from the Open VSX / Cursor marketplace under publisher `walkcroach`.
