# Code OSS / VS Code Codebase Map

> **Snapshot warning.** Paths, APIs and commands below were accurate for recent releases (roughly 1.13x, mid-2026). VS Code ships monthly. Treat everything here as *where to look*, not as a contract — §7 gives the verification method.

## Contents
1. The layers
2. Target environments
3. `vs/workbench/contrib` — the rules
4. Services and dependency injection
5. The multi-process model
6. Where things actually live
7. Verifying against current source

---

## 1. The layers

Partitioned, strictly ordered — **nothing may import from a higher layer**:

| Layer | Contains | Rule |
|---|---|---|
| `vs/base` | General utilities and UI building blocks | Depends on nothing above |
| `vs/platform` | DI support and base services shared across layers | No editor- or workbench-specific code |
| `vs/editor` | Monaco Editor Core | Standalone; full Monaco lives in a separate repo |
| `vs/workbench` | Hosts Monaco, notebooks, custom editors; the framework for Explorer, Status Bar, panels. Electron for desktop, browser APIs for web | The bulk of the product |
| `vs/code` | Desktop entry point that stitches everything together | Top of the stack |
| `vs/sessions` | **Agent sessions window — a dedicated workbench layer for agentic workflows.** Sits alongside `vs/workbench`, may import from it but **not vice versa** | Directly relevant to Desktop's Agent Host work |

`vs/sessions` is the layer most teams building agentic editors don't know exists. **WalkCroach Desktop Path B deliberately does not productise `vs/sessions` as the primary multi-agent UX** — it uses `contrib/walkcroach` Agents Window + fleet instead. Still know where `vs/sessions` lives at your pin: upstream changes there can collide with Agent Host, and a future ADR might reverse Path B. Until then, do not "migrate to sessions" as an unexamined cleanup.

**Enforcement**: `npm run valid-layers-check`. Layering violations compile fine and fail review — run the check, don't reason about it.

## 2. Target environments

Inside each layer, code is organised by runtime so only valid APIs are used:

| Folder | Runtime | May use |
|---|---|---|
| `common/` | Any | Basic JS only |
| `browser/` | Renderer | `common` + DOM |
| `node/` | Node process | `common` + Node APIs |
| `electron-browser/` / `electron-sandbox/` | Renderer with Electron | `common`, `browser`, sandboxed Electron |
| `electron-main/` | Main process | `common`, `node`, full Electron |
| `test/` | Tests | — |

Putting a Node import in `common/` is one of the most common early fork mistakes. The folder *is* the constraint.

## 3. `vs/workbench/contrib` — the rules

Most feature code belongs here. The rules are strict and exist to keep contributions independently maintainable:

- **Nothing outside `contrib` may depend into `contrib`.** One-way only.
- **Each contribution exposes its internal API from exactly one file** — e.g. `vs/workbench/contrib/search/common/search.ts`.
- **A contribution may depend on another's single API file** — the git contribution may import `search/common/search.ts`.
- **A contribution must never reach into another's internals.** "Internal" is anything not in that one API file.
- **Think twice before any contribution-to-contribution dependency.** Can it go through a service instead?

**For a fork, this is the most valuable rule in the codebase**: WalkCroach's own code as a self-contained contribution with one API file gives the smallest possible merge surface. Scattered edits across upstream files are what make forks unmergeable.

Also note the distinction:
- `vs/workbench/services/` — core workbench services, shared. Should *not* hold services used only by one contribution.
- `vs/workbench/api/` — the provider of `vscode.d.ts` (both extension-host and workbench sides).

## 4. Services and dependency injection

VS Code uses a **custom DI system**, not a third-party container.

- Services are identified by a **decorator** matching the interface name — `IFileService`, `ITextModelService`, `ISearchService`, `ITerminalService`, `IEditorService`, `IConfigurationService`, `IStorageService`, `INotificationService`, `IThemeService`.
- Registration and wiring is visible in `src/vs/workbench/workbench.common.main.ts` (plus `.web.main.ts` / `.desktop.main.ts` variants) — **this file is the map of what services exist**. Reading it is the fastest way to learn what's available.
- Injection is by constructor parameter decoration.
- Services have declared lifecycle/instantiation semantics; some are eager, most are lazy.

