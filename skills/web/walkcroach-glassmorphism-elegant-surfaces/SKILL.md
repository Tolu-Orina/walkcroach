---
name: walkcroach-glassmorphism-elegant-surfaces
description: Enterprise-grade glassmorphism ("frosted glass") design system for React/Tailwind/shadcn UIs — layering, blur/tint discipline, contrast and accessibility fallbacks, and where glass is and isn't appropriate. Use this skill whenever a build calls for glass, frosted, translucent, or "liquid glass" surfaces, elegant layered UI, or premium/modern shading effects. Pair with accessibility-contrast-standards and design-token-discipline.
---

> WalkCroach Web skill — companion to `walkcroach-frontend-design`. Prefer Graphite Lumen tokens when the surface is WalkCroach-branded; customer brand tokens win for customer creatives. Respect `prefers-reduced-motion` and keep motion/effects within the 2–3 intentional budget.
# Glassmorphism & Elegant Surfaces

Glassmorphism — translucent panels with background blur, floating over a layer beneath — is now a mainstream pattern (Apple's Liquid Glass, Microsoft Fluent Design), but it's also one of the easiest styles to break: a small change in blur, opacity, or background can flip a component from elegant to unreadable.

## What needs to exist behind the glass

Glass has nothing to distort against a flat, low-contrast background — it becomes invisible or muddy. Always place glass surfaces over something with real tonal variation: a soft gradient mesh, ambient color orbs, a photograph, or patterned content — never a single flat color. Avoid high-frequency noise or busy imagery directly behind glass; it creates distracting artifacts once blurred. Smooth, vector-like gradients behind the glass produce the cleanest result.

## The core recipe (Tailwind)

```
bg-white/10 backdrop-blur-xl border border-white/20 shadow-lg
```
- **Background opacity**: 8–20% white (light glass) or 8–20% black (dark glass) — much higher and it stops reading as transparent; much lower and there's nothing to distinguish the panel edge.
- **Blur**: `backdrop-blur-md` to `backdrop-blur-xl` depending on panel size — larger panels can support more blur without losing all sense of what's behind them.
- **Border**: a subtle 1px border (`border-white/20` or similar) is close to non-negotiable — it's what defines the panel's edge once the fill is translucent, since a translucent surface has almost no natural edge contrast of its own.
- **Layer count**: avoid stacking more than 2 overlapping blurred layers in one view — beyond that, both visual clarity and paint/compositing performance degrade.

## One glass "material," used consistently

Pick one blur value and one tint value as the project's glass token pair (e.g. `--glass-blur: 16px; --glass-tint: 12%`) and reuse it everywhere glass appears — navigation, modals, cards. Don't let one panel use heavy blur and another use almost none; inconsistent glass reads the same way inconsistent shadows or radii do (see design-token-discipline).

## Accessibility is not optional — build the fallback layer in from day one

- **Contrast**: text on glass must hit at least 4.5:1 against whatever is actually behind it at its most adverse position — not just the panel's average color. Use white/near-white text on dark glass and near-black text on light glass; avoid mid-tone text on glass entirely, since it's the first thing that fails contrast checks as backgrounds shift underneath it.
- **Reduced transparency**: honor the OS-level "reduce transparency" preference (`prefers-reduced-transparency` where supported, otherwise treat `prefers-contrast: more` as a proxy) by swapping glass panels to a solid, high-contrast surface — this isn't a nice-to-have, it's the equivalent of `prefers-reduced-motion` for transparency.
- **Never rely on blur alone to separate content** — pair it with the border and, where two glass panels overlap, a subtle shadow so users with low vision or high zoom can still parse panel boundaries.

## Where glass belongs — and where it doesn't

- **Good fits**: navigation bars, modals/overlays, floating toolbars, highlight cards, notification panels — short, glanceable surfaces where users aren't reading for long.
- **Bad fits**: long-form reading surfaces, dense data tables, forms with many fields — legibility over an extended reading session degrades exactly where glass adds the least value. Use solid, opaque surfaces for these regardless of how "on brand" glass feels elsewhere.

## Motion pairs naturally with glass, in restraint

A subtle response on interaction (a faint highlight ripple, a slight blur/opacity shift on press) reinforces the "physical glass" metaphor, but should stay understated — this is a supporting detail, not the page's signature move. See framer-motion-micro-interactions for how to implement this without it becoming distracting.

## Pre-ship checklist
- [ ] Every glass panel sits over a gradient, image, or other tonally-varied background — never a flat single color
- [ ] One blur value and one tint value are reused across every glass surface in the product
- [ ] Text on every glass panel passes a 4.5:1 contrast check against the panel's most adverse real background state
- [ ] A solid, opaque fallback exists and activates under reduced-transparency/high-contrast preferences
- [ ] No more than 2 overlapping blurred glass layers appear in any single view
- [ ] Glass is used only on short/glanceable surfaces — long-form content and dense tables use solid backgrounds
