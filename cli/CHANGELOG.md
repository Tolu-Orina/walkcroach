# Changelog

All notable changes to `@walkcroach/cli`.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow semver — see `VERSIONING.md`. `0.3.0` is the first real release;
`0.0.0` is a deprecated placeholder published only to create the package so
npm trusted publishing (OIDC) could be configured — it cannot perform a
package's first publish.

## [Unreleased]

## [0.3.1] — 2026-08-11

### Changed

- Release bump aligned with platform clients; ships the current monorepo
  `@walkcroach/sdk` / `@walkcroach/agent-engine` via the CLI bundle.

## [0.3.0] — 2026-08-01 — First npm release: PKCE sign-in and local MCP servers

### Security

- **Sign-in now uses PKCE (RFC 7636, S256).** The CLI receives its one-time
  authorization code on a loopback port, which is a channel another process on
  the machine can plausibly race for. Previously that code was a bearer
  credential: whoever held it could redeem it. The exchange now additionally
  requires a verifier that is generated per sign-in, held only in memory, and
  never appears in the authorize URL, the callback URL, or on disk — so an
  intercepted code is worthless.

  Binding the loopback port before opening the browser remains the first line of
  defence; this is defence in depth, not a replacement for it.

  **Breaking against older backends.** The `/ide/v1/oauth/*` endpoints now
  require a challenge and verifier. This CLI will not sign in against a
  WalkCroach backend deployed before 2026-08-01.

### Added

- **stdio MCP servers**, off by default, behind `mcpAllowStdio` in
  `~/.walkcroach/config.json`. `.walkcroach/mcp.json` may now name a program to
  run, not only an HTTP endpoint.

  The gate is read from your **user** config only — deliberately inverting this
  CLI's normal `project > user` precedence, because the file being authorised
  ships inside the repository you just cloned. A repo cannot switch on its own
  code execution.

  Every server additionally requires explicit per-command approval, is spawned
  with an environment stripped of AWS/GitHub/CockroachDB credentials and
  anything credential-shaped, must resolve to an absolute path outside the
  workspace, and is killed with its process tree on exit. Full rationale and
  threat model: `docs/walkcroach-stdio-mcp-security-review.md`.

- **`walkcroach mcp list`** — configured servers, whether each may run, and
  whether it is approved. Shows the *resolved* command, not what `mcp.json`
  wrote, since that is the difference that matters when deciding.
- **`walkcroach mcp revoke [server] | --all`** — withdraw an approval. Approvals
  are recorded per exact command, so editing `mcp.json` already forces a fresh
  prompt; this is for withdrawing one you granted earlier.

### Notes

- There is deliberately no `mcp status`. The CLI is one-shot, so a separate
  invocation would own an empty supervisor and could only ever report "nothing
  running". Live process state belongs to the IDE extension, where a window
  outlives a turn.

## [0.2.0] — unreleased — Phase C5: documentation and release hygiene

### Added

- **Structured `--json` failures.** Every error now carries a stable
  `code` and, where there is one, an actionable `hint` — alongside the
  existing `error` string, which is unchanged so current scripts keep working.

  ```json
  { "type": "result", "ok": false,
    "error": "Not signed in. Run: walkcroach auth login",
    "code": "auth_required",
    "hint": "Run: walkcroach auth login" }
  ```

  Codes: `usage`, `auth_required`, `no_credentials`, `network`, `api_error`,
  `run_failed`, `unknown`. Added, never renamed. `no_credentials` is distinct
  from `auth_required` because signing in does not fix an unconfigured BYOK,
  and a retry policy needs to tell them apart.
- **`walkcroach completion bash|zsh|fish`** — generated from the live command
  tree, so a completion script cannot describe a command that no longer exists.
  The bash output is asserted to parse with `bash -n`.
- **Examples in every command's `--help`**, not just the root. clig.dev:
  users reach for examples before prose.
- `POST_RELEASE.md` — what to watch after the first publish. Short, because
  with no telemetry the reproduction steps *are* the monitoring.

### Changed

- Human-mode failures print the hint on its own line rather than one dense
  line, and the hint is scrubbed for credentials like every other output.
- `README.md` rewritten: it still opened with "Phase D" and described the CLI
  as a companion to the extension. It now leads with what the tool is, and
  states the telemetry position explicitly — **there is none**, and that is a
  decision rather than an omission.

## [0.2.0] — unreleased — Phase C4: BYOK inference

### Fixed

- **`walkcroach secrets set bedrock.apiKey` now actually does something.** The
  key was stored and never read: every run authenticated with whatever ambient
  AWS credentials happened to be present, or failed with an opaque SDK error.

### Added

