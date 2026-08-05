---
name: walkcroach-color-typography-themes
description: >-
  Modern color and typography systems for light and dark modes — semantic tokens,
  OKLCH palettes, WCAG 2.2 AA floor plus APCA perceptual checks, and type/contrast
  coupling. Use when setting up a design system, theming, dark mode, choosing
  text/background pairs, or when contrast fails after a palette or mode switch.
  Pair with design-token-discipline and accessibility-contrast-standards.
---

> WalkCroach Web skill — companion to `walkcroach-frontend-design` and `walkcroach-brand-guidelines`. Prefer Graphite Lumen when on-brand; customer brand tokens win for customer creatives. Pair with `walkcroach-accessibility-contrast-standards`.
# Color & Typography Themes (Light / Dark)

Color combinations and type choices are not independent: the same hex pair can pass or fail contrast depending on **mode polarity**, **font size**, and **weight**. Build themes so light and dark are designed as peer systems — never a naive invert.

## Architecture (2025–2026 practice)

Use three layers (W3C DTCG-style / modern design-system consensus):

1. **Primitive tokens** — raw ramps (e.g. `neutral-50…950`, `brand-50…950`), ideally authored in **OKLCH** for perceptually even steps (HSL lightness is not uniform across hues).
2. **Semantic tokens** — roles that UI code consumes: `bg-canvas`, `bg-surface`, `bg-raised`, `text-primary`, `text-muted`, `border-subtle`, `accent`, `danger`, `success`, `focus-ring`.
3. **Component tokens** (optional) — map semantics into buttons, inputs, cards.

**Dark mode remaps semantic → different primitives.** Do not flip every light color with `filter: invert()` or swap only `background`/`color` once and hope. Each role needs a light pair and a dark pair that both pass contrast.

```css
:root {
  --bg-canvas: var(--neutral-50);
  --text-primary: var(--neutral-950);
  --accent: var(--brand-600);
}
[data-theme="dark"] {
  --bg-canvas: var(--neutral-950);
  --text-primary: var(--neutral-100); /* not pure #fff on #000 */
  --accent: var(--brand-400); /* lighter stop — don’t reuse brand-600 blindly */
}
```

Prefer `color-scheme: light dark` and a class/`data-theme` toggle; respect `prefers-color-scheme` as the default when the user hasn’t chosen.

## Contrast: WCAG floor + APCA quality

| Role | WCAG 2.2 AA (legal floor) | APCA guidance (perceptual, esp. dark UI) |
|---|---|---|
| Body / UI text | ≥ 4.5:1 | \|Lc\| ≥ ~75 fluent body |
| Large text (≈18pt+/14pt bold+) | ≥ 3:1 | \|Lc\| ≥ ~60 |
| Icons, borders, focus rings (non-text) | ≥ 3:1 | \|Lc\| ≥ ~45 |
| Decorative | no requirement | keep low; never rely on it for meaning |

**Why both:** WCAG 2.x uses a single luminance ratio and treats light-on-dark the same as dark-on-light. Humans don’t. **APCA** produces a signed Lc that respects polarity — critical for dark themes and thin weights, which WCAG often mis-scores. Practice for 2026: **ship WCAG 2.2 AA; design/audit with APCA as the quality bar.**

### Mode-specific pitfalls
- Pure `#000` + `#fff` is harsh and often worse for long reading — soften neutrals (off-black canvas, off-white paper).
- Accents that work on light surfaces often fail on dark — pick a **lighter ramp stop** for dark (`400–500`) and a **darker stop** for light (`600–700`), each checked against its surface.
- Muted text (`text-muted`) is the first thing to fail in both modes — re-check every muted pair; don’t copy light-mode opacity (e.g. `white/60`) into dark without measuring.
- Text on images/gradients needs an overlay or scrim that guarantees the floor at the worst pixel, not the average.

## Typography that survives both modes

Contrast requirements scale with **size and weight** — a 12px regular caption needs more contrast than a 32px semibold display line.

- Define one **type scale** and one **weight set** (usually regular + semibold/bold; display may add a third). See `visual-hierarchy-typography`.
- Pair faces deliberately: one display + one UI/body. Avoid default Inter/Roboto/Arial stacks unless the brand requires them.
- In dark mode, prefer slightly **heavier body weight or larger size** if APCA flags thin light-on-dark text — don’t only crank hex brightness.
- Line length ~45–75ch; body line-height ~1.5; headings tighter (~1.1–1.3).
- Never encode hierarchy with color alone — size/weight/space first; color second (`accessibility-contrast-standards`: no meaning by color only).

## Semantic checklist for a dual-theme product

For **each** of light and dark, verify:
- [ ] `text-primary` on `bg-canvas` and on `bg-surface` / `bg-raised`
- [ ] `text-muted` on those surfaces (usually the weakest link)
- [ ] `accent` as text and as filled button (text-on-accent)
- [ ] `danger` / `success` text and filled states
- [ ] Borders/focus rings ≥ 3:1 against adjacent background
- [ ] Glass/translucent panels: solid fallback under `prefers-reduced-transparency` / high contrast; text still passes on the worst backdrop

## Process

1. Seed brand + neutral in OKLCH; generate 11-stop ramps (50–950).
2. Map semantic tokens for light; remap for dark (don’t invert).
3. Audit every semantic pairing with WCAG 2.2 AA; spot-check APCA on body/muted/dark.
4. Lock type scale; re-test muted/caption sizes after mode switch.
5. Document tokens in CSS variables / theme file — components reference semantics only.

## Related skills
- `design-token-discipline` — one value per axis; no hardcoded hex in components
- `accessibility-contrast-standards` — WCAG/APCA floor, keyboard, non-color cues
- `visual-hierarchy-typography` — scale, weight, hierarchy levers
- `glassmorphism-elegant-surfaces` — tinted glass contrast + reduced-transparency fallback
