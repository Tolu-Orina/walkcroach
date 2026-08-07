# WalkCroach Desktop — D2.5 UI/UX Overhaul
## Diagnosis, field research, design paradigm, and an executable component spec

**Written:** 2026-08-05
**Extends:** `walkcroach-desktop-native-agent-module.md` §5 (which fixed tokens and named components) — this document supplies the *diagnosis* that §5 lacked, the *field research* it asserted without sourcing, and the *executable detail* needed to build it.
**Supersedes:** §4.4.6 (UX polish) of `walkcroach-desktop-implementation-plan.md`
**Scope:** the WalkCroach sidebar Agent view. The CockroachDB panel is D4.
**Updated:** 2026-08-05 — §10 addendum extends scope to the Explorer panel's
own toolbar (§10.2, justified there) and adds ambient motion, user-configurable
brand colour, and researched findings on React/Tailwind/shadcn/Motion
feasibility inside the native ViewPane architecture.

---

## 0. Why it looks generic — the actual, mechanical reason

Not a taste problem. A stylesheet problem, and it is measurable.

`walkcroachChatViewPane.ts` (261 lines) sets **every** visual property as an inline
`element.style.x = '…'` assignment. There is no stylesheet, no CSS class, no token
layer. Three concrete consequences, all visible in the current screenshot:

| Defect | Cause | Evidence |
|---|---|---|
| **The input is a white box in a dark IDE** | `document.createElement('textarea')` at :110 receives `flex`, `resize`, `borderRadius` — and *no* color, background, border, or font. It therefore renders with **user-agent default styling**: white fill, black text, system font | :110–:115 set four properties; none are `color`, `background`, `border`, `font-family`, or `font-size` |
| **"Run" is a light-grey OS chip** | Same at :124–:129 — `padding`, `borderRadius`, `cursor` only. No `background`, no `color` | :124–:129 |
| **Everything else is flat and evenly weighted** | Mode buttons, meta line, transcript rows all use ad-hoc px values (`8px`, `4px`, `6px`, `10px`, `11px`, `12px`, `13px`) chosen per element rather than from a scale | 20+ distinct literals across the file |

The single highest-impact fact: **VS Code exposes 400+ theme colors to any DOM in
the workbench as `--vscode-*` CSS variables.** A `ViewPane` is regular workbench
DOM, so those variables are already in scope — the file simply never uses them for
the two controls that most needed them. The white input is not a theming
limitation; it is two missing declarations.

**This is good news.** The information architecture is already right (mode switcher
→ status line → transcript → composer). The mode contract, the read-only Chat
gating, and the AHP status line are real and working. D2.5 is a *presentation*
layer over a correct structure — not a rebuild.

### 0.1 The decision §5 got wrong, and the correction

The native-agent-module §3.3 chose **`WebviewView` (React/Tailwind)** over a native
`ViewPane`, scoring "feels native to VS Code's chrome" as a *"negligible difference
in practice."* The build then shipped a native `ViewPane` anyway (the file above),
and the doc comment at :28-33 records the reversal.

**Keep the `ViewPane`.** The §3.3 reasoning had two errors worth naming so they are
not re-litigated:

1. *"VS Code's own Chat view is itself largely webview-rendered"* — it is not. The
   chat list, input, and toolbars are native workbench widgets; webviews render
   *individual message content parts* (rendered markdown, some tool output).
2. The cost column inverted. A webview needs its own theme bridge (all 400+
   variables re-declared or re-derived), its own focus/keyboard handling, its own
   scroll virtualization, and a versioned postMessage protocol — to reach parity
   with what `ViewPane` gives for free. "Near-zero" was wrong.

What §3.3 got *right* is that the chat UI iterates fastest and should not be
hand-rolled twice. The resolution is not a webview — it is a **stylesheet plus a
component module**, which is the actual missing piece and is where the rest of this
document goes. Sharing pixel-level code with the IDE extension's React webview was
never realistic across two different rendering models; sharing the **design
tokens** (§3) is realistic, and is the sharing that matters.

---

## 1. Field research — what the competition actually ships

Verified 2026-08-05. Sourced at the end.

| Product | Paradigm | The specific idea worth stealing | What to avoid |
|---|---|---|---|
| **Google Antigravity** | Agent-first; **Manager View** orchestrating ≤5 parallel agents, each in its own workspace | **Artifacts as the trust layer** — Task List, Implementation Plan, Walkthrough. Structured documents, not logs. *"Do not ask a human to trust agent output blindly. Hand them proof they can review in seconds."* Feedback is left **on the artifact, like commenting on a doc, without stopping execution** | Reviews cite instability and an opaque credit system; it lands as "a second tool, not a replacement" |
| **Windsurf (Cascade)** | Dedicated agent panel, plan-execute-verify loop | The panel **quietly tracks your actions** and a preview/deploy bar appears **contextually** for frontend work. Reviewers praise a deliberate balance: *"clean enough for focus, smart enough to guide"* | — |
| **Cursor** | Fork; proprietary chat panel, model-agnostic | Density and speed of the transcript | Zed's critique lands: it can feel *"optimized around automation before craft and review"* |
| **Zed** | Native GPUI, 120fps | The Assistant panel reads as *"native, tidy"* — restraint as a feature | Not reachable for us; we are Electron |
| **Claude Code (extension)** | Its own dedicated panel | *"Closer to git than to VS Code's traditional chat sidebar"* — inline diffs, plan mode, history as first-class | — |

### 1.1 The converged pattern, and where it leaves a gap

Across the agentic-UX literature the same three things recur:

1. **Graduated autonomy, not a binary.** Suggest → Co-pilot → Autopilot. Our
   Chat/Plan/Agent switcher is already exactly this shape.
2. **Control surfaces beyond chat** — approvals, receipts, logs, undo, safe
   recovery. *"Chat-first UX fails."*
3. **Typed event streams** — status / thinking / tool-call / token as a
   discriminated union, each rendered differently. Approval gates block the stream.

Every competitor's trust story points **forward**: here is what I did, here is proof
it works. Antigravity's Walkthrough is the best expression of it.

**Nobody proves the other direction.** No shipping agent IDE shows *what it already
knew before it started, and where that knowledge came from.* That is not a gap we
have to invent a reason to fill — it is precisely what the CockroachDB memory layer
already produces, on every surface, and it is the one thing a competitor cannot
copy by adding a component.

