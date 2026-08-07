# Chrome Web Store — permission justifications (PD.3)

Paste these into **Developer Dashboard → Privacy practices → Permissions justification**.
Keep the live `wxt.config.ts` / built manifest in sync; if a permission disappears from the
manifest, remove it from the dashboard before upload.

| Permission | Justification |
|------------|---------------|
| `storage` | Persist device session tokens, workspace selection, and auth source locally so the side panel works across browser restarts without re-prompting on every open. |
| `activeTab` | Read the focused tab immediately after the user invokes WalkCroach from the toolbar, the context menu, or the keyboard shortcut, so the panel can show which page it is on. Cannot serve side-panel button clicks (Chrome does not activate `activeTab` for those), which is why durable page access is granted per site below. |
| `contextMenus` | Two right-click items: "Open WalkCroach for this page", and "Save selection to WalkCroach" (shown only when text is selected). A context-menu click is one of the four gestures Chrome accepts for `activeTab`. The selection item sends **only the highlighted text** — never the rest of the page — and still requires an explicit confirm before anything is stored. |
| `scripting` | Run a one-shot page extract (and optional draft insert) in the focused tab when the user clicks summarize / ask / save / insert. No persistent content scripts are declared. |
| `sidePanel` | Host the main WalkCroach UI in Chrome's Side Panel (primary UX), opened from the toolbar action. |
| `identity` | Complete WalkCroach account sign-in via `chrome.identity.launchWebAuthFlow` against our own hosted login, using the `https://<extension-id>.chromiumapp.org/` redirect. Used only for sign-in; we do not read Chrome profile identity. |
| Host permission for WalkCroach API only (`https://<api-host>/*`, e.g. `https://api.walkcroach.rinegansolutions.com/*`) | Call our HTTPS backends: Chrome BFF (device session, summarize, ask, draft, save, recall) and the public memory API (`/v1/memory/*` via `@walkcroach/sdk`). Production uses one shared host. **Not** used to read arbitrary websites. |
| **Optional** host permissions (`http://*/*`, `https://*/*`) | **Not granted at install** — no install-time warning. WalkCroach requests a *single* site at a time (`https://example.com/*`) from the click that needs it, using `chrome.permissions.request`. The user sees Chrome's own in-context prompt naming that one site, and can revoke each site from the panel's Account tab (`chrome.permissions.remove`). This is the pattern Chrome documents for side panels, which cannot rely on `activeTab`. |

**Why optional and not `<all_urls>`:** a side panel's primary interaction is clicking buttons inside the panel, and Chrome does not grant `activeTab` for those clicks. Rather than request read-and-change-all-data at install, WalkCroach asks per site, in context, at the moment of use.

**Not requested:** install-time `<all_urls>`, `tabs`, declared `content_scripts`, or a persistent injected FAB.

**Keyboard shortcut:** `Alt+Shift+W` is declared via the `commands` manifest key bound to
`_execute_action` (no permission required). It routes through the same handler as the toolbar
click, so there is one code path and one gesture contract.

**Enforced by test:** `chrome/tests/manifest.test.ts` asserts the built manifest's permission
list matches this table exactly, plus no `<all_urls>`, no `tabs`, no `content_scripts`, and a
web-accessible-resource scoped to a single origin. It runs in CI after `npm run build`, so this
document and the shipped zip cannot drift apart silently.

## Remote configuration (site profiles)

WalkCroach fetches a **site-profile bundle** from its own HTTPS API. This is data,
not code: JSON listing which hosts map to which sector action, plus the button
labels. Nothing in it is evaluated, injected, or turned into a script.

Three controls apply:

1. **Signed.** The bundle carries an Ed25519 signature verified in the extension
   against a public key baked into the build. An unsigned or mis-signed bundle is
   discarded. The private key lives in AWS Secrets Manager.
2. **Schema-validated.** Even after the signature verifies, every profile is
   checked field by field and the bundle is rejected whole if any entry is
   malformed. Host suffixes may not contain wildcards, paths, or ports, so a
   bundle cannot widen matching beyond what its label implies.
3. **Fails closed to the package.** Offline, unsigned, malformed, or no key
   configured — all keep the profiles that shipped inside the extension. A remote
   update is never required for the extension to work.

## Remote code

**No.** WalkCroach Chrome does not execute remotely hosted JavaScript.

- Every script in the extension ships inside the package. The page extractor
  (`extractor.js`, Mozilla Readability) is bundled and injected with
  `chrome.scripting.executeScript({ files })` — local code, not remote.
- The site-profile bundle described above is fetched over the network but is
  **signed, schema-validated JSON that is never evaluated**. It changes which
  hosts map to which button label; it cannot introduce behaviour.
- All AI calls go to the WalkCroach HTTPS API; responses are rendered as text,
  never executed.

## Single purpose (dashboard field)

WalkCroach Chrome is a trust-first browser copilot for small-business operators: it summarizes the page you are on, answers questions about it, helps draft short replies, and saves what you choose to remember—without requiring a full automation builder.


## Web accessible resources

`auth.html` is declared web-accessible **only** to the WalkCroach Web origin. Chrome blocks a
navigation from a web origin to an extension resource unless it is listed, which is what broke
the sign-in redirect before v0.2.0. It is a fallback path — the primary sign-in flow uses
`chrome.identity.launchWebAuthFlow`, which needs no web-accessible resource at all.

## Data handling (dashboard field)

Page text is read **only** when the user clicks an explicit action (summarize, ask, draft, save),
**only** on sites they have allowed, and is sent to the WalkCroach API to produce that result.
Opening the side panel uploads nothing. Cached page text lives in `chrome.storage.session`
(cleared on browser close) and is dropped on navigation, tab close, and site revocation.

### Screenshots

WalkCroach can attach a screenshot of the **visible viewport** to a saved capture.
This is worth calling out separately because a screenshot is more revealing than
page text — it includes whatever else happened to be on screen.

- **Never automatic.** It is a per-save opt-in on the confirm card, on an allowed
  site only, and the image is shown back to the user before anything is stored.
- **Only the visible area** is captured, never the full scrollable page, and never
  another tab.
- Stored in a private, encrypted S3 bucket, namespaced per account. Nothing is
  public; viewing goes through a short-lived signed URL issued only after an
  ownership check.
- Deleted with the capture, and expired automatically by bucket lifecycle
  (90 days by default).

`tabs.captureVisibleTab` requires no additional manifest permission — it is
covered by the same per-site access the user already granted for reading the page.
