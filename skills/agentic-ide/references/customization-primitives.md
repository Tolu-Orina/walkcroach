# Customization Primitives

> How to actually change things, ordered by the escalation ladder. Snapshot as of recent releases — verify at your pin (`code-oss-map.md` §7).

## Contents
1. Rung 1 — extension API
2. Rung 2 — webviews
3. Rung 3 — workbench contributions
4. `product.json`
5. Theming and styling
6. Built-in extensions
7. Escape hatches
8. What you cannot do

---

## 1. Rung 1 — extension API (`package.json` contribution points)

Declarative, zero merge tax, works in stock VS Code. The main ones:

| Contribution point | Adds |
|---|---|
| `commands` | Command palette entries and invocable commands |
| `menus` | Items in context menus, editor title, view title, command palette |
| `keybindings` | Shortcuts, with `when` clause context |
| `views` / `viewsContainers` | Sidebar and panel views; a container is an activity-bar entry |
| `viewsWelcome` | Empty-state content in a view |
| `configuration` | Settings, with types, defaults, descriptions |
| `themes` / `iconThemes` / `productIconThemes` | Colour and icon theming |
| `languages` / `grammars` / `snippets` | Language support |
| `walkthroughs` | Onboarding flows |
| `customEditors` | Editors for non-text file types |
| `terminal` | Terminal profiles |
| `authentication` | Auth providers |
| `statusBarItems` | Status bar entries (also available imperatively) |

**`when` clauses are the underused primitive.** Context keys (`editorTextFocus`, `resourceExtname`, `view == myView`, plus custom keys you set via `setContext`) let menus, keybindings and views appear only when relevant. Most "the UI is cluttered" complaints in extensions are unset `when` clauses.

**Activation events** matter for startup performance: prefer specific activation (`onCommand`, `onLanguage`, `onView`) over `*`. A slow-activating extension is visible to users.

## 2. Rung 2 — webviews

Where custom UI lives without forking. Two forms:

- **`WebviewPanel`** — a webview in the editor area, like a document.
- **`WebviewView`** — a webview inside a sidebar or panel view. This is what Cline, Continue and the WalkCroach IDE extension use for their agent panels.

Key mechanics:

- **Message passing** — `postMessage` both directions; the webview and extension host are separate contexts. Keep the protocol thin and versioned; put logic on the extension side, not in the webview.
- **`retainContextWhenHidden`** — keeps state when hidden, at a memory cost. Prefer serialising state and restoring, unless the UI is genuinely expensive to rebuild.
- **CSP is enforced.** Resources need `asWebviewUri`; inline scripts need a nonce.
- **Theming** — VS Code injects `--vscode-*` CSS custom properties and a `vscode-light`/`vscode-dark`/`vscode-high-contrast` body class. Bind to those and the webview follows the user's theme for free. Hardcoding colours here is the single most common way a webview looks wrong for half the userbase.
- **Any web stack works** — React, Tailwind, whatever. This is the significant advantage over rung 3.

## 3. Rung 3 — workbench contributions

Requires a fork. In exchange: direct service access, native UI, no RPC hop, no API ceiling.

**Registering a view:** contribute a `ViewContainer` and `ViewDescriptor` through the views registry, then implement a `ViewPane` subclass. `renderBody(container: HTMLElement)` hands you a DOM node — what you render into it is your choice (see §7 on mounting a framework there).

**Registering a workbench contribution:** implement `IWorkbenchContribution` and register against a lifecycle phase (`Starting`, `Ready`, `Restored`, `Eventually`). Choosing a late phase for non-critical work is the difference between a fork that starts fast and one that doesn't.

**Registering a service:** define the interface with a decorator, implement it, register with the right instantiation semantics, and add it to the appropriate `workbench.*.main.ts`.

**Commands, actions, menus** have registry-based equivalents (`CommandsRegistry`, `MenuRegistry`, `registerAction2`) — richer than the declarative extension versions and available synchronously.

