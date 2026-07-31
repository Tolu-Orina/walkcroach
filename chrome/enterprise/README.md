# Managed deployment (Chrome Enterprise)

`policies.json` is a **sample**, not a drop-in. Read this first — the previous
version of that file contained two settings that would have caused real damage in
a fleet.

## Two corrections from the earlier sample

**1. It blocked every other extension.** The old file set
`ExtensionSettings["*"].installation_mode = "blocked"`, which is an org-wide
default, not a WalkCroach setting. An administrator pasting it would have disabled
every other extension their users had. If you *want* an allowlist-only fleet, that
is a deliberate org policy decision to make separately — it does not belong in a
vendor's sample.

**2. `runtime_allowed_hosts` was set to the backend domains, which breaks the
product.** That setting is an allowlist of hosts the extension may *interact
with*. The old file listed only the WalkCroach API and website, which would have
prevented WalkCroach from reading any page a user allowed — every action would
fail with no obvious cause. Both host lists now ship empty, which is the correct
default.

## Prerequisite

The extension ID is assigned by the Chrome Web Store on first publish. Until then
`EXTENSION_ID_REPLACE_ME` is a placeholder and this policy cannot be applied.
Confirm the ID with `npm run extension-id` against the key the store issues
(Dashboard → Package → *View public key*); it must match `[a-p]{32}`.

## Applying it

| Platform | Where |
|---|---|
| Google Admin console | Devices → Chrome → Apps & extensions → Users & browsers → *Add from Chrome Web Store*, then paste the JSON under **Additional settings** |
| Windows | `HKLM\SOFTWARE\Policies\Google\Chrome` — `ExtensionInstallForcelist` and `ExtensionSettings` |
| macOS | `com.google.Chrome` configuration profile with the same keys |
| Linux | `/etc/opt/chrome/policies/managed/walkcroach.json` |

Verify on a managed device at `chrome://policy` — the entries should show
*Status: OK*, and the extension appears already installed and pinned.

## Bounding page access

WalkCroach requests page permission one site at a time, and the user can withdraw
any of them from the panel's Account tab. If your organisation needs a harder
boundary:

- **`runtime_blocked_hosts`** is the safer instrument. It takes precedence over
  everything else, so listing an internal domain there guarantees WalkCroach can
  never read it regardless of what the user allows. Blocking a host the user has
  already granted takes effect immediately.
- **`runtime_allowed_hosts`** turns the model inside out: once non-empty, the
  extension may interact *only* with the hosts listed. Use it only if you intend
  WalkCroach to work on a fixed set of internal tools and nowhere else, and expect
  support questions when it silently does nothing elsewhere.

Example — allow everything except two internal domains:

```json
"runtime_blocked_hosts": ["*://*.payroll.internal", "*://*.hr.example.com"]
```

## What a managed install does not change

- Page content is still only read when the user clicks an action.
- Screenshots are still opt-in per save.
- Connector accounts are still connected per user on WalkCroach Web; there is no
  org-wide connector grant, and an administrator cannot connect a mailbox on a
  user's behalf.
- Sign-in remains optional; the extension works on a device session alone.

## Data residency

The backend runs in `eu-west-2`. Page text sent for an action, saved captures and
opt-in screenshots are stored there. Screenshots expire automatically after 90
days (`screenshot_retention_days` in the Terraform module) and are deleted with
their capture.