---

## 2. WalkCroach's paradigm: **evidence in both directions**

> Antigravity proves what the agent **did**. WalkCroach also proves what the agent
> **knew** — and where it learned it.

This is the organizing principle for every component below, and the answer to "why
does this not look like everyone else's chat sidebar."

| Direction | Question it answers | Surface |
|---|---|---|
| **Backward — provenance** | *"Why did it assume that?"* | The provenance chip: source surface + age, on any turn, plan step, or memory that drew on recall. "from Chrome · 3d ago" |
| **Forward — artifacts** | *"What did it actually change, and is it right?"* | Plan artifact (pre-flight), diff review, run receipt (post-flight) |

Three rules that follow, and that every component honours:

- **R1 — No unsourced claim.** If a turn used `recall_project_memory`, it shows the
  chip. If it did not, it shows nothing. An absent chip is information.
- **R2 — Structure over prose.** A plan is a list of steps with file paths, never a
  paragraph that resembles a plan. A result is a receipt, never "Done!".
- **R3 — Review without stopping.** Feedback on a plan step edits that step; the
  session does not restart. Directly Antigravity's best idea, and it is compatible
  with AHP because a chat is one continuous session (module §4.4).

### 2.1 Voice

Terse, factual, lowercase-leaning in metadata; no exclamation marks; never
first-person enthusiasm. "3 files changed · 2 tests passed" beats "Great! I've
finished making those changes for you!" The status line already does this
(`Chat · idle · signed out · unlinked`) and it is the best-designed thing in the
current build — extend that register everywhere.

---

## 3. Tokens — concrete values, one source

Ships as **one stylesheet**, `browser/media/walkcroach.css`, imported by the view
pane. **No inline `style.x =` assignments survive D2.5** except dynamic layout
(`layoutBody` height/width, and the textarea auto-grow measurement).

> **Correction, found during implementation — `--wc-*` custom properties are not
> permitted.** The build's `build/lib/stylelint/validateVariableNames.ts`
> validates every custom-property reference against a fixed allowlist
> (`build/lib/stylelint/vscode-known-variables.json`). Upstream registers its own
> local properties (`--session-view-background`, `--tool-risk-accent`, …) in that
> file — but it is an upstream file, so adding `--wc-*` would be a **fourth
> upstream hook**, which §5 of the base plan forbids without an explicit decision
> record. The first implementation used `--wc-*` and produced **148 stylelint
> errors against a previously clean baseline** (verified: 0 non-WalkCroach errors
> before the change).
>
> **Resolution, no upstream touch:** colour binds directly to allowlisted
> `--vscode-*` variables with the Graphite Lumen value as the `var()` fallback;
> spacing, radius and type are literals *inside the stylesheet only*. All 13
> colour variables used were verified present in the allowlist. Two were **not**
> and are avoided: `--vscode-font-family` and `--vscode-editor-font-family` — the
> UI font is inherited from `.monaco-workbench` (better anyway) and code uses the
> allowlisted `--monaco-monospace-font`.
>
> The spec's real constraint is unchanged and still enforced: **no colour,
> spacing, radius or font literal appears anywhere in TypeScript.** The token
> layer is now "one file, documented scale" rather than "CSS variables".
>
> Also worth knowing: the validator is a **line-based regex**, so it matches
> custom-property references inside comments. Do not write one in prose.

### 3.1 Colour — bind to `--vscode-*` first, Graphite Lumen as fallback

The theme (`color-system-research.md`) already fixes the palette. The rule is that
the *stylesheet* never hardcodes a hex where a `--vscode-*` variable exists, so the
view stays correct under any user theme, with Graphite Lumen values as the fallback
in the `var()` second argument.

**Surfaces follow the theme; brand accents do not.**

| Role | Source | Value |
|---|---|---|
| canvas | `--vscode-sideBar-background` | fallback `#14161B` |
| raised | `--vscode-input-background` | fallback `#1C1F26` |
| line | `--vscode-panel-border` | fallback `#2E333C` |
| text | `--vscode-foreground` | fallback `#F2F3F5` |
| muted | `--vscode-descriptionForeground` | fallback `#9198A4` |
| **signal** | **literal** | `#F0B429` |
| **teal** | **literal** | `#6B9EFF` |
| ember | **literal** | `#F07167` |

> **Correction, found after the first build.** The accents were originally bound
> to `--vscode-focusBorder` / `--vscode-textLink-foreground` with the Graphite
> Lumen hex as the `var()` fallback. That is wrong: those variables always
> exist, so the fallback never fires. The fork sets **no `defaultColorTheme`**
> and ships **no Graphite Lumen theme file** (verified — it exists only in
> `color-system-research.md`), so under the shipped default (Dark Modern) they
> resolved to `focusBorder #0078D4` and `textLink.foreground #4daafc` — two
> near-identical blues. That collapsed `signal` and `teal` into the same colour,
> destroying the "teal means memory and nothing else" rule the provenance chip
> depends on, and making the view look like stock VS Code.
>
> Surfaces stay theme-bound because the view must sit correctly inside whatever
> chrome surrounds it. Accents are brand identity and are literal.
>
> **Still outstanding:** ship an actual Graphite Lumen theme file and set
> `defaultColorTheme`, so the surrounding chrome matches the view.

Plus `--vscode-toolbar-hoverBackground`, `--vscode-list-hoverBackground`, and
`--vscode-button-{background,foreground,hoverBackground}` — all verified present
in the allowlist.

**teal is the memory colour and is used for nothing else.** That exclusivity is
what makes provenance readable at a glance without a legend. **signal** is never
a large fill: focus rings, the active-segment underline, the approval accent, and
exactly one primary button.

### 3.2 The rest

