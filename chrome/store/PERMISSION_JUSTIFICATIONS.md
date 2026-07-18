# Chrome Web Store — permission justifications (PD.3)

Paste these into **Developer Dashboard → Privacy practices → Permissions justification**.
Keep the live `wxt.config.ts` / built manifest in sync; if a permission disappears from the
manifest, remove it from the dashboard before upload.

| Permission | Justification |
|------------|---------------|
| `storage` | Persist device session tokens, workspace selection, and auth source locally so the side panel works across browser restarts without re-prompting on every open. |
| `activeTab` | Read the currently focused tab only after the user clicks WalkCroach (FAB / action / summarize / save) so we can extract the page they asked about—no broad always-on tab access. |
| `scripting` | Inject a minimal extractor (Readability) into the active tab when the user requests summarize/save, because MV3 requires `scripting`/`executeScript` for that one-shot path. |
| `sidePanel` | Host the main WalkCroach UI in Chrome’s Side Panel (primary UX), opened from the FAB or toolbar action. |
| Optional host permissions `https://*/*` and `http://*/*` | **Not granted at install.** Requested just-in-time for a single origin the first time the user summarizes or saves on that site, so extract/save works on that origin until they revoke it in the Trust panel. |

## Remote code

**No.** WalkCroach Chrome does not execute remotely hosted JavaScript. Site profiles are bundled JSON. All AI calls go to the WalkCroach HTTPS API; responses are data, not executable code.

## Single purpose (dashboard field)

WalkCroach Chrome is a trust-first browser copilot for small-business operators: it summarizes the page you are on, answers questions about it, helps draft short replies, and saves what you choose to remember—without requiring a full automation builder.
