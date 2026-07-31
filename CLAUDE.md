# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

WalkCroach — an agentic, memory-first AI platform built for the CockroachDB × AWS Hackathon ("Build with Agentic Memory", deadline Aug 18, 2026). One CockroachDB memory layer is shared across four surfaces: a web app-builder, a Chrome copilot extension, a VS Code/Cursor IDE extension, and a CLI. The thesis: the agent loop cannot build coherently without recalling what it already decided, and every decision is written to CockroachDB before the session ends (see `docs/walkcroach-master-doc.md` for current status and locked architecture facts — don't reopen those without cause).

## Repo layout and independent install boundaries

```
walkcroach/
├── web/                     # SPA (Vite/React) — own npm project
├── chrome/                  # Manifest V3 extension (WXT) — own npm project
├── ide/                     # VS Code / Cursor extension — own npm project
├── cli/                     # CLI, same agent engine as the IDE — own npm project
├── packages/agent-engine/   # Shared IDE/CLI agent engine — MUST NOT import `vscode`
├── packages/templates/      # Project templates shared by Web and the CLI — no browser deps
├── infra-backend/           # Terraform + npm workspaces (Lambda BFFs + shared backend packages)
│   ├── packages/{db,agent-harness}      # CockroachDB client + Lambda-side agent runtime (separate from packages/agent-engine)
│   └── modules/lambda-{agent,chrome,ide}/codes/  # Per-surface Lambda BFFs
├── infra-web/               # Terraform: S3, CloudFront, COOP/COEP
├── ci-cd/                   # CodePipeline CloudFormation templates
├── tests/                   # Cross-surface integration + Playwright E2E
└── docs/                    # Status audit, ops runbooks, archived PRDs (see docs/README.md)
```

`web/`, `chrome/`, `ide/`, `cli/`, `packages/agent-engine/`, `infra-backend/`, and `tests/` each install dependencies **separately** — there is no root npm workspace tying them together. Always `cd` into the specific module before running `npm install`/`npm run ...`.

Two distinct agent runtimes exist and are not interchangeable:
- `packages/agent-engine` — runs inside the IDE extension host / CLI process, host-agnostic (see below).
- `infra-backend/packages/agent-harness` — runs in Lambda, used by the Web builder and Chrome BFF.

## Common commands

Bootstrap order (from repo root, matches `README.md` quick start):
```bash
cp .env.example .env   # fill CRDB_CONNECTION_STRING + AWS credentials

cd infra-backend && npm install && npm run build:packages && npm run smoke:memory

cd ../web && npm install && npm run dev

# Chrome extension needs the Chrome BFF running on :3002
cd ../infra-backend && npm run dev:chrome
cd ../chrome && npm install && npm run dev

# IDE extension
cd ../packages/agent-engine && npm install && npm test && npm run build
cd ../../ide && npm install && npm run build && npm run check:bundle
# then F5 -> "Run WalkCroach IDE Extension" in VS Code
```

Per-module scripts (run from inside that module's directory):

| Module | Build | Test (all) | Test (single) | Lint / typecheck |
|---|---|---|---|---|
| `web` | `npm run build` | `npm test` (vitest) | `npx vitest run <path/to/file.test.ts>` | `npm run lint` (oxlint), `npm run typecheck` |
| `chrome` | `npm run build` (wxt) | `npm test` (vitest) | `npx vitest run <path>` | `npm run typecheck` |
| `ide` | `npm run build` (esbuild) | `npm test` (vitest) | `npx vitest run <path>` | n/a — see `check:bundle` |
| `cli` | `npm run build` (tsc) | `npm test` (vitest) | `npx vitest run <path>` | `npm run typecheck` |
| `packages/agent-engine` | `npm run build` (tsc) | `npm test` (vitest) | `npx vitest run <path>` | `npm run typecheck` |
| `infra-backend` | `npm run build` (all workspaces) | `npm test` (all workspaces) | run inside the specific workspace, e.g. `npm test -w @walkcroach/agent-harness` | `npm run typecheck` |
| `tests` | — | `npm run test:integration` (vitest), `npm run test:e2e` (Playwright) | `npm run test:e2e:web` / `test:e2e:chrome`, or `npx playwright test <file>` | — |

`packages/agent-engine` also has `npm run eval` (runs `src/eval` suite) and `npm run smoke:ping`. `infra-backend` has `npm run smoke:memory` / `smoke:loop` / `local:demo` (via `agent-harness`) and `npm run migrate` (CockroachDB migrations in `infra-backend/packages/db/migrations`, numbered sequentially — add new migrations rather than editing old ones).

`ide` packaging: `npm run package:vsix` produces `walkcroach-ide.vsix` for private distribution (see `ide/INSTALL.md`).

## Architecture: the IDE/CLI agent engine (`packages/agent-engine`)

This is the piece most work in the IDE surface touches. It is a host-agnostic agent loop: **it must never import `vscode`**. Host-specific behavior (filesystem, terminal, secrets, webview messaging) is injected via the `HostAdapter` interface (`host.ts`); `ide/src/host/VsCodeHostAdapter.ts` is the VS Code implementation, `cli/` has its own.

Key modules inside `agent-engine/src`:
- `loop.ts` — the agent loop itself (`runAgentLoop`), phases `gather` → `act` → `verify`, nudge prompts, stop-hook handling, todo tracking integration.
- `bedrock.ts` — Bedrock Converse streaming (Nova 2 Lite), tool-use parsing.
- `tools/defs.ts` + `tools/execute.ts` — tool definitions (`PHASE_A_TOOLS`/`PHASE_B_TOOLS`/`PHASE_C_TOOLS`/`ALL_TOOLS`) and execution.
- `approvals.ts` / `approval-controller.ts` — autonomy levels and auto-approve rules for commands/edits (infra commands, critical commands, sensitive paths all gated differently).
- `workspace-config.ts` / `workspace-policy.ts` — reads `.walkcroach/settings.json` and verify config from the trusted workspace.
- `session-store.ts` / `session-fs.ts` / `session.ts` — session persistence, todos persistence, message trimming.
- `hooks.ts` — post-tool-use and stop hooks (user-defined, config-driven).
- `mcp.ts` / `ccloud.ts` — CockroachDB MCP client and `ccloud` CLI wrapper (the "≥2 CockroachDB tools" hackathon requirement).
- `skills.ts` / `skills/bundled.ts` — Agent Skills registry.
- `pty-session.ts` / `stream-shell.ts` / `background-terminals.ts` — terminal execution; PTY backend is optional (needs `node-pty`, which requires a C++ toolchain — see `ide/README.md` "Urgent — later" section for Windows setup), falls back to a pipe backend.
- `protocol.ts` — typed webview↔host message protocol (`HOST_TO_WEBVIEW`/`WEBVIEW_TO_HOST`).

Everything the engine exposes is re-exported from `index.ts` — check there first for what's available before reaching into individual files.

The IDE extension (`ide/src`) is a thin shell around this: `extension.ts` (activation), `host/VsCodeHostAdapter.ts` (implements `HostAdapter`), `host/webviewProvider.ts` + `host/messageBridge.ts` (wires the protocol to the webview), `webview/App.tsx` (the sidebar UI, React), `auth/` (PKCE OAuth against WalkCroach Web's Cognito SPA client — IDE has no separate user pool; sign-in opens Web's `/connect/ide`, redirect URI uses `vscode.env.uriScheme` so it works in VS Code, Cursor, or VS Code Insiders alike).

The `cli` module (`cli/src`) consumes the same `@walkcroach/agent-engine` package (via `file:../packages/agent-engine`) with its own host adapter, no VS Code involved — useful as a reference for host-agnostic behavior when debugging whether a bug is IDE-specific or engine-wide.

## Architecture: backend (`infra-backend`)

npm workspaces rooted here: `packages/db`, `packages/agent-harness`, and the three Lambda code bundles under `modules/lambda-{agent,chrome,ide}/codes`. `agent-harness` is the Lambda-side counterpart to `packages/agent-engine` — same Bedrock/Nova model family, separate implementation, own extended-thinking defaults (see `infra-backend/packages/agent-harness/src/bedrock.ts`).

CockroachDB is the system of record for all four surfaces: sessions/messages, project/stack config, memory entries with vector embeddings (C-SPANN index, `VECTOR(1024)` via Titan Embeddings V2), build events, checkpoints, tool invocations, and per-surface auth/link tables (GitHub app, Chrome/IDE auth codes and workspace links). Migrations live in `infra-backend/packages/db/migrations`, applied in order — read `docs/walkcroach-master-doc.md` §5 (schema) before adding new tables so new memory writes land in the right shape.

**Sandbox note (Web):** Builder prefers **E2B** cloud sandboxes; **WebContainer** is the in-browser fallback (needs COOP/COEP from `infra-web`).

Tool execution is split by where it runs (locked decision — see master doc): **client-resume** tools (`write_file`, `edit_file`, `run_terminal`) execute in the user's own sandbox (E2B or WebContainer for Web; the local machine for IDE/CLI) and resume the server stream via `POST /sessions/:id/tool-result`; **server-side** tools (`recall_project_memory`, `remember_preference`, `web_search`, etc.) run entirely in Lambda/harness. Don't add a new client-resume tool that expects the server to block waiting on it — the Lambda streaming response model (API Gateway REST + `streamifyResponse`) doesn't hold state that way, and there's a 15-minute per-invocation stream limit.

## Testing conventions

Every module uses Vitest with `vitest run` in CI mode (no watch). Test files are colocated as `*.test.ts` next to the source they cover (not in a separate `__tests__` tree). `ide/vitest.config.ts` aliases `vscode` to `ide/src/__mocks__/vscode.ts` since the real module doesn't exist outside the extension host. Coverage thresholds are enforced per-package (`statements: 40` in most configs) — check the relevant `vitest.config.ts` before assuming a change needs full coverage. `tests/` is separate from per-module unit tests: it runs Playwright E2E and cross-surface integration tests against deployed environments, not local unit logic.
