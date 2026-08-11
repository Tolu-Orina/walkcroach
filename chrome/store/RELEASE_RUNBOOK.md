# Release runbook — what a person still has to do

Phase F's remaining items cannot be completed from this repository. This file says
exactly what is left, why, and in what order, so nothing is discovered late.

## F3 — Upload to the Chrome Web Store

**Blocked on a human.** Publishing needs a Chrome Web Store developer account (a
one-off registration fee), acceptance of the developer agreement, and interactive
use of the dashboard. None of it is scriptable, and nothing in this repo can do it.

Order matters, because the first upload is what mints the extension ID that three
other things depend on.

1. **Deploy the backend first.** `SUBMISSION_CHECKLIST.md` §4. A store build that
   points at an undeployed API fails for every new installer, and review can
   happen faster than a redeploy.
2. Run the automated gates (§2) and the manual gate (§3) against the zip.
3. `npm run zip:prod`, upload, fill the dashboard fields (§5).
4. **Record the assigned extension ID.** Then, in order:
   - `enterprise/policies.json` — replaces `EXTENSION_ID_REPLACE_ME`
   - Terraform `chrome_extension_id` in `environments/*.tfvars` — captures CORS +
     Chrome Lambda `CHROME_EXTENSION_IDS`
   - The ID table at the top of `SUBMISSION_CHECKLIST.md`
5. Review typically takes days, not hours. If it is rejected, the reasons are
   almost always the permission justifications or the data-handling disclosure —
   both live in `PERMISSION_JUSTIFICATIONS.md`, which `npm run test:manifest`
   keeps aligned with the shipped manifest.

### If review asks about…

| Question | Answer, and where it is written down |
|---|---|
| Why optional host permissions? | A side panel cannot use `activeTab` — Chrome does not activate it for clicks inside the panel. Per-site is the narrowest model that works. `PERMISSION_JUSTIFICATIONS.md`. |
| Is the site-profile fetch remote code? | No. Signed, schema-validated JSON describing match patterns and labels; never evaluated. Same file, *Remote code*. |
| What does the screenshot capture? | The visible viewport only, opt-in per save, on an allowed site, shown to the user before storage. Same file, *Screenshots*. |
| Why `identity`? | `launchWebAuthFlow` against our own hosted login only. We do not read Chrome profile identity. |

## F6 — Platform Ops Portal

**Blocked on something that does not exist.** Master plan §9 describes a
cross-surface ops portal; there is no such service in this repo, so there is
nothing to wire Chrome into. `POST_SUBMIT_MONITORING.md` documents the CloudWatch
metrics and alarms Chrome emits today, which is what a portal would consume when
one is built. Deferring is the honest state, not an oversight.

## Listing video

`STORE_LISTING.md` notes the 30s walkthrough the plan asks for is not produced.
Screen recording with narration needs a person. The five screenshots in
`store/screenshots/` cover the same beats in the same order and are generated from
the real build, so they are a reliable storyboard.

## Regenerating screenshots

```bash
cd chrome && npm run build && npm run screenshots
```

They render the **actual built extension**, not a mock, so they cannot drift from
the shipped UI. Rerun after any panel change. The script exits non-zero if a
capture comes out suspiciously small, which is what an empty panel looks like when
the stubs have drifted.
