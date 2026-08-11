# Changelog

All notable changes to the WalkCroach IDE extension (VS Code, Cursor,
VSCodium, Windsurf). Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow semver.

`0.2.0` is the first public release. `0.1.0` existed only as a privately
distributed VSIX.

## [0.2.1] — 2026-08-11

### Fixed

- Typecheck: `formatOnSave` restore now reads `workspaceFolderValue` /
  `workspaceValue` (VS Code inspect API).
- Cognito token slots match CLI / Chrome: **access** for SDK memory, **id**
  (preferred) for IDE BFF Bearer. Web Sign In remains the primary auth path;
  Paste Token is advanced fallback only.
- Default autonomy is **strict** (was `low_friction`), aligned with the CLI.
- Setup CTA no longer requires Cockroach MCP — MCP stays optional.
- Webview body / monospace type scale (was 5.625px / 5.5px).
- Marketplace + sidebar brand mark refreshed from `web/public/walkcroach-icon.png`.
  Activity bar uses the same colored `media/icon.png` (VS Code masks it to
  monochrome); the dedicated SVG was removed.
- Plan review questions render via `react-markdown` (was plain `<p>`).

### Changed

- **Edit thrash guard:** identical `old_str` after `edit_mismatch` is refused
  until `read_file` on that path (covers edit_file ↔ apply_patch hopping).
- **Thinking stream:** Nova extended-thinking deltas surface in the sidebar so
  medium/high reasoning no longer looks hung.
- Prompt caching was already enabled for Nova via system `cachePoint`s (AWS:
  Nova 2 Lite supports prompt caching, max 20K cached tokens).

## [0.2.0] — 2026-08-01 — First public release: PKCE sign-in and local MCP servers

### Security

- **Sign-in now uses PKCE (RFC 7636, S256).** The extension receives its
  one-time authorization code on a `vscode://` deep link — a channel handled by
  the OS and observable in ways a browser redirect is not. That code was
  previously a bearer credential: whoever held it could redeem it. The exchange
  now additionally requires a verifier that never leaves the extension host.

  The verifier is kept in `SecretStorage` rather than only in memory, because a
  deep-link callback can reactivate an extension host that was disposed
  mid-sign-in, and a verifier lost to a restart would strand you holding a code
  you can no longer redeem.

  **Breaking against older backends.** This build will not sign in against a
  WalkCroach backend deployed before 2026-08-01. Equally, a *previous* VSIX will
  no longer sign in against the current backend — update rather than downgrade.

  Note the previous `auth/pkce.ts` contained only `@deprecated` leftovers of a
  removed Hosted-UI flow, wired to nothing. Sign-in was protected by a one-time
  code, a hashed state and a bound redirect URI, but not by proof of possession.

### Added

- **stdio MCP servers**, off by default, behind the new
  `walkcroach.ide.mcp.allowStdio` setting. `.walkcroach/mcp.json` may now name a
  program to run, not only an HTTP endpoint.

  The setting is contributed with `"scope": "machine"`, so VS Code refuses to
  let a workspace's `.vscode/settings.json` override it. That placement is the
  gate: the file being authorised lives in the repository you just cloned, so a
  workspace-settable flag would let a repo enable its own code execution. An
  untrusted workspace cannot spawn anything regardless.

  Each server additionally requires explicit approval of its exact resolved
  command, is spawned with an environment stripped of AWS/GitHub/CockroachDB
  credentials and anything credential-shaped, is refused if it resolves inside
  the workspace, and is killed with its process tree when the window closes.
  Threat model and full rationale:
  `docs/walkcroach-stdio-mcp-security-review.md`.

- **MCP servers panel in Setup** — every configured server with its transport,
  live pid, and for local ones the *resolved absolute command* rather than what
  `mcp.json` wrote. **Stop** ends a running server; **Revoke approval**
  withdraws permission for the next run. They are separate buttons because they
  are separate decisions — revoking does not kill something already running, and
  the panel says so rather than letting you assume it did.

- Third-party MCP tools are addressed as `server__tool`, so no configured server
  can shadow a first-party tool name.