| Axis | Values | Rule |
|---|---|---|
| **Spacing** | `--wc-1:4px --wc-2:8px --wc-3:12px --wc-4:16px --wc-6:24px --wc-8:32px` | No other spacing literal appears anywhere. Replaces the ~20 ad-hoc values in the current file |
| **Radius** | `--wc-r-sm:4px` (chips, inputs, buttons) · `--wc-r-md:8px` (cards, bubbles) · `--wc-r-lg:12px` (approval card only) | Note: **tightened from §5's 6/10/14**. A 200–320px sidebar at 8px padding makes 10px+ radii read as bubbly and waste horizontal space. Radius scales with surface size; the sidebar is small |
| **Type** | `--wc-fs-meta:11px` · `--wc-fs-body:13px` · `--wc-fs-title:13px/600` — and that is all | **Also tightened from §5's 12/14/16/20.** The workbench sidebar's own convention is 13px body / 11px metadata; 14px body next to a 13px file explorer reads as a foreign application. Two weights only: 400 / 600 |
| **Font** | `var(--vscode-font-family)` for UI; `var(--vscode-editor-font-family)` for code, paths, and diffs | Never a webfont. Paths in the editor font is what makes file references feel native |
| **Density** | Transcript row vertical rhythm `--wc-2` between turns, `--wc-1` within a turn | Grouping by proximity — the current file uses a flat `10px` everywhere, which is why nothing groups |

**Recorded deviation:** §5 of the native-agent-module specified 6/10/14px radii and
a 12/14/16/20px type scale, drawn from general enterprise card-design guidance. That
guidance assumes a web app at ~1000px content width. This spec overrides both for
the sidebar context. Where the CockroachDB **panel** (D4) is wide and tabular,
§5's larger scale is appropriate and should be used there — the axis is surface
width, not product preference.

---

## 4. Layout

```
┌────────────────────────────────┐
│ ⌄ WALKCROACH          [🎨][⋯][⤢] │  ViewPane title (upstream) — corrected
│                                 │  2026-08-05: was "AGENT"; the brand name
│                                 │  reads correctly at a glance, a mode
│                                 │  label doesn't need to. See §10.1.
├────────────────────────────────┤
│ idle · signed out · unlinked   │  status line — 11px muted, one line,
│                                │  ellipsis, full text in title attr
│  [superseded — mode switcher   │  the segmented 32px row below was removed
│   row removed 2026-08-05,      │  2026-08-05 and folded into the composer
│   see §10.3]                   │  as a compact pill next to the model
│                                │  picker. Reclaims ~32px for transcript.
├────────────────────────────────┤
│                                │
│  ┌──────────────────────────┐  │  transcript — flex:1, overflow-y
│  │ ▸ from Chrome · 3d ago   │  │  provenance chip (teal)
│  │ The auth flow uses PKCE… │  │  agent turn — no bubble, no border
│  └──────────────────────────┘  │
│                                │
│      ┌──────────────────────┐  │  user turn — raised fill, indented
│      │ why does login fail? │  │  right, radius-md
│      └──────────────────────┘  │
│                                │
├────────────────────────────────┤
│ ┌────────────────────────────┐ │  composer — raised, 1px line,
│ │ Ask a question (read-only) │ │  focus:signal ring, auto-grow 3→8 rows
│ └────────────────────────────┘ │
│ Nova Pro ▾            ⌘↵ Run   │  model picker + submit affordance
└────────────────────────────────┘
```

Four deliberate departures from the current build:

1. **The agent turn has no container.** Bordering both roles (current :227–:231)
   gives the transcript a ladder of boxes and halves usable width. Only the *user*
   turn gets a surface; the agent's words are the primary content and sit directly
   on the canvas. This is the single biggest perceived-density win available.
2. **`ROLE` labels are deleted** (current :235–:237: `who.textContent = m.role.toUpperCase()`).
   Alignment and fill already encode role. A 11px "ASSISTANT" on every turn is pure noise.
3. **The mode switcher is a true segmented control** — one bordered track, dividers
   between segments — not three independent bordered buttons with a 4px gap.
4. **The Run button becomes a keyboard hint.** `⌘↵` as the primary affordance with
   the button as a small icon-only fallback. The current 3-line textarea + tall
   "Run" block consumes ~90px of a ~700px column for one action.

---

## 5. Components

Each is a function in `walkcroachAgentComponents.ts` returning an `HTMLElement`,
styled by class only. Built once, variant-driven.

### 5.1 Provenance chip — `wc-chip-provenance` *(the differentiator)*

```
▸ from Chrome · 3d ago
```
- 11px, `--wc-teal` text on `color-mix(in srgb, var(--wc-teal) 12%, transparent)`,
  radius-sm, padding `2px var(--wc-2)`, inline-flex, 16px codicon.
- Icon per surface: Web `globe`, Chrome `browser`, IDE `vscode`, CLI `terminal`,
  Desktop `device-desktop`.
- Age is **relative and coarse** — `just now` / `3d ago` / `Mar 4`. Never a timestamp.
- Click → opens that memory in the Memory view (D4). Until D4, no click handler and
  `cursor: default` — an affordance that does nothing is worse than none.
- **One implementation, four call sites**: agent turn, plan step, memory list,
  fleet-session card. Never re-implemented per surface.

### 5.2 Turn — `wc-turn`, variants `--agent` / `--user`

- `--agent`: no background, no border, `padding: var(--wc-2) 0`.
- `--user`: `background: var(--wc-raised)`, radius-md, `padding: var(--wc-2) var(--wc-3)`,
  `margin-left: var(--wc-8)`.
- Mode tag renders **only on change** (current build already does this correctly at
  :218–:226 — keep the logic, restyle as an 11px muted eyebrow with a hairline rule).
- Markdown is rendered, not `textContent`. Code fences → editor font on `--wc-raised`,
  radius-sm, `overflow-x:auto`. Inline `code` → editor font, subtle fill.

### 5.3 Composer — `wc-composer`

The fix for the white box. Explicitly:

```css
.wc-composer textarea {
  background: var(--wc-raised);
  color: var(--wc-text);
  border: 1px solid var(--wc-line);
  border-radius: var(--wc-r-sm);
  font: inherit;                 /* kills the user-agent serif/sans default */
  padding: var(--wc-2);
  resize: none;                  /* auto-grow instead */
}
.wc-composer textarea:focus-visible {
  outline: 1px solid var(--wc-signal);
  outline-offset: -1px;          /* inset, matches workbench inputs */
  border-color: var(--wc-signal);
}
.wc-composer textarea::placeholder { color: var(--wc-muted); }
```

- Auto-grow 3→8 rows by `scrollHeight`, then scroll.
- Mode-aware placeholder — already correct at :173–:185, keep verbatim.
- **Chat mode reads as read-only-safe**: the composer shows a small `eye` codicon
  and the placeholder already says `(read-only)`. This is honest UI for a mode
  whose tool registry is a strict subset (module §4.1) — the user can see the
  guarantee, not just be told it.
