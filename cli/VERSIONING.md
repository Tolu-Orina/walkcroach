# Versioning and release — `@walkcroach/cli`

Semver, with the discipline already proven in `chrome/VERSIONING.md`. The
difference that matters: the Chrome Web Store rejects a repeated version, and
**npm refuses to republish one at all** — a version is immutable once it exists.

**Current line: `0.2.0`** (Phase C0 guardrails + C1 ergonomic parity + C2 packaging).
Nothing has been published yet.

---

## What counts as which bump

The CLI's public surface is wider than its code: a script that calls it depends
on command names, flag spellings, the `--json` envelope, and the exit codes.
`src/surface.test.ts` pins all four, so the version question is usually
"did that test need editing, and why".

| Bump | When |
|---|---|
| **MAJOR** | A command or flag is removed or renamed; an exit code changes meaning; the `--json` envelope drops or renames a field; the minimum Node version rises |
| **MINOR** | A new command or flag; a new field in a `--json` payload; a new config key; behaviour that changes only what humans read |
| **PATCH** | Fixes and docs that leave the surface identical |

Pre-1.0 that mapping is applied one step down in practice — a breaking change
lands as a MINOR bump — but the classification above is what gets recorded in
`CHANGELOG.md`, so 1.0 does not have to reconstruct it later.

Two rules from clig.dev, restated because they are what make the table
enforceable:

- **Keep changes additive.** Adding a flag is cheap; renaming one breaks a
  script silently, in a build someone else owns.
- **Warn before a non-additive change.** A deprecation ships at least one
  MINOR before the removal, and prints to stderr when the old spelling is used.

## Release checklist

```bash
cd packages/agent-engine && npm ci && npm run build   # the CLI bundles this
cd ../../cli
npm ci
npm run typecheck
npm test
npm run build
npm run test:packaged        # packs, installs the tarball outside the repo, runs it
```

Then:

1. Move the `[Unreleased]` section of `CHANGELOG.md` under the new version with
   today's date. Anything breaking-for-scripts goes at the top of it. Commit it.
2. Release:

   ```bash
   npm version minor        # or patch / major — bumps, commits and tags
   git push --follow-tags
   ```

`.npmrc` sets `tag-version-prefix=cli-v`, so `npm version` produces the
`cli-v<version>` tag the workflow triggers on, and the tag can never disagree
with `package.json` because one command wrote both. `npm version` also refuses
to run on a dirty tree, which is why step 1 commits first.

`.github/workflows/publish-cli.yml` then re-runs every gate and publishes.

**Pre-1.0 reminder:** a breaking change is a *minor* bump, so `npm version minor`
is the usual one — see the mapping above.

To verify without releasing, run the workflow manually from the Actions tab with
`dry_run: true`. Note that a manual run can only ever dry-run: the publish step
is gated on the ref being a tag, deliberately, so the published version always
traces to a tagged commit and its provenance attestation reconciles.

## How publishing is authenticated

npm trusted publishing over OIDC: no long-lived token exists to leak, and
provenance attestations are emitted automatically.

**Why the publish step is a GitHub Actions workflow when everything else in
this repo is CodePipeline/CodeBuild:** npm accepts OIDC identities from GitHub
Actions and GitLab CI. CodeBuild is not a recognised issuer, so publishing from
it would mean storing a long-lived npm automation token — exactly the
credential trusted publishing exists to remove. CodeBuild still builds and
tests (`cli/buildspec.yml`) and leaves the tarball as an artifact.

**If the workflow is not available yet**, ship the tarball from the CodeBuild
artifact instead:

```bash
npm install -g ./walkcroach-cli-<version>.tgz
```

The verification gate is identical either way — `npm run test:packaged` is what
proves the artifact works, regardless of how it reaches people.

## Things that will bite

- **A version cannot be reused.** A broken publish is fixed by a new PATCH, not
  by unpublishing. (npm allows unpublish within 72 hours; treat it as an
  incident, not a workflow.)
- **`prepack` builds automatically.** `npm pack` and `npm publish` both rebuild
  `dist/`, so a stale bundle cannot ship — but it also means packing runs
  esbuild, which is why `test-packaged.mjs` passes `--ignore-scripts` when it
  only wants a file listing.
- **The engine must be built first.** `@walkcroach/agent-engine` is a `file:`
  devDependency that gets bundled into `dist/bin.js`. If its `dist/` is stale,
  the CLI ships stale engine code with no error anywhere.
- **`@napi-rs/keyring` is optional on purpose.** A platform with no prebuilt
  binary must still install and run, on the file credential backend.
  `test:packaged` asserts exactly that.