- **BYOK inference** (master plan Part 1 §4A / §6D / §7C, shipped as one piece
  of work in `@walkcroach/agent-engine`). WalkCroach calls Bedrock with *your*
  AWS credentials; memory sync, MCP, ccloud and shared skills still go through
  the authenticated backend.
  - A key you stored beats anything ambient — pasting a key and having a
    forgotten `AWS_PROFILE` win instead would bill the wrong account.
  - An existing AWS profile keeps working untouched when no key is stored.
  - `run` checks before starting and names the fix, rather than failing thirty
    seconds in on an SDK auth error.
  - `walkcroach config bedrockRegion us-east-1` — a Bedrock API key only works
    in the region it was created in, which is the most common BYOK failure.
  - `doctor` reports an `inference` block: source (`byok-key`, `ambient-bearer`,
    `ambient-aws`, `none`) and region.

```bash
walkcroach config bedrockRegion us-east-1
echo "$BEDROCK_KEY" | walkcroach secrets set bedrock.apiKey --stdin
walkcroach doctor          # inference: { source: "byok-key", … }
```

## [0.2.0] — unreleased — Phase C3: project scaffolding

### Added

- **`walkcroach create <name>`** — scaffolds a project from the same template
  definitions the web builder uses, initialises git, seeds `WALKCROACH.md`,
  registers the project with WalkCroach, and can open it in VS Code or Cursor.

  ```bash
  walkcroach create "Invoice Tracker" --template todo --open cursor
  ```

  - Templates now live in `@walkcroach/templates`, shared by Web and the CLI.
    A project started in the terminal is identical to one started in the
    browser, and a template is updated in one place.
  - **Everything local happens before anything networked.** Signed out or
    offline, the scaffold still succeeds and says it was not registered —
    the files are the deliverable, the database row is an enhancement.
  - The name is validated before the filesystem is touched: path separators,
    `..`, absolute paths, Windows reserved device names, and names with no
    alphanumeric character are all refused, and nothing is written.
  - A non-empty target directory is refused unless `--force`.
  - `--template` always wins; a terminal gets a picker; a non-TTY run uses the
    documented default and says so, rather than blocking.
  - `git` missing, or an editor missing, is reported and never fatal.
  - `--open walkcroach` is deliberately **not** offered: WalkCroach Desktop is
    postponed, and offering a handoff to it would be a claim we cannot honour.

### Backend

- New additive route `POST /ide/v1/projects` (IDE BFF) creating a project with
  `surface_origin='cli'`. No migration was needed — that column has existed
  since migration 001. Requires the IDE Lambda to be redeployed before
  registration works in production; scaffolding is unaffected.

## [0.2.0] — unreleased — Phase C2: packaging and distribution

### Added

- **The CLI is publishable.** `npm i -g @walkcroach/cli` will work on a clean
  machine, which it could not before: `@walkcroach/agent-engine` was a
  `file:../packages/agent-engine` dependency on a `private: true` package, and
  a `file:` range cannot be resolved by anyone installing from the registry.
  The engine is now bundled into `dist/bin.js` (335KB) by `scripts/build.mjs`;
  every *published* dependency stays external and is declared normally, so npm
  can still dedupe and patch them.
- `npm run test:packaged` — packs the tarball, installs it into a scratch
  directory with no relationship to this repo, and runs the binary there. This
  is the gate that catches an unresolvable dependency, a stripped `dist/`, a
  missing shebang, or a runtime import left out of `dependencies`; none of
  those are visible to a unit test.
- `cli/buildspec.yml` — the CLI was the only surface with no CI at all. Runs
  typecheck, unit tests, the bundle, a localhost-default scan, and the
  packaged-artifact gate, and leaves the tarball as a build artifact.
- `.github/workflows/publish-cli.yml` — publishes on a `cli-v*` tag using npm
  trusted publishing over OIDC, so no long-lived npm token exists to leak and
  provenance is attested automatically. It lives in GitHub Actions rather than
  CodeBuild because npm does not recognise CodeBuild as an OIDC issuer.
- `VERSIONING.md` — what counts as major/minor/patch for a surface whose
  contract includes flag spellings, the `--json` envelope and the exit codes.

### Changed

- `dependencies` now declares `@aws-sdk/client-bedrock-runtime` and
  `@modelcontextprotocol/sdk` directly. They were reached transitively through
  the engine; with the engine bundled, they are the CLI's own runtime imports
  and hiding that would break the install.
- `build` runs esbuild instead of `tsc`. The bundle fails closed if it inlines
  a package meant to stay external, or exceeds a 900KB budget.
- The package no longer advertises a library entry point (`main`/`exports`).
  It is a CLI; nothing imports it, and pointing at a `dist/index.js` the build
  does not emit would ship a broken manifest.