- **New, 2026-08-05:** the mode picker (§5.4's replacement, §10.3) lives in this
  component's bottom toolbar row, left of the model picker, separated by a
  middle dot — `Agent ▾ · Nova Pro ▾`. It is a `wc-composer` sub-element, not a
  separate component, because it never appears without a composer beside it.

### 5.4 Mode switcher — `wc-modes` *(superseded 2026-08-05 — see §10.3)*

> **Superseded, not deleted.** The design below was the original spec and is
> kept for history. It shipped as a full-width 32px row and, once built next
> to a working mockup, read as a disproportionate amount of chrome for three
> words — see §10.3 for the replacement (a compact dropdown pill inside the
> composer) and the reasoning.

One track: `border: 1px solid var(--wc-line)`, radius-sm, `overflow: hidden`,
`display: grid; grid-template-columns: repeat(3, 1fr)`. Segments have no individual
border; dividers are `border-left` on segments 2–3.
Active: `background: var(--wc-raised)`, weight 600, `box-shadow: inset 0 -2px 0 var(--wc-signal)`
(inset, so it cannot shift layout — the current `borderBottom` swap at :164–:166
changes border width between states and nudges the row by 1px).
Keyboard: `role="tablist"`, Arrow keys move, Home/End jump, roving `tabindex`.

### 5.5 Plan-step card — `wc-plan-step`

Numbered, collapsed by default. Header row: index, file path (**editor font**,
middle-ellipsized), one-line reason, chevron. Expanded: full reasoning + diff preview.
Per-step: `Approve` / `Edit` / `Skip`. One `Approve all` primary button at the list
foot — exactly one primary CTA on screen.
`Edit` is inline and **does not interrupt the run** (R3).

### 5.6 Approval card — `wc-approval` *(Tier 3 only)*

The one component with elevation: `box-shadow: 0 2px 8px rgb(0 0 0 / 0.35)`,
radius-lg, `border-left: 2px solid var(--wc-signal)`.
Names the exact command/resource in editor font, and **why it is Tier 3** in words
("deletes cloud infrastructure"). Actions: `Approve` (primary) / `Decline`.
**Never colour-only** — every state carries icon + text label
(`Requires approval` / `Approved` / `Declined` / `Failed`), so the highest-stakes
surface in the product never depends on hue.

### 5.7 Run receipt — `wc-receipt` *(Antigravity's Walkthrough, our register)*

Closes a run in one scannable line plus a disclosure:

```
✓ 3 files changed · 2 tests passed · 4.2s          [details ⌄]
```
Expanded: per-file diff stat (click → workbench diff editor), commands run with exit
codes, and every memory written this run — each with its provenance chip, which is
where "evidence in both directions" visibly closes the loop.

### 5.8 Status line — `wc-status`

Keep the content (:187–:198) exactly; it is already the right register. Restyle to
11px `--wc-muted`, single line, `text-overflow: ellipsis`, full string in `title`.
The one addition: when phase ≠ `idle`, a 1px `--wc-signal` progress hairline along
the composer's top edge — the only always-live motion in the view.

### 5.9 Empty states

Per mode, replacing the single generic string at :210–:213:

| Mode | Copy |
|---|---|
| Chat | "Ask about this codebase. Read-only — nothing will be modified." |
| Plan | "Describe what you want built. WalkCroach proposes a plan before touching anything." |
| Agent | "Give an instruction. Destructive actions always ask first." |

Signed out, all modes append one primary action: **Sign in** — the only place the
view shows a filled `--wc-signal` button.

---

## 6. Motion

CSS only. No animation library in the workbench layer.

| Event | Spec |
|---|---|
| Turn entrance | `opacity 0→1, translateY 4px→0`, 120ms `ease-out` |
| Streaming text | Append-only text nodes + a 1×1em `--wc-signal` caret at 1s `step-end` blink. **No per-token animation** |
| Plan step expand | `grid-template-rows 0fr→1fr`, 180ms `ease-out` |
| Approval card | 200ms `cubic-bezier(0.2,0,0,1)` scale `0.98→1` + fade. The one weighted moment |
| Phase hairline | 1.2s linear indeterminate sweep |

`@media (prefers-reduced-motion: reduce)` → all of the above become `opacity` only
at 80ms; the hairline becomes static. Non-negotiable.

---

## 7. Accessibility

- **Contrast:** every pairing meets WCAG 2.2 AA (4.5:1 body, 3:1 UI/large) in both
  Graphite Lumen variants, measured not eyeballed. `--wc-muted` (#9198A4) on
  `--wc-canvas` (#14161B) ≈ **7.4:1** — passes with margin, which is why it is safe
  for 11px metadata. Verify after any palette change.
- **Focus:** every interactive element has a visible `--wc-signal` ring at ≥3:1
  against its own background. `:focus-visible`, never `:focus` — no mouse rings.
- **Screen reader:** transcript is `role="log" aria-live="polite"` so streamed turns
  announce without stealing focus. Approval cards are `role="alertdialog"` —
  they *should* interrupt.
- **Keyboard, complete:** Tab reaches mode switcher → transcript → composer →
  submit. `⌘↵`/`Ctrl↵` submits (already at :116–:121). `Esc` in the composer with
  a run in flight → abort.
- **High contrast:** verify against `hc-black`/`hc-light`. `color-mix` chip fills
  must fall back to a solid border in forced-colors mode.

---

## 8. Sequence

Ordered by visible-improvement per hour. **D2.5a alone fixes the screenshot.**

| Step | Work | Outcome |
|---|---|---|
| **D2.5a** | Add `media/walkcroach.css` with §3 tokens. Delete every inline style from `walkcroachChatViewPane.ts`, replace with classes. Fix composer + submit (§5.3) | The white box and grey chip are gone; view reads as one designed surface |
| **D2.5b** | Mode picker in composer (§10.3, supersedes §5.4's segmented row), turn restyle incl. dropping `ROLE` labels and the agent bubble (§5.2), status line (§5.8), per-mode empty states (§5.9) | Density and hierarchy arrive |
| **D2.5c** | Provenance chip (§5.1) + markdown/code rendering in turns | The differentiator becomes visible |
| **D2.5d** | Plan-step card (§5.5), approval card (§5.6), run receipt (§5.7) | Plan and Agent modes stop looking like Chat |
| **D2.5e** | Motion (§6), a11y audit (§7), high-contrast pass | Ship quality |
| **D2.5f** | *(added 2026-08-05)* Sidebar toolbar (§10.2), ambient orb motion on both panels (§10.4), user-configurable brand colour (§10.5) | The two panels read as one system; personalisation lands |

Logo/icon assets stay a **blocking external dependency** (base plan §4.4.4) and gate
none of the above — the sidebar toolbar's icon set (§10.2) is a separate, smaller
asset need and does not block D2.5a–e.

### 8.1 Done-checks — objective, scriptable

1. `grep -c "\.style\." walkcroachChatViewPane.ts` returns **≤2** (layout only).
2. No hex literal in any `.ts` under `contrib/walkcroach/` — colour lives in CSS
   (or, after §10.5, in the resolved configuration value at read time).
3. No spacing/radius/font-size literal outside `walkcroach.css`.
4. The view renders correctly under `Default Dark+`, `Default Light+`, `hc-black`
   — proving `--vscode-*` binding rather than hardcoded Graphite Lumen.
5. Screenshot diff at 240px, 320px, 480px sidebar widths — no overflow, no clipped
   status line, no composer toolbar wrap (mode pill + model picker + submit hint
   on one row — this replaces the original "no wrapped mode switcher" check now
   that the switcher itself no longer exists as a separate row, §10.3).
6. Full keyboard traversal with no mouse, and a `prefers-reduced-motion` pass —
   now also covering the ambient orbs (§10.4: animation stops, not slows).
7. *(added 2026-08-05)* Every custom brand colour, before it can be applied,
   shows a live contrast ratio ≥3:1 against both `--wc-canvas` and
   `--wc-raised`, or is visibly marked failing (§10.5) — never silently
   applied without the check.

---

## 9. Risks

| Risk | Why it bites | Mitigation |
|---|---|---|
| **A stylesheet in `contrib/walkcroach/` needs a build-pipeline entry** | Workbench CSS is bundled by the gulp `compile` path; a new `media/*.css` may need registration and would be a **fourth** upstream touch if it lands outside our allowlisted tree | Spike first. Preferred: import the CSS from the existing contribution entry (`.css` imports are already how workbench contribs ship styles) — that keeps it inside `contrib/walkcroach/**`, already allowlisted, and costs **no** new hook. Confirm before D2.5a, do not assume |
| **Restyling drifts from the IDE extension's React UI** | Two products, "the same" UI, two rendering models | Share **tokens**, not components. Emit §3 as a single source consumed by both; accept that markup differs |
| **Provenance chip promises data that is not wired at D2.5** | Chip renders only when a turn used recall; recall arrives with the engine in D3 | Ship the component in D2.5c behind real data only. **Never render a placeholder chip** — a fabricated provenance claim is worse than no chip, and directly violates R1 |
| **Tightened type scale reads cramped on high-DPI** | 13/11px is right at 100%, unverified at 150%+ | Check at 100/125/150/200% during D2.5e; the scale is in one file if it must move |
| ***(added 2026-08-05)* Tailwind's generated CSS reproduces the 148-error stylelint failure** | Tailwind (esp. v4) emits `--tw-*`/`--color-*` custom properties as a core mechanism, the same class of violation §3's `--wc-*` attempt already hit | Run the spike in §10.6 (real Tailwind build → same stylelint script) *before* any Tailwind-based component is written, not after one exists to unwind |
| ***(added 2026-08-05)* Account-icon relocation to the status bar was a default, not a validated choice** | §10.2 moved account access from the removed rail's bottom to the status bar because it needed *a* home, not because that's confirmed the right one | Revisit with real usage — the chevron's overflow menu is the honest alternative, not yet chosen over the status bar for a strong reason |
| ***(added 2026-08-05)* Mode pill's move into the composer trades away passive visibility** | The segmented row was a scroll-proof anchor; the pill isn't visible unless the composer is in view (§10.3) | Watch this specifically with real users before treating the relocation as settled; the status line's partial compensation is asserted, not measured |
| ***(added 2026-08-05)* Decorative teal orbs sit outside §3.1's own exclusivity rule** | "Teal is the memory colour and is used for nothing else" is written as an absolute; the ambient background (§10.4) uses it decoratively | Accepted as a low-risk, low-opacity exception and recorded here rather than left implicit — revisit if it ever reads as competing with an actual provenance chip in the same view |

---

---

## 10. Addendum — 2026-08-05

A live React/Tailwind mockup was built to pressure-test this spec end to end
(`WalkCroachDesktopMockup.jsx`) — not as a shipping artefact (§0.1's decision
holds; see §10.4 for why), but as the fastest way to see the whole system
assembled and find what the written spec alone didn't surface. Four real
changes came out of that process, plus the deep-dive research into whether
React/Tailwind/shadcn/Motion can ever legitimately reach the native ViewPane
the team asked for explicitly. This section is additive — nothing above is
deleted, per the doc's own convention (§0.1, §3.1's correction pattern).

### 10.1 Panel title: `WALKCROACH`, not `AGENT`

`AGENT` labelled the *view*, correctly, but it is also the one place in the
whole product a user looks to confirm which product they're in when the
surrounding chrome is otherwise unbranded workbench UI (title bar, menu bar —
none of it says WalkCroach anywhere else on screen). `WALKCROACH` costs
nothing (same 11px/600 title-bar style, same position) and answers a question
`AGENT` didn't. The mode (Chat/Plan/Agent) is already visible in the status
line directly below and, per §10.3, in the composer — it doesn't need to also
own the title.

### 10.2 Sidebar toolbar — outside the original scope, in on purpose

This document's stated scope (front matter) is the Agent view; the Explorer
panel's own toolbar is technically a different surface. It's included here
anyway because building the mockup made the reason obvious: **the two panels
sit side by side in every screenshot a user will ever take**, and a design
system that governs one side of the window and ignores the other reads as
two different products, which directly contradicts §2's whole premise
("evidence in both directions" as one coherent system, not a component
library).

The concrete problem, found by direct comparison against Cursor's own
Explorer panel: VS Code's stock Explorer view exposes its icon row as a
persistent, full-height **vertical** rail down the far-left edge of the
window — the classic Activity Bar. Cursor's does not. Cursor's icon row is a
short **horizontal** strip living inside the sidebar's own header, above the
file tree, with four icons (Files, Search, Source Control, Extensions) and a
single overflow chevron. There is no separate persistent rail at all.

**Change:** replace the vertical Activity Bar with a `wc-sidebar-toolbar`
component — four icons in a row, `--wc-2` gap, inline at the top of the
Explorer panel, plus a chevron that opens a small dropdown (not an expanded
row — a horizontal strip has no room to grow downward without shoving the
file tree, and a dropdown is the correct affordance for toolbar overflow
regardless) listing the remainder (Run & Debug, Settings, Account). The
account affordance that used to live pinned at the rail's bottom moves to the
status bar, next to the AWS profile indicator — the one part of this change
that is a real trade-off, not a free relocation: **decide deliberately**
whether account access belongs in the always-visible status bar or inside the
chevron's overflow only; the mockup picked the status bar for always-visible
access, but that's a product call, not something this research settles.

Tokens: same `--wc-line`/`--wc-muted`/`--wc-text` roles as everywhere else,
17px icon size (between the Agent view's 13px body text and the Explorer's
own 13px file-tree rows — verify this specific size against the real
Explorer's existing icon sizing before implementation, since the mockup's
value was chosen for visual balance in isolation, not measured against a real
Explorer view).

### 10.3 Mode picker moves into the composer

Building the segmented control (§5.4) next to a real transcript, rather than
in isolation, surfaced what the written spec didn't: a 32px full-width row
permanently pinned above the transcript is a lot of chrome for three words
that change rarely mid-session, and every competitor reviewed in §1 who ships
a model/agent picker (Cursor's own composer toolbar being the direct
reference) puts mode/agent selection **inside** the composer, beside the
model picker, not as separate chrome above the transcript.

**Change:** `wc-modes` (§5.4) is replaced by a compact dropdown pill —
`Agent ▾` — living in `wc-composer`'s bottom toolbar row, immediately left of
the model picker, separated by a middle dot (`·`). Click opens a small
popover listing Chat/Plan/Agent with a checkmark on the active mode. This
reclaims the full 32px row for transcript.

**The honest cost, not hidden:** the segmented control was also a passive,
always-visible anchor — scrolled deep into a long transcript, a user could
glance up and instantly confirm the active mode without any click. The
dropdown pill is not visible unless the composer is in view. The status line
partially compensates (`Agent · running · signed in · linked` stays pinned
under the title, per §4's layout), but "partially" is the honest word — this
should be watched with real users, not assumed settled by this change.

### 10.4 Ambient background — orbs with motion, both panels, done to spec

The team asked for ambient gradient backgrounds — the same treatment already
approved on the Agent view — mirrored onto the Explorer panel, with real
motion on both sides. This is decorative, not structural, but it still has a
correct and an incorrect way to build it, and the first pass shipped in the
mockup was incomplete against that standard on two counts, corrected here:

- **`aria-hidden="true"` was missing on every orb.** Purely decorative
  elements must never reach the accessibility tree — added retroactively to
  all four orbs (two per panel).
- **The orbs were static** (a blurred, positioned circle, no motion) despite
  being described as "ambient." Corrected to slow, desynced drift: two
  keyframe animations (13s and 17s, the second offset by a `-6s` delay so the
  two never move in visible unison), animating `transform` (translate + scale)
  and, combined with the drift, a slow `border-radius` morph — the two
  techniques the shape genuinely calls "bubble" or "blob" rather than "static
  gradient circle." Both wrapped in `prefers-reduced-motion: reduce`, which
  stops the animation entirely rather than merely slowing it.

Placement: Explorer gets the same two-colour system (signal, teal) as the
Agent view, mirrored rather than duplicated — teal top-left, signal
bottom-right, opposite corners from the Agent view's signal-top-right,
teal-mid-left — so the two panels read as a matched pair, not copies. Both
panels now clip their orbs with `overflow: hidden` on the panel root (a real
bug found while extending this to Explorer: without it, an orb positioned
near a panel edge bleeds into the neighbouring panel — harmless on the
window's outer edge, where the right panel's orb was, but would have bled
directly across the code editor from the left panel had it shipped
unclipped).

**A tension worth stating plainly, not smoothing over:** §3.1 is explicit that
*"teal is the memory colour and is used for nothing else... that exclusivity
is what makes provenance readable at a glance."* Using teal decoratively in
these background orbs sits outside that rule's letter. It reads fine in
practice — low opacity, far from any provenance chip, never in the same visual
field doing double duty — but it is a real exception to a written constraint,
not a null one. Recorded here rather than left implicit, consistent with
every other correction in this document.

### 10.5 User-configurable brand colours

New requirement, not present in the original scope: users need to change and
configure the brand accent colours (signal, teal, ember), with curated
presets available alongside full custom control.

**The architectural question this raises, and its answer:** §3's own
correction already established that literal hex values, not named `--wc-*`
custom properties, are how brand accents work in this system — the stylelint
allowlist forbids new custom-property *names*, but says nothing about how
often a literal *value* changes. User-configurable colour is therefore not a
new architectural pattern; it's the existing one, driven by a variable input
instead of a hardcoded constant. Concretely: a small settings surface (a
`Palette` icon in the view's title bar, opening a popover) writes the user's
chosen values to VS Code's own configuration store (`workspace.getConfiguration`,
the idiomatic mechanism, not a bespoke WalkCroach preferences file), and the
stylesheet's three accent declarations are regenerated from that
configuration at read time — still zero new custom-property names, still one
file, still nothing for the stylelint validator to reject.

**Roles stay fixed; only values are configurable.** This is the load-bearing
design decision and should not be revisited casually: `signal` always means
action/focus/approval, `teal` always means memory/provenance and nothing
else, `ember` always means destructive/decline. A user can change what hex
`teal` *is*; they cannot make `ember` mean memory. This is what keeps R1
("no unsourced claim") and the provenance chip's whole legibility model
intact regardless of what a user picks.

**Presets are pre-vetted; custom values are checked live, not gatekept.**
Three presets ship (Amber — the current default, Cool Gold, High Contrast),
each chosen to keep `teal`'s hue inside the same brand-recognisable blue
family already used across Web, Chrome and the IDE extension, so switching
presets doesn't fracture cross-surface brand identity. The custom picker
computes a live WCAG contrast ratio for each colour against both `--wc-canvas`
and `--wc-raised` (the AA floor for a UI-component/large-text use is 3:1, not
the 4.5:1 body-text threshold — these colours are never body text) and shows
the number and a pass/fail state next to each swatch — a colour that fails is
shown failing, in the same interface, not silently blocked and not silently
allowed through. This mirrors §7's existing rule ("measured not eyeballed")
applied to a value the user chooses instead of one the team chose.

**Stated, not hidden:** a fully custom trio can genuinely diverge from
WalkCroach's brand identity on the other three surfaces. The settings panel
says this in one line rather than pretending customisation is free. This is a
product trade-off (personalisation vs. brand consistency) intentionally left
to the user, not resolved unilaterally by this spec.

```sql
-- indicative shape only, not the real schema: whatever store
-- backs workspace.getConfiguration for this key
{
  "walkcroach.theme.signal": "#F0B429",
  "walkcroach.theme.teal":   "#6B9EFF",
  "walkcroach.theme.ember":  "#F07167"
}
```

### 10.6 React / Tailwind / shadcn / Motion inside the native ViewPane — researched, not assumed

> **⚠ Superseded by implementation, 2026-08-05 — read §10.7 before acting on
> anything below.** This subsection was written while the native `ViewPane` was
> still what shipped. It no longer is: the view is now a webview hosting a
> React/Tailwind/Motion bundle, and two of the three spikes it recommends have
> been *answered by building*, one of them with a different result than
> predicted. The analysis below is retained because its reasoning about the
> Tailwind risk was correct and is worth keeping on record — but its premise
> and its recommended sequence are stale.

The team asked for a deeper, dedicated look at whether React, Tailwind,
shadcn/ui, and Motion (Framer Motion) can be used to build this view
*without* reopening §0.1's decision to keep a native `ViewPane` over a
`WebviewView`. Findings below are graded by actual evidence found, not
uniform confidence — treat the distinction between "verified" and "no
precedent found, reasoned from mechanism" as real, not a formality.

**React — plausibly viable, no public precedent either way, needs a spike.**
`ViewPane.renderBody(container: HTMLElement)` hands the implementation a
plain DOM node; `ReactDOM.createRoot(container).render(<App/>)` is a generic
DOM API that does not care how that node was created. There is no
theoretical reason this shouldn't work — React components rendered into that
subtree would sit in the *same* document as the rest of the workbench, so
they'd see the *same* `--vscode-*` CSS custom properties already in scope,
without any theme-bridge or postMessage cost (the exact cost that sank the
original `WebviewView` decision in §0.1 does not apply here, because there is
no webview boundary to bridge across). The important honest caveat: an
extensive search turned up **zero public examples of this specific pattern**
— every "React in VS Code" resource found, without exception, means React
*inside a webview*, because that's the only pattern available to the vast
majority of VS Code extension authors, who don't have fork-level source
access the way WalkCroach does. Absence of a precedent is not evidence
against it — it means this is genuinely unexplored territory for a fork,
not a well-trodden path the way the webview route is. **Treat as viable
pending a small spike** (mount a trivial React component into the existing
`walkcroachChatViewPane.ts` container, confirm it renders, confirm hot-reload
during development still works, confirm bundle size added to the always-loaded
workbench JS is acceptable or can be deferred via lazy-loading — see below).

**Tailwind CSS (and shadcn/ui, which depends on it) — real, concrete risk,
verify before committing.** This is the one finding that should change the
plan, not just annotate it. §3's own "Correction, found during
implementation" already documents hitting **148 stylelint errors** from
introducing eight `--wc-*` custom properties, because
`build/lib/stylelint/validateVariableNames.ts` checks every custom-property
*reference* against a fixed allowlist. Tailwind's own generated CSS is built
around custom properties as a core mechanism — extensively so in Tailwind v4,
whose `@theme` system emits colour, spacing and other theme values as
`--color-*` and related custom properties by default, and whose utility
classes (`bg-*`, `ring-*`, `divide-*`, opacity modifiers) frequently compile
to rules that reference `--tw-*` variables internally even in v3. Shipping
Tailwind's default output into this codebase is therefore a strong candidate
to reproduce the exact 148-error failure already on record, very plausibly at
larger scale given how many more custom properties Tailwind emits than the
eight WalkCroach tried. shadcn/ui compounds this: its own theming convention
layers a *second* set of custom properties (`--background`, `--foreground`,
etc.) on top of Tailwind's. **Do not assume this is safe. Before writing any
Tailwind-based component:** run a minimal Tailwind build, drop the generated
CSS into the same file the original `--wc-*` attempt used, and run the exact
stylelint validation script that produced the 148-error result. If it fails
(the likely outcome), the fallback is not "abandon Tailwind" wholesale —
options in order of preference: (a) Tailwind v3 with `corePlugins` disabling
the specific utility families that compile to CSS-variable-dependent rules
(ring, divide, opacity-suffixed background/text/border utilities), keeping
only utilities that compile to static `property: value` — a real, documented
Tailwind capability, not a workaround; (b) hand-authored utility-like classes
in the existing single stylesheet, which is what this document already
specifies and is known to work; (c) escalate adding Tailwind's variable names
to the allowlist as an explicit, recorded upstream-touch decision (the same
governance §5 of the base plan already requires for any new upstream hook),
accepted with eyes open rather than discovered as a build failure later.

**Motion (Framer Motion) — the safe one, confirm bundle strategy only.**
Framer Motion has no dependency on CSS custom properties at all — it drives
animation via JavaScript-computed inline styles and the Web Animations API,
so it does not touch the stylelint allowlist question in any way. The only
real engineering question is bundle size and load timing: Framer Motion
should be **lazy-loaded when the WalkCroach view is first opened**, not
bundled into the always-loaded core workbench JS that runs on every window
launch — the same code-splitting discipline the workbench's own AMD/ESM
module loader already uses extensively for its own contrib parts, applied to
a third-party dependency instead of first-party code. This is a standard,
solvable concern, not an open question the way the Tailwind risk is. The
`wc-*` motion classes already specified in §6 (CSS-only, translated faithfully
in the mockup) remain the *shipped* default per §0.1's own reasoning — Motion
becomes relevant only if a future feature genuinely needs spring-physics or
gesture-driven interaction CSS transitions can't express well (the mockup's
own approval-card "weighted moment" was built as a close CSS approximation
specifically to test whether the gap is felt in practice; it wasn't, for that
one interaction).

**Recommended spike sequence, in order, before any of this is treated as
decided:**
1. React-in-ViewPane mount spike (§10.6, viable pending confirmation) —
   cheapest, highest-confidence, do first.
2. Tailwind-output-vs-stylelint spike (§10.6, real risk) — do before writing
   a single Tailwind-based component, not after.
3. Framer Motion lazy-load spike — confirm the bundle-splitting mechanism
   works inside the workbench's module system; low risk, mostly a mechanics
   check.
4. Only after 1–3: decide whether the *mockup's* React/Tailwind stack becomes
   the real implementation's stack, or whether §0.1's native-ViewPane-plus-
   one-stylesheet approach remains correct and the mockup stays a design
   reference, per its original purpose.

### 10.7 What was actually built — §10.6's spikes, resolved

Written 2026-08-05, after implementing §§10.1–10.5. §10.6's sequence was
overtaken by the decision to go **webview**, which removes the question it was
designed to answer.

**Spike 2 (Tailwind vs. stylelint) — RESOLVED. The risk was real; the fix was
none of the three fallbacks.** §10.6 predicted this correctly, and it happened
exactly as described: introducing `--wc-*` produced **148 stylelint errors
against a verified-clean baseline (0 non-WalkCroach errors)**. But the
resolution was not (a) `corePlugins` surgery, (b) hand-authored utilities, or
(c) an upstream allowlist edit. It was to **inline Tailwind's compiled CSS into
the JS bundle**, so no `.css` file lands under `src/` for
`build/stylelint.ts` — which globs `src/**/*.css` and has no ignore mechanism —
to see at all. Result: **stylelint 0, zero upstream hooks, full Tailwind v4
including `@theme`.** A fourth option that outranks all three listed.

**Spike 1 (React-in-`ViewPane`) — SIDESTEPPED, still unanswered.** Going webview
means React never had to mount into workbench DOM. §10.6's "zero public
precedent" finding stands and remains genuinely untested. It is only worth
revisiting if the webview's accessibility cost (below) proves unacceptable.

**Spike 3 (Motion lazy-load) — NOT APPLICABLE as framed.** Motion is bundled
into the webview asset, which the workbench does not load until the view is
first rendered. The code-splitting concern §10.6 raises applies to bundling
Motion into core workbench JS; that is not what happened.

**The cost §10.6 did not weigh, now real and accepted:** the transcript's
`role="log"`/`aria-live` lives inside an iframe, so the workbench's own
accessible-view commands cannot reach it. This is a genuine regression against
the native pane, recorded in `walkcroachAgentWebviewPane.ts`'s class comment
rather than glossed. §0.1's reasoning was sound *for a restrained native view*;
the product direction changed, and the trade was made knowingly.

**Applied from this addendum:** §10.1 (single `WALKCROACH` header, via
`mergeViewWithContainerWhenSingleView` + `hideByDefault` on Import and
Incompatibles — rather than renaming the view, which would have stacked
`WALKCROACH` above `WALKCROACH`), §10.3 (mode pill in the composer toolbar),
§10.4 (two desynced drifting orbs per panel, `aria-hidden`, clipped, fully
stopped under `prefers-reduced-motion`), §10.5 (three configurable accents in
VS Code configuration, hex-validated on the workbench side before reaching the
stylesheet, applied live).

**Not yet applied: §10.2 (sidebar toolbar).** The mechanism is confirmed —
`IViewDescriptorService.moveViewContainerToLocation` plus the activity bar's
existing overflow — but it is deliberately held until the theme and view
changes above are visually verified, so a layout change is not stacked on top
of two unverified ones.

---

## Sources

- [Introducing Google Antigravity](https://antigravity.google/blog/introducing-google-antigravity) · [Antigravity Docs — Implementation Plan](https://antigravity.google/docs/implementation-plan) · [Build with Google Antigravity (Google Developers Blog)](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/)
- [Mastering Antigravity Artifacts: Task Lists, Implementation Plans, Walkthroughs](https://vertexdigest.com/blogs/mastering-anti-gravity-artifacts) · [Google Antigravity Review — Scalable Path](https://www.scalablepath.com/ai/google-antigravity-review) · [Antigravity Review — Nimbalyst](https://nimbalyst.com/blog/antigravity-ide-review/)
- [Windsurf Review 2026 — DevTools Review](https://devtoolsreview.com/reviews/windsurf-review/) · [Windsurf Review — Autonomous](https://www.autonomous.ai/ourblog/windsurf-review)
- [Zed vs. Cursor — Zed](https://zed.dev/compare/cursor)
- [Agent UX Patterns: Chat-First UX Fails — Hatchworks](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/) · [Designing for AI Agents: 10 UX Patterns (2026) — Mantlr](https://mantlr.com/blog/designing-for-ai-agents-ux-patterns-2026) · [UI/UX & Human-AI Interaction — Agentic Design](https://agentic-design.ai/patterns/ui-ux-patterns)
- [Webview API — VS Code](https://code.visualstudio.com/api/extension-guides/webview) · [Theme CSS variables — vscode-docs#2060](https://github.com/microsoft/vscode-docs/issues/2060)
- **§10.6 additions:** [Using React in Visual Studio Code Webviews — Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/) · [React Webview UI Toolkit for VS Code](https://githubnext.com/projects/react-webview-ui-toolkit/) — both confirm every found public pattern is webview-based, none mount React into a native workbench part directly; used as the evidence for "no public precedent either way" rather than a source of a working example
- **§10.6 additions:** [Tailwind v4 — generated CSS variables clash with existing variables, tailwindlabs/tailwindcss#15754](https://github.com/tailwindlabs/tailwindcss/issues/15754) · [Sharing CSS Custom Properties, tailwindlabs/tailwindcss#8703](https://github.com/tailwindlabs/tailwindcss/discussions/8703) — the primary evidence that Tailwind's own architecture emits custom properties as a core mechanism, the basis for the stylelint-conflict risk finding