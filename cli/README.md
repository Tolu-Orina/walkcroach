# WalkCroach CLI

Companion CLI sharing `@walkcroach/agent-engine` with the VS Code extension (FR-D23–D25).

**Phase D:** interactive **Ink TUI** (visual parity with the IDE panel), JSON mode for scripts, and `--yes` for CI that never auto-approves ccloud / MCP writes / infra.

## Install

```bash
cd packages/agent-engine && npm install && npm run build
cd ../../cli && npm install && npm run build
npm link   # optional: puts `walkcroach` on PATH
```

Or run without linking:

```bash
cd cli
npm start -- doctor
npm start -- run "Add a health helper"
```

## Modes

| Mode | When | Behaviour |
|------|------|-----------|
| **TUI** (default on TTY) | Interactive terminal | Ink UI: brand, phase, tool cards, approve `[a]` / reject `[r]`, streaming transcript |
| **Text** | `--plain` or piped stdout | stderr phases/tools; stdout tokens; stdin `y/N` approvals |
| **JSON** | `--json` | NDJSON events + final `{type:"result"}` / `{type:"command"}` (FR-D24) |
| **CI** | `--yes` / `--non-interactive` | Auto-approve safe local tools only; **refuses** ccloud, MCP write, infra shell (FR-D25) |

## Commands

```bash
walkcroach doctor
walkcroach --json doctor

walkcroach run "Add a health route"
walkcroach run --yes --plain "…"          # CI
walkcroach --json run --yes "…"

walkcroach ping
walkcroach auth login --token <cognito_access_token>
walkcroach auth status
walkcroach projects
walkcroach link <projectUuid>
walkcroach unlink
walkcroach status
walkcroach config
walkcroach config apiBaseUrl http://localhost:3003
```

## Shared config / secrets (FR-D23)

| Path | Purpose |
|------|---------|
| `~/.walkcroach/config.json` | `apiBaseUrl`, Cognito UI settings |
| `~/.walkcroach/secrets.json` (mode 0600) | Cognito token, MCP/ccloud keys — same logical keys as IDE SecretStorage |
| Env | `WALKCROACH_ACCESS_TOKEN`, `WALKCROACH_API_BASE_URL`, `WALKCROACH_HOME` |

Paste the same Cognito access token the extension uses (`WalkCroach: Paste Token`).

## TUI keys

- `a` / `y` — approve pending step  
- `r` / `n` — reject  
- `esc` / `q` — cancel run  

## CI example

See [`ci-example.yml`](./ci-example.yml) and [`fixtures/sample-repo`](./fixtures/sample-repo).

## Layout

```
cli/                 # this package (bin: walkcroach)
packages/agent-engine/
ide/                 # VS Code host — same engine
```
