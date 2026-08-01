# Versioning (PD.5)

WalkCroach Chrome uses **semver** in `package.json` → WXT embeds it in the extension manifest.

| Bump | When |
|------|------|
| **MAJOR** | Breaking permission changes, storage schema wipe, or incompatible API |
| **MINOR** | New user-facing features (e.g. sector actions, project link) |
| **PATCH** | Fixes, copy, store-asset-only updates |

## Rules

1. Bump version **before** every Chrome Web Store upload (same version cannot be re-uploaded).
2. Record changes in `CHANGELOG.md`.
3. CI zip artifact must match the version you submit.
4. Production builds must set `WALKCROACH_API_BASE` to the live API stage URL (never localhost).
5. Use `npm run zip:prod` for store uploads (fail-closed HTTPS bake + localhost scan).

**Current store line: `0.6.0`** — approved and live 2026-08-01. (PKCE sign-in, plus everything from 0.2.0–0.5.3 that never reached the store).

> Keep this line honest. It read `0.4.0` while the store served `0.1.5` and the
> submission checklist said `0.5.3` — three different claims, none of them the
> truth. If you are unsure, the store dashboard is the only source that counts.

---

## Extension ID (Phase A5)

Every sign-in redirect URI is derived from the extension ID:

| Flow | Redirect URI |
|------|--------------|
| `chrome.identity.launchWebAuthFlow` (preferred) | `https://<id>.chromiumapp.org/auth` |
| Legacy tab redirect (fallback) | `chrome-extension://<id>/auth.html` |

The Chrome BFF (`lambda-chrome/.../handlers/oauth.ts` → `CHROME_REDIRECT_PATTERN`) and
WalkCroach Web (`ConnectChromePage.tsx` → `REDIRECT_PATTERN`) both bind to a 32-character
`[a-p]` ID. **All three must agree.**

### Why pinning matters

An **unpacked** extension derives its ID from its absolute install path. Load the same
checkout from a different folder — or a teammate's machine — and the ID changes, so the
redirect URI changes, and sign-in fails with an opaque `redirectUri is not allowed`.

### Local / dev: pin with `key`

```bash
node scripts/extension-id.mjs --generate
# copy the printed WALKCROACH_EXTENSION_KEY into your local .env / shell
```

`wxt.config.ts` injects `WALKCROACH_EXTENSION_KEY` into the manifest as `"key"`, which
fixes the ID across reloads and machines. Verify at any time:

```bash
node scripts/extension-id.mjs           # reads WALKCROACH_EXTENSION_KEY
node scripts/extension-id.mjs <key>     # for a specific key
```

Keep the dev key out of git. Everyone can use their own — the redirect allowlists are
pattern-based, not ID-specific.

### Packed / Chrome Web Store

The store holds the key for a published listing and assigns the ID from it, so a store
build must **not** carry a local `key`. `wxt.config.ts` fails the build if
`WALKCROACH_EXTENSION_KEY` is set while `WALKCROACH_REQUIRE_PROD_ENV=true`.

Procedure:

1. First upload → CWS assigns the permanent ID (visible in the dashboard URL and item page).
2. Record it in `enterprise/policies.json` (replaces `EXTENSION_ID_REPLACE_ME`) and in
   `store/SUBMISSION_CHECKLIST.md`.
3. Confirm it matches `[a-p]{32}` — the allowlists reject anything else.
4. To test the exact store artifact locally before upload, load the unpacked build with the
   **same** key the store issued (Dashboard → Package → *View public key*), so the ID matches
   production.

---

## Pre-upload verification (Phase A6)

Three layers. Run them in order; the first two are automated.

### 1. Built-artifact invariants (automated)

```bash
npm run build && npm run test:manifest
npm test          # includes the token contrast suite (WCAG AA, both modes)
```

Asserts the *shipped* manifest against the model `store/PERMISSION_JUSTIFICATIONS.md` claims:
no `<all_urls>`, no `tabs`, no `content_scripts`, `optional_host_permissions` exactly the two
http(s) wildcards, exactly one install-time host, `auth.html` web-accessible to one origin,
`extractor.js` present and *not* web-accessible, no `default_popup` (which would swallow the
action click and its `activeTab` grant), and version parity with `package.json`. Wired into
`buildspec.yml` after `build`, so a store zip cannot drift from the store packet.

### 2. Real-Chrome pipeline (automated)

```bash
cd ../tests && npm run test:e2e:chrome:fixture
```

Loads the extension in real Chrome and verifies `extractor.js` returns Readability content from
a live page (nav and footer stripped), the session cache round-trips and is keyed per tab,
injection is genuinely impossible on `chrome://` pages, and the install-time API host cannot be
revoked.

This builds a **fixture** variant with a local origin pre-granted, because Chrome's permission
prompt is native UI Playwright cannot click. That artifact must never be uploaded — rerun
`npm run build` in `chrome/` to clear the pre-grant before packaging.

### 3. Manual gate (two steps that cannot be automated)

Run against the **zip**, not the dev server:

```bash
npm run zip:prod
# unzip to a scratch folder, then chrome://extensions → Load unpacked
```

| # | Check | Expected |
|---|-------|----------|
| 1 | Open the panel on a fresh `https://` site, click **Summarize** | Chrome's own prompt names that one site; allow it and a summary streams. Second page on the same site: no prompt. A different site: prompt again, for that site only. Then **Account** lists both, and **Revoke** re-gates one. |
| 2 | **Sign in with WalkCroach** | Cognito pages open; success returns a signed-in session with no `ERR_BLOCKED_BY_CLIENT`. Cancelling shows "Sign-in cancelled." and leaves the panel usable. |

Both are unautomatable for the same reason: step 1 is a native browser dialog, step 2 needs a
live Cognito account. Everything else they used to cover is now in layers 1 and 2.

Also confirm once per machine: the toolbar click **toggles** the panel (open, then closed), and
the extension ID is unchanged after a reload (`node scripts/extension-id.mjs`).

Record the result in `store/SUBMISSION_CHECKLIST.md` before uploading.
