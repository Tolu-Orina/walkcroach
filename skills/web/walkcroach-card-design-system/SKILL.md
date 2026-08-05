---
name: walkcroach-card-design-system
description: World-class card design covering every card type — image-led, icon-led, and text-only — with a consistent elevation/shadow system, aspect-ratio discipline, content-density rules, and interaction states. Use this skill whenever designing, building, or reviewing any card component (feature cards, product cards, content cards, dashboard cards, pricing cards), whenever cards on a page look inconsistent with each other, or whenever choosing how much shadow/border/elevation a card should carry. Pair with spacing-layout-system, design-token-discipline, and photography-imagery-language.
---

> WalkCroach Web skill — companion to `walkcroach-frontend-design`.

# Card Design System

Cards are self-contained modules that chunk content into digestible pieces — but a page with several card types (some with photos, some icon-only, some plain text) only reads as "one product" if they all share the same underlying rules. Inconsistency here is one of the fastest ways a build starts to look assembled rather than designed.

## Pick one separation strategy per product — don't mix them

Material Design's three approaches are the standard reference: **elevated** (shadow lifts it off the background), **filled** (a contrasting surface color, no shadow), or **outlined** (a border, flat against the background). Pick exactly one as the product's default and hold it everywhere. Mixing — some cards with heavy shadows, others just a border, others just a color shift — is the single most common source of "these don't feel like the same product." A drop shadow acts as a clickability signal to users (NN/g), so if a card is interactive, it should carry whichever separation treatment the product uses for interactive elements — don't apply the "important/interactive" treatment to static content cards and vice versa.

