---
name: walkcroach-frontend-design
description: >-
  Master orchestrator for WalkCroach Web Builder and generated app UIs — elegant,
  consistent design with glassmorphism and motion micro-interactions. Decides which
  companion skills to load_skill (tokens, spacing, hierarchy, glass, Framer Motion,
  cards, photography, ambient, a11y, states, shadcn, landing vs dashboard, 3D).
  Use when creating or restyling pages, landing sections, app shells, or any UI that
  should avoid generic AI-template looks and respect Graphite Lumen when on-brand.
license: Apache-2.0 (adapted from anthropics/skills frontend-design)
origin: adapted:anthropics/skills/frontend-design + walkcroach frontend rules + design companions
---

# WalkCroach Frontend Design (Master)

You are the design lead for Builder output. This skill is the **router and taste layer**. Specialist companions hold the depth — call `load_skill` for them on demand (do not invent conflicting rules). Prefer 2–5 companions per build, not all of them.

Also available unpacked under `extras/<name>/SKILL.md` in this skill directory. Brand tokens: load `walkcroach-brand-guidelines` when the surface is WalkCroach-branded; customer brand wins for their creatives.

## Non-negotiable taste (always on)

1. **Elegance** — one signature idea; quiet everything else. Restraint beats decoration.
2. **Consistency** — one value per visual axis (radius, shadow, accent, icon set, type scale, card elevation).
3. **Style** — subject-grounded palette and type. WalkCroach-branded: Bricolage + Source Sans 3 + Graphite Lumen. Never Inter/Roboto/Arial defaults unless the brief demands it.
4. **Glassmorphism** — frosted surfaces as a first-class premium language when the brief allows atmosphere (not every dense admin table).
5. **Motion micro-interactions** — 2–3 intentional motions (enter, hover/press, one ambient or page beat). Support intent; never decorate randomly.

Avoid: purple-on-white / purple-indigo gradients, cream+terracotta cliché, broadsheet hairline layouts, dark-mode-by-default bias, emoji decoration, three identical feature cards with generic icons.

## Hard rules (WalkCroach product surfaces)

- **Edge-to-edge by default** — no floating chrome inset from the viewport. Header/nav flush to the top and sides (no top/side gutter around the bar). Hero, photo grids, and primary bands span the full width. Do not use a centered `max-w-*` page shell that leaves empty left/right gutters. Text may use modest horizontal padding; media and section backgrounds go full-bleed.
- One composition in the first viewport (not a dashboard unless it is a dashboard)
- Brand-first on branded pages; Graphite Lumen when WalkCroach-branded
- Atmospheric backgrounds (gradient / pattern / ambient), not flat single fills
- Full-bleed hero on landing/promo; no inset hero cards or floating collage
- Hero budget: brand, one headline, one support line, one CTA group, one dominant image
- No hero overlays (badges, chips, stickers)
- Cards only when they contain or organize interaction; then follow `walkcroach-card-design-system`
- One job per section
- Images: downloaded, generated, or hyperlinked — rights-cleared; verify remote URLs return 200 before shipping (`walkcroach-photography-imagery-language`)

## Copy

Active voice, plain verbs, sentence case. Errors explain how to fix. Empty states invite one action.

## Decision loop (every non-trivial UI)

```
Frontend plan:
- [ ] 1. Ground — subject, audience, single page job (+ project memory / brand)
- [ ] 2. Surface type — marketing | app/dashboard | hybrid
- [ ] 3. Signature stack — glass? ambient? motion? photo? 3D?
- [ ] 4. Core companions via load_skill (tokens, spacing, hierarchy, …)
- [ ] 5. Build from tokens
- [ ] 6. States + a11y
- [ ] 7. Critique / polish pass
```

### 1. Ground

Pin subject, audience, one job. Prefer project memory and prior brand choices. Compact token plan: 4–6 hexes, display+body faces, layout concept, one signature element.

### 2. Surface type → load_skill

| Surface | Always consider | Then |
|---|---|---|
| Marketing / landing / pricing | `walkcroach-landing-page-conversion-patterns` | photography, glass, ambient, motion, cards |
| App / admin / multi-role | `walkcroach-enterprise-dashboard-patterns` | tokens, spacing, states, a11y; glass sparingly |
| React + Tailwind + shadcn | `walkcroach-react-shadcn-component-architecture` | tokens + CVA variants |
| Any UI | `walkcroach-design-token-discipline` + `walkcroach-spacing-layout-system` + `walkcroach-visual-hierarchy-typography` | — |

### 3. Signature stack (elegance defaults)

Unless the brief is strictly utilitarian (dense data tool with no marketing chrome), **default toward**:

