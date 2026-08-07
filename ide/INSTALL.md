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

There is a **Setup** page in the sidebar (gear icon) for Bedrock API key and CockroachDB MCP credentials. Secrets are stored in VS Code **SecretStorage** (OS keychain), not settings.json.

You can also use AWS credentials / `AWS_BEARER_TOKEN_BEDROCK` in the environment that launches the IDE.

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
| `walkcroach.ide.apiBaseUrl` | `https://api.walkcroach.rinegansolutions.com/v1` |
| `walkcroach.ide.webAppUrl` | `https://walkcroach.rinegansolutions.com` |
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

## Publishing to Open VSX

The path is wired, not just written down (§7D):

| Step | Where |
|---|---|
| Verify the listing metadata and the built bundle | `npm run check:publishable` |
| Build, size-check, verify and package | `npm run package:vsix` |
| Publish | tag `ide-v<version>` → `.github/workflows/publish-ide.yml` |

`check:publishable` fails closed on a missing marketplace field, a placeholder
icon, a README too short to be a listing, an unbuilt bundle, a non-production
`apiBaseUrl` default, or a `package:vsix` that lost `--no-dependencies`.

**Before the first publish**, one manual step remains — it needs a human with
the account:

1. Enrol the `walkcroach` publisher at <https://open-vsx.org> and sign the
   publisher agreement.
2. Create an access token, and store it as `OVSX_PAT` in the `ovsx-publish`
   GitHub environment.

Then:

```bash
cd ide
npm version patch          # or minor/major
git tag ide-v$(node -p "require('./package.json').version")
git push --tags
```

Users can then install from the Open VSX / Cursor marketplace under publisher
`walkcroach`. Locally, `npm run publish:ovsx` does the same with a token in the
environment.