**Practical consequence for a fork**: the reason a workbench contribution is so much more capable than an extension is direct, synchronous access to these services — no RPC hop, no serialisation, no API surface limitation. That capability *is* the justification for rung 3 in the escalation ladder. If a feature doesn't need a service the extension API can't reach, it doesn't need the fork.

## 5. The multi-process model

| Process | Role |
|---|---|
| **Main** (Electron) | App lifecycle, windows, native menus, IPC hub |
| **Renderer** | The workbench UI, Monaco, contributions |
| **Extension host** | Runs extensions, isolated from the UI thread |
| **Shared / utility** | Background work (search, file watching) |

Extension host communication is **RPC over IPC**, with `MainThread*` counterparts in the renderer and `ExtHost*` services in the host, wired by a factory that handles the plumbing declaratively.

Two consequences worth knowing:
- **Type converters exist** because objects can't cross by reference. Public types (`vscode.Uri`, `vscode.Position`) are distinct from internal ones (`URI`, `IPosition`), with a conversion layer between. Confusing the two is a common error when moving code between an extension and a contribution.
- **Responsiveness monitoring**: if the extension host doesn't acknowledge within ~3 seconds it's marked unresponsive. Long synchronous work in an extension has visible consequences.

## 6. Where things actually live

| Looking for | Start at |
|---|---|
| What services exist | `src/vs/workbench/workbench.common.main.ts` |
| A feature's implementation | `src/vs/workbench/contrib/<feature>/` |
| The public extension API | `src/vs/workbench/api/` and `src/vscode-dts/` |
| Editor internals | `src/vs/editor/` |
| Desktop entry point | `src/vs/code/` |
| Agentic session window | `src/vs/sessions/` |
| Built-in extensions | `extensions/` (git, language features, etc.) |
| Build pipeline | `build/` — and `build/next/` for the newer esbuild path |
| Branding and capabilities | `product.json` |
| Codebase conventions for agents | `.github/copilot-instructions.md` |
| Build-pipeline notes for agents | `.github/instructions/buildNext.instructions.md` |

**The last two are unusually valuable.** Microsoft maintains instruction files in the repo specifically to orient AI agents working in the codebase — they contain the layering rules, the validation commands, code-style constraints (tabs not spaces; externalised strings must use `{0}` placeholders, never concatenation; title-style capitalisation for commands and menu items), and current build-system state. Read them at your pin before starting work; they are the closest thing to an official, current, machine-oriented contributor guide.

## 7. Verifying against current source

The method that beats staleness. Use it before relying on anything version-specific.

1. **Establish the pin.** `git log -1` in the fork, and which upstream tag it descends from. Every subsequent answer is relative to this.
2. **Read the repo's own agent instructions** at that pin (`.github/copilot-instructions.md`, `.github/instructions/*.md`). They change with the codebase and are authoritative for conventions.
3. **Grep the source, don't trust docs.** The wiki lags. For "does service X exist / what's its shape", search `workbench.common.main.ts` and the interface definition directly.
4. **Run the validators** rather than reasoning about compliance: `npm run valid-layers-check`, the stylelint variable-name validation (`build/lib/stylelint/`), and the type check.
5. **Check the changelog/release notes** between your pin and current for anything touching the area you're changing — this is where API removals hide.
6. **Prove it with a spike, not an assertion.** For anything expensive (a new contribution, a build-pipeline change, a React mount), the cheapest possible working example answers the question definitively in an hour and prevents a week of wrong assumptions.

**Label everything version-specific** as "verified at `<pin>`" so a future reader knows whether to re-check. This mirrors the verified/inferred/assumed discipline used across WalkCroach's architecture documents.