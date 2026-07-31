# After the first publish — what to watch

CLI plan **C5.6**. Mirrors `chrome/POST_SUBMIT_MONITORING.md`, adapted to the
fact that a CLI ships to a machine we cannot see and **sends us nothing**.

That constraint shapes this whole document. With no telemetry (deliberately —
see `README.md`), every signal below is either something npm reports, something
a user tells us, or something we reproduce ourselves. There is no dashboard
coming to rescue a bad release, which is why the reproduction steps in §2 are
the real monitoring.

---

## 1. First 24 hours

| Check | How | What "bad" looks like |
|---|---|---|
| The published tarball installs | `npm i -g @walkcroach/cli@<version>` on a clean machine | Any install error. This is what `test:packaged` gates, so a failure here means the gate missed a platform |
| The binary runs from a fresh shell | `walkcroach --version` && `walkcroach doctor --json` | `doctor` reporting `apiBaseUrl` anything other than the production API |
| The optional native dep is genuinely optional | Install on a platform with no `@napi-rs/keyring` prebuild | Install fails, or `secrets list` throws instead of reporting `backend: "file"` |
| Provenance was attested | `npm view @walkcroach/cli --json \| grep -i provenance` | Absent — the publish fell back off trusted publishing |
| Download count moves at all | `npm view @walkcroach/cli` | Zero after a day is a distribution problem, not a quality one |

## 2. Reproduce the four paths that break first

Run these yourself on a machine that has never had the CLI. They are the
smoke test a user performs without meaning to.

```bash
npm i -g @walkcroach/cli
walkcroach doctor --json        # expect apiBaseUrlSource: "default", https URL
walkcroach auth login           # browser opens, returns signed in
walkcroach create demo-app --template blank --no-register
cd demo-app && npm i && npm run build
```

| Step | Most likely failure | First thing to check |
|---|---|---|
| `doctor` | `ideBff.ok: false` | Is the IDE Lambda deployed? `apiBaseUrlSource` — is a stale user config winning? |
| `auth login` | `redirectUri is not allowed` | **The IDE Lambda predates the loopback allowlist.** Redeploy: `npm run package:lambda:ide` |
| `create --register` | Registration skipped | Same deploy. `POST /ide/v1/projects` is new in C3 |
| `run` | `code: "no_credentials"` | Working as designed — BYOK is not configured on that machine |

## 3. Signals we actually have

- **npm downloads** — direction only. A flat line after a launch means nobody found it; a cliff after a release means something broke.
- **GitHub issues** — the real channel. Triage by the `code` in a `--json` payload if the reporter can paste one; that field exists so a bug report can be classified without a back-and-forth.
- **`walkcroach doctor --json`** — ask for this first in any report. It answers "which API, from which config layer, with which credential backend, on which Node" in one paste, and it redacts secrets on the way out.

## 4. Rolling back

A version cannot be reused, and unpublishing is an incident rather than a
workflow. So:

1. **Fix forward.** Bump patch, `npm run test:packaged`, tag `cli-v<version>`.
2. **Deprecate the bad version** so installs warn rather than silently break:
   ```bash
   npm deprecate @walkcroach/cli@<bad-version> "Broken install; use <good-version>"
   ```
3. Only consider `npm unpublish` inside 72 hours, and only for something that
   leaks or destroys data. It breaks anyone who pinned it.

## 5. Watch for a week

- Any report where `doctor` shows `apiBaseUrlSource: "project"` — the trust boundary on project config is new, and a rejected value should have printed a note on stderr.
- Any report of a credential surviving `auth logout` — both backends are cleared, and a miss there is a security bug, not a papercut.
- Any `revert` that destroyed unintended work — `--yes` requires an explicit `--turn` precisely to prevent this; if it happened anyway, the guardrail has a hole.
- Windows path handling in `create` — the name validator refuses reserved device names and separators, but Windows has more edge cases than one test file can hold.

## 6. What would change this document

The first time a user reports something none of the above would have caught,
add the check here rather than remembering it. The absence of telemetry means
this file *is* the monitoring, and it is only as good as the last incident that
was written into it.
