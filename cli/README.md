# WalkCroach CLI

A memory-first coding agent in your terminal.

You steer; we explore, act, and verify. `walkcroach` runs the same private agent
engine as the WalkCroach IDE extension, with approvals before writes and **BYOK**
Bedrock inference. It shares one CockroachDB memory layer with Web, Chrome, IDE,
Desktop, and the public SDK — so a decision recorded on one surface is available
in the others.

- **Interactive TUI** on a terminal, plain streaming when piped, NDJSON with `--json`
- **Approvals before writes** — `--yes` auto-approves safe local tools only, and never ccloud, MCP writes or infra commands
- **BYOK** — inference runs on your own AWS credentials; coding turns are not platform-metered (project memory API calls still use your account entitlements when linked)
- **No telemetry.** Not opt-out, not anonymised. See below.

## Install

```bash
npm install -g @walkcroach/cli
walkcroach doctor
```

Published as [`@walkcroach/cli`](https://www.npmjs.com/package/@walkcroach/cli) on npm.
Requires Node 20+. Credentials go to your OS keychain when one is available;
`@napi-rs/keyring` is an optional dependency, so a platform without a prebuilt
binary installs and runs normally on the file backend.

### From a clone

```bash
cd packages/agent-engine && npm install && npm run build   # bundled into the CLI
cd ../templates        && npm install && npm run build     # bundled into the CLI
cd ../../cli && npm install
npm start -- doctor
npm start -- run "Add a health helper"
```

`npm run build` produces the single bundled `dist/bin.js` that ships;
`npm run test:packaged` packs it, installs it outside the repo, and runs it.

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
walkcroach auth login                      # opens your browser
walkcroach auth login --no-browser         # prints the URL (SSH / headless)
walkcroach auth login --token <token>      # CI, no browser
walkcroach auth status

walkcroach create "Invoice Tracker"                    # picks a template interactively
walkcroach create my-app --template todo --open cursor
walkcroach create my-app --no-git --no-register        # fully offline

walkcroach revert --dry-run
walkcroach revert --turn <id> --yes
walkcroach memory list --query "auth decisions"
walkcroach skills list
walkcroach skills list --shared
echo "$KEY" | walkcroach secrets set mcp.apiKey --stdin
walkcroach secrets list                    # keys only, never values
walkcroach secrets rm mcp.apiKey
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
| `.walkcroach/config.json` (in the repo) | Project-level `apiBaseUrl` / `defaultAutonomy`. Read-only; never written by the CLI |
| Env | `WALKCROACH_ACCESS_TOKEN`, `WALKCROACH_API_BASE_URL`, `WALKCROACH_HOME` |

### Sign-in

`walkcroach auth login` opens your browser, reuses your ordinary WalkCroach
sign-in, and receives a **one-time code** on a loopback listener — a token is
never put in a URL or your shell history. `--token` still works for CI, and a
non-TTY run never opens a browser.

### Inference is BYOK

WalkCroach calls Bedrock from your machine with **your** AWS credentials — the
IDE and CLI are free, and no inference cost passes through WalkCroach. Memory
sync, MCP, ccloud and shared skills still go through the authenticated backend.

```bash
walkcroach config bedrockRegion us-east-1        # keys are region-bound
echo "$BEDROCK_KEY" | walkcroach secrets set bedrock.apiKey --stdin
walkcroach doctor                                # shows the inference source
```

A stored key wins over ambient credentials. With no key stored, your existing
AWS profile or role is used exactly as before. With neither, `run` says so
before it starts rather than failing mid-run.

### Where credentials live

The OS keychain when one is available (macOS Keychain, Windows Credential
Manager, Secret Service on Linux), falling back to `~/.walkcroach/secrets.json`
at mode 0600. `walkcroach doctor` reports which backend is live. Set
`WALKCROACH_NO_KEYCHAIN=1` to force the file — useful in containers.

Secrets are never accepted as flag values: use `--stdin` or the prompt.

### Which API am I talking to?

Precedence, highest first:

```
--api-url  >  WALKCROACH_API_BASE_URL  >  .walkcroach/config.json  >  ~/.walkcroach/config.json  >  production default
```

`walkcroach doctor` prints the resolved URL **and** which layer supplied it —
start there when a command talks to the wrong place. For local development
against `npm run dev:ide`:

```bash
walkcroach --api-url http://localhost:3003 doctor
```

A project-level config may only point the CLI at an `https://` host or a
loopback address: cloning a repository must not be enough to redirect an
authenticated CLI, because every request carries your bearer token. Anything
else is ignored with a note on stderr.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Usage — bad flags, arguments, or input |
| `2` | Auth required — run `walkcroach auth login` |
| `3` | The agent run failed |
| `4` | Network — API unreachable, timed out, or 5xx |
| `130` | Interrupted (Ctrl-C) |

## Output conventions

- Human output on **stdout**; phases, tool cards and errors on **stderr** — so `walkcroach run … > out.txt` captures only the answer.
- `--json` makes everything machine-readable on stdout (NDJSON while streaming).
- Colour is disabled automatically when piped, under `NO_COLOR`, or on `TERM=dumb`; `--no-color` forces it off.
- `--no-input` guarantees no prompt; every prompt has a flag equivalent.
- Tokens and AWS keys are scrubbed from anything the CLI prints about itself. The agent's own output is never rewritten.

## Scripting

`--json` puts NDJSON on stdout: a stream of `{"type":"event"}` while a run is in
flight, then exactly one terminal `{"type":"result"}` or `{"type":"command"}`.

A failure carries a stable machine-readable cause alongside the human message:

```json
{ "type": "result", "ok": false,
  "error": "Not signed in. Run: walkcroach auth login",
  "code": "auth_required",
  "hint": "Run: walkcroach auth login" }
```

| `code` | Meaning | Retry after |
|---|---|---|
| `usage` | Bad flags, arguments or input | Fixing the command |
| `auth_required` | No session, or one the API rejected | `walkcroach auth login` |
| `no_credentials` | BYOK is not configured | `walkcroach secrets set bedrock.apiKey` |
| `network` | Unreachable, timed out, or a 5xx | Waiting, then retrying |
| `api_error` | The API understood and refused | Changing the request |
| `run_failed` | The agent run itself failed | Depends on the run |
| `unknown` | Unclassified | — |

Codes are added, never renamed: a script branching on one keeps working.

## Shell completions

```bash
walkcroach completion bash > /etc/bash_completion.d/walkcroach
walkcroach completion zsh  > "${fpath[1]}/_walkcroach"
walkcroach completion fish > ~/.config/fish/completions/walkcroach.fish
```

Generated from the live command tree, so they cannot describe a command that no
longer exists.

## Telemetry

**There is none.** No usage data, no crash reports, no "anonymous" counters —
nothing leaves your machine except the API calls you can see in `doctor`.

This is a decision, not an omission. GitHub CLI enabled opt-out telemetry in
v2.91.0 with no consent prompt and the reaction was immediate; the pattern that
does get accepted (Homebrew's) is a one-time prompt *before* any collection. If
WalkCroach ever wants usage data, that is the bar — until then, the honest
answer is none.

The latency instrumentation in the IDE extension is local-only for the same
reason: measurement you can read, not measurement that is sent.

## TUI keys

- `a` / `y` — approve pending step  
- `r` / `n` — reject  
- `esc` / `q` — cancel run  

## CI example

See [`ci-example.yml`](./ci-example.yml) and [`fixtures/sample-repo`](./fixtures/sample-repo).

## Layout

```
cli/                     # this package (bin: walkcroach)
packages/agent-engine/   # the agent loop — bundled into dist/bin.js
packages/templates/      # `create` templates — shared with the web builder
ide/                     # VS Code host — same engine
```