**Styling** is a plain stylesheet, and this is where the trap is: the build enforces a **CSS custom-property allowlist** (`build/lib/stylelint/`). Introducing new `--custom-name` properties fails validation — WalkCroach hit exactly this and produced 148 errors from eight new properties. The working pattern is to bind to `--vscode-*` with a literal hex fallback, keeping brand values as fallbacks rather than new named properties.

## 4. `product.json`

The branding and capability layer, and the reason a clean fork is mechanically simple.

Fields that matter: `nameShort` / `nameLong` / `applicationName`, `dataFolderName` (where user data lives — change it or you collide with real VS Code), `urlProtocol` (deep links), icons, `extensionsGallery` (registry endpoints — Open VSX for a fork), `extensionAllowedProposedApi`, `builtInExtensions`, telemetry endpoints (remove them), `linkProtectionTrustedDomains`, `documentationUrl`/`reportIssueUrl`, and update endpoints.

VSCodium's build is the clearest public reference for how a rebrand is done end to end — it patches `product.json` over an otherwise-unmodified Code OSS tree.

## 5. Theming and styling

Three layers, in order of preference:

1. **Colour theme** (`themes` contribution) — a JSON of `colors` (workbench UI, keyed by `editor.background`-style tokens) and `tokenColors`/`semanticTokenColors` (syntax). No code, no fork, and it's what users expect to be able to override.
2. **Product icon theme** — replaces the codicon set globally.
3. **CSS in a contribution** — only for genuinely new UI, subject to the allowlist constraint in §3.

**Set `defaultColorTheme` in `product.json`** so a fork opens with its own theme rather than Dark+.

**Codicons** are the built-in icon font. A fork should use them rather than importing a second icon library — mixing icon systems is immediately visible and hard to unpick later.

## 6. Built-in extensions

`extensions/` contains real extensions shipped in the box (git, language features, emmet, markdown). For a fork:

- **Removing** built-ins reduces size and attack surface — but removing git or language features is user-visible in a bad way.
- **Adding** your own as a built-in is the cleanest way to ship functionality that *could* be an extension: zero merge tax, but installed by default.
- **This is the most under-used fork technique.** A large amount of what teams patch into core could ship as a bundled built-in extension instead, at a fraction of the maintenance cost. Ask this before every rung-3+ change.

## 7. Escape hatches

- **Mounting a framework in a `ViewPane`** — `renderBody` gives a plain `HTMLElement`, and `ReactDOM.createRoot(el).render(...)` is a generic DOM call that doesn't care how the element was created. Components then sit in the same document as the workbench and inherit `--vscode-*` variables with no theme bridge. **No public precedent for this pattern exists** — every "React in VS Code" resource means React in a webview, because that's all extension authors can do. Viable in principle for a fork; treat as unproven until spiked. Note the CSS allowlist (§3) constrains Tailwind, whose generated output leans heavily on custom properties.
- **Proposed APIs** — unstable APIs usable by allowlisted extensions via `extensionAllowedProposedApi`. Fine for a bundled built-in you control; they change without notice.
- **`--enable-proposed-api` and CLI flags** for development.
- **Context keys** (`setContext`) to drive `when` clauses from runtime state — the cheapest way to make UI conditional.
- **Custom `IWorkbenchContribution` at `Eventually` phase** for background work that shouldn't touch startup time.

## 8. What you cannot do

Knowing the walls saves time:

- **You cannot ship Microsoft's proprietary extensions** in a fork — Live Share, Remote Development (SSH/Containers/WSL), C/C++ Tools, Pylance, C# DevKit are licensed to official builds. There is no compliant workaround; document the gap and suggest open alternatives.
- **You cannot proxy the Marketplace.** Enforced, and it has been enforced.
- **You cannot override an extension's system prompt or agent-mode behaviour** from outside it — this is what forced the WalkCroach IDE extension onto a custom webview rather than the Chat Participant API.
- **You cannot rely on third-party agent providers appearing in first-party pickers.** Upstream currently scopes the Agents window to specific providers; third parties are directed to the main window. Build your own client surface.
- **You cannot avoid the merge tax** at rung 3+. You can only contain it.