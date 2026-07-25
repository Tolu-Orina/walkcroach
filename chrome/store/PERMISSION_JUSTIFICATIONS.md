# Chrome Web Store — permission justifications (PD.3)

Paste these into **Developer Dashboard → Privacy practices → Permissions justification**.
Keep the live `wxt.config.ts` / built manifest in sync; if a permission disappears from the
manifest, remove it from the dashboard before upload.

| Permission | Justification |
|------------|---------------|
| `storage` | Persist device session tokens, workspace selection, and auth source locally so the side panel works across browser restarts without re-prompting on every open. |
| `activeTab` | Read the currently focused tab only after the user opens WalkCroach from the toolbar so we can extract the page they asked about—no broad always-on tab or page-host access. |
| `scripting` | Run a one-shot page extract (and optional draft insert) in the active tab via `scripting.executeScript` when the user requests summarize/save/insert. |
| `sidePanel` | Host the main WalkCroach UI in Chrome’s Side Panel (primary UX), opened from the toolbar action. |
| Host permission for WalkCroach API only (`https://<api-host>/*`, e.g. `https://awbcf4clij.execute-api.eu-west-2.amazonaws.com/*`) | Call our HTTPS Chrome backend (device session, summarize, ask, draft, save, recall). **Not** used to read arbitrary websites. Page reading uses `activeTab` + `scripting` after a toolbar gesture. |

**Not requested:** `https://*/*`, `http://*/*`, `<all_urls>`, or content scripts. We do not inject a persistent FAB or grant site-wide browsing access.

## Remote code

**No.** WalkCroach Chrome does not execute remotely hosted JavaScript. Site profiles are bundled JSON. All AI calls go to the WalkCroach HTTPS API; responses are data, not executable code.

## Single purpose (dashboard field)

WalkCroach Chrome is a trust-first browser copilot for small-business operators: it summarizes the page you are on, answers questions about it, helps draft short replies, and saves what you choose to remember—without requiring a full automation builder.
