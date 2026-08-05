---
name: walkcroach-component-alignment-consistency
description: Enforces grid-based, programmatic alignment and reusable component consistency across a UI build, eliminating manual pixel-nudging and one-off components. Use this skill whenever arranging multiple elements on a screen, building forms, reviewing layout for misalignment, or whenever a build has more than a couple of repeated elements (buttons, cards, list rows, form fields) that need to look uniform.
---

> WalkCroach Web skill — companion to `walkcroach-frontend-design`. Prefer Graphite Lumen tokens when the surface is WalkCroach-branded; customer brand tokens win for customer creatives.
# Component Alignment & Consistency

Misalignment is rarely about being a pixel off — it's usually about relying on manual placement instead of layout rules, so alignment breaks the moment content changes.

## Use layout systems, not manual positioning

- Build with flexbox/grid (or the equivalent auto-layout in the design tool) so that alignment is enforced structurally, not by eyeballing pixel offsets. A component built with manual absolute positioning will misalign the instant the content length changes (longer name, different currency amount, translated text).
- Related elements must share the same edge: a label and its input, a heading and its body copy, an icon and its caption — align these to a common edge (usually left) rather than centering them independently.
- Equal-width elements (buttons in a row, cards in a grid) should be sized by the grid/flex system, not by content — a button sized to its own text will misalign with its siblings the moment one label is longer.

## One component, one implementation

Every recurring UI pattern — button, card, input, badge, table row — should exist as exactly one reusable component with defined variants (primary/secondary/danger, small/medium/large), not as several near-identical hand-rolled versions scattered through the codebase. AI builders are prone to generating a new "one-off" button or card each time one is needed, producing plausible-looking variants that don't actually exist in any shared component library. Before adding a new component, check whether an existing one can be extended with a variant instead.

## Optical vs. mathematical alignment

Elements that are technically centered by coordinates sometimes look off-center to the eye — icons with uneven visual weight, or text with different cap-heights, may need a 1–2px manual nudge to *look* balanced even though the math says they're centered. This is the one place where a deliberate small override of the grid is correct — but it should be rare and intentional, not the default way alignment gets fixed.

## Breaking alignment on purpose vs. by accident

Occasionally breaking the grid — an image that bleeds past the column, an offset pull-quote — can create useful visual interest. The distinction that matters: intentional breaks should be rare, deliberate, and still anchored to the underlying grid structure so navigation and scanning aren't disrupted. Accidental misalignment (inconsistent padding, unaligned icon, a button that doesn't match its siblings' height) has no such justification and should always be fixed.

## Verification method

Don't judge alignment by reading the component code — judge it by rendering the page and looking at it. Code that looks correct (`justify-content: center`) can still produce visual misalignment once real content, different string lengths, or responsive breakpoints are involved. Always do a rendered visual pass, not just a code review, before calling alignment "done."

## Pre-ship checklist
- [ ] No element on the page uses manual/absolute pixel positioning where a flex/grid layout would work
- [ ] Every recurring UI pattern maps to exactly one shared component with variants, not multiple near-duplicate implementations
- [ ] Rows of buttons/cards/icons are equal-width/height via the layout system, not sized to their own content
- [ ] Related label/value, icon/text, and heading/body pairs share a common edge alignment
- [ ] The build was checked by rendering with realistic (varied-length) content, not just placeholder text