## [Unreleased] — Phase C1: ergonomic parity with the IDE

### Added

- **Browser sign-in.** `walkcroach auth login` now opens your browser, signs
  you in with your ordinary WalkCroach account, and receives a one-time code on
  a loopback listener (RFC 8252 §7.3). A token never appears in a URL, a shell
  history, or terminal scrollback.
  - `--token` and `WALKCROACH_ACCESS_TOKEN` are unchanged, so CI never opens a
    browser. Without a TTY the command refuses immediately and names both flags
    rather than waiting two minutes for a human who is not there.
  - `--no-browser` prints the URL for SSH and headless machines.
  - The listener binds before the URL exists, accepts exactly one request on
    `/callback`, requires a matching `state`, and closes as soon as it has a
    verdict.
- `walkcroach revert [--turn <id>] [--dry-run]` — reaches the engine's existing
  checkpoint revert. Confirms before changing files; under `--yes` it requires
  an explicit `--turn` rather than acting on an inferred "most recent" one.
- `walkcroach memory list [--query] [--limit]` — local `WALKCROACH.md` plus
  recall from the linked project. Signed out or unlinked is reported as a
  state, not an error, so the local half still works offline.
- `walkcroach skills list [--shared]` — effective skills with their precedence
  (workspace > shared > bundled), or the account-scoped set.
- `walkcroach secrets set|list|rm` — replaces hand-editing `secrets.json`. A
  value is read from a prompt or `--stdin` and **never** from a flag; `list`
  shows which keys are configured and never their values.
- **Credentials go to the OS keychain** when one is available, with the 0600
  file as a documented fallback. An existing file value keeps working and is
  moved on the next write, leaving no plaintext copy. `WALKCROACH_NO_KEYCHAIN=1`
  forces the file backend for containers and CI.
- `doctor` now reports auth state and expiry, the `ccloud` binary, MCP
  configuration, the terminal backend (`pty` vs `pipe`), and which credential
  backend is live.

### Deploy prerequisite

Browser sign-in needs the IDE Lambda redeployed
(`npm run package:lambda:ide`): the loopback redirect allowlist lives there,
and the currently deployed build rejects it with `redirectUri is not allowed`.
`--token` is unaffected.

## [Unreleased] — Phase C0: guardrails

### Changed — read before scripting against this release

- **The default API is now the production endpoint, not `http://localhost:3003`.**
  A published CLI pointed at localhost talks to nothing on a fresh machine. Local
  development is now the explicit case:

  ```bash
  walkcroach --api-url http://localhost:3003 doctor      # one command
  WALKCROACH_API_BASE_URL=http://localhost:3003 …        # one shell
  walkcroach config apiBaseUrl http://localhost:3003     # persistent
  ```

  An existing `~/.walkcroach/config.json` still wins, so anyone who has run
  `walkcroach config` is unaffected.

- **Exit codes are now specific rather than always `0`/`1`:**
  `0` ok · `1` usage · `2` auth required · `3` run failed · `4` network ·
  `130` interrupted. A script branching on `!= 0` is unaffected; one branching
  on `== 1` for "not signed in" must now check `2`.

- **`doctor` exits non-zero when the API is unreachable** (previously always
  `0`). This makes it usable as a health gate; a script that only wants the
  report should ignore the code.

### Added

- Configuration precedence: `--api-url` > `WALKCROACH_API_BASE_URL` >
  `.walkcroach/config.json` (project, searched upward from the working
  directory) > `~/.walkcroach/config.json` > built-in default. `doctor` and
  `auth status` report which layer won.
- A project-level `.walkcroach/config.json` may only point the CLI at an
  `https://` host or a loopback address. Cloning a repository must not be
  enough to redirect an authenticated CLI, since every request carries a bearer
  token. An untrusted value is ignored with a message on stderr, not obeyed and
  not fatal.
- Global `--no-color` (also honours `NO_COLOR`, `FORCE_COLOR`, `TERM=dumb`) and
  `--no-input` (never prompt, even on a TTY).
- Credential scrubbing on everything the CLI prints about itself — command
  payloads, errors, and agent error events. The agent's own token stream and
  approval previews are deliberately untouched, so generated code and diffs
  stay byte-for-byte intact.
- `walkcroach --help` now leads with examples and documents the exit codes and
  configuration precedence.

### Fixed

- `--version` reported a hardcoded `0.1.0` that could drift from
  `package.json`. There is now one source of truth, asserted by a test.
- `fetch` transport failures surfaced as `TypeError: fetch failed`. They are now
  rewritten as "Cannot reach the WalkCroach API at &lt;url&gt; (ECONNREFUSED)".