| Pillar | load_skill | Rule of thumb |
|---|---|---|
| Glass | `walkcroach-glassmorphism-elegant-surfaces` | Frosted panels over atmospheric bg; keep text contrast |
| Atmosphere | `walkcroach-ambient-bubble-background-effects` | Subtle orbs behind glass — low opacity, low motion |
| Motion | `walkcroach-framer-motion-micro-interactions` | CSS first for simple; Framer for orchestration; honor `prefers-reduced-motion` |
| Cards (when needed) | `walkcroach-card-design-system` | One elevation strategy: elevated **or** filled **or** outlined |
| Imagery | `walkcroach-photography-imagery-language` | Download, generate, or hyperlink; one grade/crop |

Skip 3D (`walkcroach-three-d-immersive-ui`) unless the brief explicitly needs spatial/product/WebGL — never as decoration.

### 4. Specialist router

| Concern | load_skill |
|---|---|
| Radii / shadows / accents drift | `walkcroach-design-token-discipline` |
| Padding / gaps / rhythm | `walkcroach-spacing-layout-system` |
| Flat hierarchy / competing CTAs | `walkcroach-visual-hierarchy-typography` |
| Icons | `walkcroach-icon-system-placement` |
| Alignment / one-off components | `walkcroach-component-alignment-consistency` |
| Contrast / keyboard / SR | `walkcroach-accessibility-contrast-standards` |
| Loading / empty / error / success | `walkcroach-state-coverage-edge-cases` |
| Cards | `walkcroach-card-design-system` |
| Color / type / light–dark themes | `walkcroach-color-typography-themes` |
| Photos / renders / imagery source | `walkcroach-photography-imagery-language` |
| Glass / frost | `walkcroach-glassmorphism-elegant-surfaces` |
| Bubbles / ambient orbs | `walkcroach-ambient-bubble-background-effects` |
| Animation / delight | `walkcroach-framer-motion-micro-interactions` |
| shadcn / CVA / theming | `walkcroach-react-shadcn-component-architecture` |
| 3D / R3F | `walkcroach-three-d-immersive-ui` |
| Landing conversion | `walkcroach-landing-page-conversion-patterns` |
| Dashboard / roles | `walkcroach-enterprise-dashboard-patterns` |
| WalkCroach brand tokens | `walkcroach-brand-guidelines` |
| Before calling it done | `walkcroach-design-critique-polish-workflow` |

## Default stacks (pick one, then add)

**A — Elegant marketing (preferred when taste is open)**  
`walkcroach-design-token-discipline` → `walkcroach-spacing-layout-system` → `walkcroach-visual-hierarchy-typography` → `walkcroach-landing-page-conversion-patterns` → `walkcroach-glassmorphism-elegant-surfaces` → `walkcroach-ambient-bubble-background-effects` → `walkcroach-framer-motion-micro-interactions` → `walkcroach-photography-imagery-language` and/or `walkcroach-card-design-system` → `walkcroach-accessibility-contrast-standards` → `walkcroach-design-critique-polish-workflow`

**B — Product / app shell**  
`walkcroach-design-token-discipline` → `walkcroach-spacing-layout-system` → `walkcroach-visual-hierarchy-typography` → `walkcroach-react-shadcn-component-architecture` (if applicable) → `walkcroach-state-coverage-edge-cases` → `walkcroach-accessibility-contrast-standards` → light `walkcroach-framer-motion-micro-interactions` → optional restrained glass on chrome → `walkcroach-design-critique-polish-workflow`

**C — Dense enterprise dashboard**  
`walkcroach-enterprise-dashboard-patterns` + core tokens/spacing/hierarchy + states + a11y + icons. Glass/ambient only if they don't hurt density or contrast.

## Build order

1. Tokens — `walkcroach-design-token-discipline` (+ brand guidelines when on-brand)
2. Layout rhythm — `walkcroach-spacing-layout-system`
3. Hierarchy + one primary CTA — `walkcroach-visual-hierarchy-typography`
4. Signature layer (glass + ambient + motion) without breaking contrast
5. Components from one system — no one-off buttons/cards
6. States for every data/submit surface
7. A11y (contrast, focus, labels, reduced motion)
8. Critique/polish last — `walkcroach-design-critique-polish-workflow`

## Conflict resolution

1. **Legibility & a11y** beat aesthetics
2. **Token consistency** beats one-off “prettier” values
3. **Motion/ambient** lose to clarity and `prefers-reduced-motion`
4. **Glass** loses if text/control contrast fails — raise tint/opacity or drop blur
5. Brief / customer brand / Graphite Lumen beat generic defaults

## Done means

- Self-critique: if it looks like any generic AI landing page, revise
- Mobile + keyboard focus + reduced motion
- Squint test: hierarchy still reads
- Glass/motion/cards companions actually applied when in the signature stack — not gestured at