Minimal/flat treatments (generous padding, a subtle background shift, no heavy shadow) are the stronger default for dense, professional, or enterprise UI in current practice — flatter shadows, larger radii, and more whitespace are outperforming heavy decorative elevation. Reserve real elevation for cards that are genuinely floating above other content (dropdowns, modals) or that need to visually announce "this is the one interactive/important thing here" (see design-token-discipline's north-star-card pattern).

## Build a real elevation system, not one-off shadow values

Define a small, fixed set of elevation tokens — typically capping at 5–6 levels — and assign each a role, not just a numeric size:
```
elevation-0   flat content, page background
elevation-1   resting cards
elevation-2   hovered cards, dropdowns
elevation-3   popovers, tooltips
elevation-modal  modals, dialogs
```
Every card at the same structural role uses the same elevation token — never let two visually-identical card types carry different shadow values, which reads as an unexplained hierarchy difference even when none is intended. Shadows should shift on hover/focus/press (e.g. elevation-1 → elevation-2) to reinforce interactivity, not stay static while a border-color or scale change does all the interaction signaling alone.

Shadow color should relate to the surface it's cast on, not default to pure black at low opacity everywhere: a dark, slightly tinted gray for light surfaces; a darker tint of the surface's own hue for colored or dark cards. This is what makes a shadow read as "physically cast" rather than "a CSS default."

## The two card families: image-led and content-led

**Image-led cards** (product cards, feature cards, article cards, anything with a photo):
- Lock one consistent aspect ratio across every card in the same grid (16:9, 4:3, or 1:1) — never let one card's image be taller/shorter than its siblings, which breaks grid rhythm instantly.
- The photo sits in its own frame at the top (or side, for horizontal cards), followed by a distinct content section below with its own padding — don't float text over the image unless there's a deliberate, consistently-applied gradient treatment for legibility (see photography-imagery-language).
- Use `object-fit: cover` with a fixed-height/aspect container so varying source image dimensions never distort the grid.

**Content-led cards** (icon + text feature cards, stat cards, settings cards):
- Icons follow the icon-system-placement skill — one grid size, one stroke weight, consistent placement relative to the heading.
- Don't force an image into a card describing something with no real visual referent; an icon-only card is the correct choice for genuinely abstract content, not a lesser fallback (see photography-imagery-language for when each medium applies).

Never mix the two structural patterns within the same grid without a deliberate reason (e.g., one "hero" card in a bento layout) — a grid where some cards are photo-topped and others are icon-only-with-different-padding reads as unplanned, even if each card individually looks fine.

## Content rules inside every card

### Stacking order (image-led feature / content cards)

Use this vertical order inside the **content section** — do not rearrange per card:

1. **Icon** (optional) — above the title, left-aligned, fixed grid size (typically 20–24px icon in a 40px hit area). One stroke weight. Never place the icon after the title or floating over the photo unless the whole grid uses that pattern.
2. **Title** — the card’s primary label; one line preferred, two max.
3. **Body / description** — supporting copy; muted vs title; one short paragraph.
4. **Meta / CTA** (optional) — captions, links, or a single primary action last.

The **image section** always sits above (or beside, for horizontal cards) as its own frame — never mixed into the text stack. Do not overlay title/body on the photo for feature grids; overlays are a separate, deliberate treatment for hero/media cards only.

- **One primary action per card** is the standard — at most one or two clearly secondary actions (a bookmark icon, a kebab menu). More than that turns the card into a toolbar.
- **Cap the type scale inside a card** to at most three font sizes (e.g., heading, body, meta/caption) — a card sampling five different text sizes looks assembled from parts, same failure mode as inconsistent spacing.
- **Handle uneven content length up front**: truncate with ellipsis, fix a minimum height, or accept variable card heights deliberately (masonry) — but decide once and apply it everywhere in the grid. Mismatched text lengths left unhandled create awkward, unplanned-looking gaps.
- **If the card represents one entity** (a product, an article, a person), wrap the whole card in a single click target rather than a small "Read more" link — but ensure any secondary in-card action (bookmark, menu) stops event propagation so it doesn't also trigger the parent link.
- **Grid spacing**: cards in a set need visible gap from the spacing scale (typically 16–24px). Hairline `gap-px` flush grids are not the default for marketing feature cards — reserve flush only when deliberately building a bento mosaic.

## Multi-card carousel (show N of M)

Use when you have more equal-priority cards than fit cleanly in one row (e.g. 5 pillars, show 3) and discovery/rotation helps — not when every card is critical path (then prefer a static grid; Baymard/NN/g: important content must also exist outside autoplay).

### When to use
- Same card family, same structure, roughly equal priority
- ≤5–7 total items (users rarely engage past that)
- Marketing feature / product discovery — not dense B2B tables or dashboards

### Viewport & motion
- **Visible count by breakpoint**: 1 (mobile) → 2 (tablet) → 3 (desktop). Never shrink 3-up onto a phone.
- **Advance by one** (sliding window over a circular list) so each card eventually leads — or advance by page; pick one and keep it.
- **Transition**: slide the track with `transform: translateX` (and optional light opacity on edges) — **do not** remount the whole row with exit-to-blank (`AnimatePresence mode="wait"`). Cards and images should stay painted; blank flashes feel like reloads and hurt trust. Duration **450–700ms**, ease-in-out (e.g. `[0.22, 1, 0.36, 1]`). Avoid bounce.
- **Dwell / autoplay interval**: **3–7 seconds** on desktop if autoplay is on. Use **~3s** for short image-led cards with little copy; **5–7s** when cards carry denser reading. Not under 2.5s (too fast) or 12s+ (feels stuck).
- **`prefers-reduced-motion`**: disable autoplay; show a static N-up (or full grid) with manual controls only.

### Controls & a11y (required if rotating)
- Visible **prev/next** inside the carousel region; **dots or “1 / 5”** position indicator
- **Pause on hover and keyboard focus**; **stop autoplay after user interacts** with controls (Baymard)
- Prefer **no autoplay on mobile** — swipe / buttons only
- Wrapper: `aria-roledescription="carousel"`, labeled region; controls have accessible names; live region careful (usually `aria-live="off"` for autoplay so SRs aren’t spammed)
- Keep card internal structure identical to the static image-led pattern (image → icon → title → body)

### Pre-ship extras for carousels
- [ ] Visible count is 1 / 2 / 3 by breakpoint — not a squeezed 3-up on mobile
- [ ] Transition 450–700ms via track `translateX` (no full-row blank remount); dwell 3–7s if autoplay (≈3s for short cards)
- [ ] Autoplay pauses on hover/focus and after manual navigation; off under reduced-motion and preferably on mobile
- [ ] Prev/next + position indicator are visible and keyboard operable
- [ ] Every card remains reachable; critical claims also appear in non-carousel copy if needed

## Radius, following design-token-discipline

8–16px radius reads as modern and approachable — the current default for most product and marketing cards. Sharp, zero-radius corners are a legitimate deliberate choice for editorial or serious enterprise tones, but must then apply to every card in the product, not just some. Whatever radius is chosen, it's one value (or one small approved set — see design-token-discipline), never picked per-card.

## Grid density and responsiveness

- Desktop: 3–4 cards per row for product/content grids; dashboards typically read better with 2–3 larger cards per row rather than many small ones.
- Tablet: drop to 2 per row. Mobile: stack to 1 — never shrink a 3-up desktop grid to 3-up on a 375px screen by just scaling down; cards need real width to stay legible.
- Test the grid with real content at each breakpoint, including the longest realistic string — placeholder text at narrow widths hides truncation and wrapping problems that only appear with real data.

## States a real card system must cover

Every interactive card needs defined resting, hover, focus, pressed, and disabled states — not just a resting style with an ad hoc `:hover` opacity tweak. Focus states must be keyboard-visible (see accessibility-contrast-standards) — a card wrapped in a link or button needs a real focus ring, not just a mouse-hover effect that keyboard users never see. Loading and empty states for card grids use skeleton loaders that mirror the actual card structure (image block + text lines), not a generic spinner — see state-coverage-edge-cases.

## Pre-ship checklist
- [ ] One separation strategy (elevated / filled / outlined) is used as the product default — not mixed across card types without reason
- [ ] Shadows come from a defined, small elevation token set, applied identically to every card at the same structural role
- [ ] Every image-led card in a grid shares one fixed aspect ratio; images never distort or vary the card's proportions
- [ ] Image-led and content-led cards aren't randomly mixed within the same grid without a deliberate bento-style reason
- [ ] Every card has at most one primary action and at most 1–2 secondary actions
- [ ] No card uses more than three font sizes internally
- [ ] Uneven content length is handled deliberately (truncation, fixed height, or intentional masonry) — not left to create random gaps
- [ ] Radius is one consistent value across every card in the product
- [ ] Hover, focus, pressed, and disabled states are all defined — not just a resting style
- [ ] Card grids have a skeleton-loading state that mirrors the real card structure
- [ ] If using a multi-card carousel: visible N by breakpoint, 450–700ms ease, 3–7s dwell, pause/stop rules, and controls meet the carousel section above
