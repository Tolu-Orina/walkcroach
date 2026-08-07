# Chrome Web Store submission checklist — v0.6.1

Supersedes the v0.1.4 checklist, which described a CORS hotfix and predates the
permission model, the redesign, and connectors.

Production endpoints (never substitute localhost):

| Item | Value |
|------|-------|
| API | `https://api.walkcroach.rinegansolutions.com/v1` |
| Privacy | `https://walkcroach.rinegansolutions.com/chrome-privacy.html` |
| Product | `https://walkcroach.rinegansolutions.com` |
| Extension version | `0.6.1` |
| Extension ID | _already assigned — the listing has been live since 0.1.5. Read it from the dashboard URL and store it as the `EXTENSION_ID` secret in the `cws-publish` environment._ |

---

## 1. Claim gating — read before writing listing copy

The plan's rule is that **store claims lag reality**. Three features are complete
in the package but not user-reachable in production. Do not describe them in the
listing until the right-hand condition is met.

| Feature | State | Reachable when |
|---|---|---|
| Connectors (Calendar, Gmail, Slack, Stripe) | Code complete, **inert** | A Google OAuth app exists and `GOOGLE_OAUTH_CLIENT_ID/SECRET` are in the runtime secret. `configuredProviders()` hides every provider until then. |
| Remote site profiles | Code complete, **inert** | `WALKCROACH_PROFILES_PUBLIC_KEY` is baked and the bundle signed (`npm run sign-profiles`). Falls back to packaged profiles otherwise. |
| Screenshot upload via presigned PUT | Works, **falls back** | Bucket CORS names the published extension ID. Until then uploads take the slower path through Lambda. |

Everything else in the listing — summarize, ask, draft, save, selection capture,
recall, price tracking, sector actions, per-site access, sign-in — ships live.

---

## 2. Automated gates

Run in order. All must be green.

```bash
cd chrome
npm run typecheck
npm test                 # unit + component + token-contrast
npm run build
npm run test:manifest    # assertions against the BUILT manifest

cd ../tests
npm run test:e2e:chrome:fixture   # real Chrome

cd ../chrome
npm run build            # MUST rerun: clears the e2e fixture's pre-granted origin
```

`test:manifest` is what protects this document: it asserts the shipped manifest
matches what `PERMISSION_JUSTIFICATIONS.md` claims — no `<all_urls>`, no `tabs`,
no `content_scripts`, exactly one install-time host, `auth.html` web-accessible to
a single origin, and version parity with `package.json`.

- [ ] `npm test` green
- [ ] `npm run test:manifest` green **after** a clean build
- [ ] e2e green, then rebuilt without `WALKCROACH_TEST_GRANT_ORIGINS`
- [ ] `npm run zip:prod` succeeds (fail-closed HTTPS bake + localhost scan)

---

## 3. Manual gate

Two things no test can cover: Chrome's permission prompt is native browser UI, and
sign-in needs a real Cognito account. Run against the **zip**, not the dev server.

- [ ] Fresh `https://` site → **Summarize** → Chrome's own prompt names that one
      site → allow → summary streams
- [ ] Second page, same site → no prompt. Different site → prompt again, that
      site only
- [ ] **Account** → both sites listed → **Revoke** one → that site gates again
- [ ] **Sign in with WalkCroach** → Cognito → returns signed in, no
      `ERR_BLOCKED_BY_CLIENT`. Cancel → "Sign-in cancelled.", panel still usable
- [ ] Toolbar click **toggles** the panel open, then closed
- [ ] Right-click selected text → **Save selection** → confirm card shows the
      highlighted words → save
- [ ] `chrome://settings` → actions disabled with the restricted-page notice
- [ ] Extension ID unchanged after reload (`npm run extension-id`)

---

## 4. Deploy prerequisites

The extension calls a live backend. These must ship **before** the store build is
uploaded, or first run fails for every new installer.

- [ ] Chrome Lambda redeployed (`npm run package:lambda:chrome`) — carries the
      connectors, screenshots, credits and site-profiles routes
- [ ] Migration `020_connectors.sql` applied (`npm run migrate`)
- [ ] Web privacy page live at the URL above
- [ ] `WEB_APP_URL` set on the Chrome Lambda (connector deep-link and sign-in)
- [ ] Captures bucket exists and `CAPTURES_BUCKET` is set

---

## 5. Dashboard fields

- [ ] Permissions justification: paste `PERMISSION_JUSTIFICATIONS.md` in full,
      including `optional_host_permissions`, `identity` and `contextMenus`
- [ ] Remote code: **No** — see that file's Remote code section; the signed
      site-profile bundle is data and is never evaluated
- [ ] Data handling: page text only on explicit action; screenshots opt-in per
      save. Both are written out in `PERMISSION_JUSTIFICATIONS.md`
- [ ] Single purpose: the wording in `STORE_LISTING.md`
- [ ] Screenshots: 5 current captures from `store/screenshots/`; regenerate with
      `npm run screenshots` if the UI changed since the last upload
- [ ] Package: the `0.5.3` zip from `npm run zip:prod`

---

## 6. After upload

- [ ] Record the assigned extension ID in `enterprise/policies.json` and in the
      table at the top of this file
- [ ] Add `chrome-extension://<id>` to the captures bucket CORS
      (`extension_origins` in Terraform) so presigned upload starts working
- [ ] Watch the sign-in success ratio for 48h
      (`POST_SUBMIT_MONITORING.md`) — it is the Bug B regression detector
- [ ] Bump `package.json` before any resubmission; CWS rejects a repeated version
