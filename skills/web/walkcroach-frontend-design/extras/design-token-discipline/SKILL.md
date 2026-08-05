---
name: design-token-discipline
description: Enforces "one choice per visual axis" — a single corner radius, shadow style, accent color, and light source repeated everywhere — to eliminate the generic "AI slop" look in generated UIs. Use this skill at the start of any new UI build to establish tokens, and whenever reviewing a build where components feel like they came from different designers, look inconsistent, or use varying radii/shadows/colors across screens.
---

# Design Token Discipline

Every individual design choice an AI makes can be defensible in isolation — a 12px radius here, an 8px radius there, a soft shadow on one card and a hard shadow on another. Together, these small variations signal "assembled from parts," because a real designer would never make all of them differently on the same screen. The fix is choosing one value per axis and repeating it without exception.

## The axes to lock down before writing any component code

Define these once, in a tokens file (CSS variables, a Tailwind config, or a design-tokens.json), and reference them everywhere — never hardcode a raw value in a component:

1. **Corner radius** — one value for all cards/inputs/buttons (e.g. `--radius: 8px`), optionally one larger value for modals/large containers. Not three or four different radii across the product.
2. **Shadow** — one elevation style for resting cards, one for hovered/active state, one for modals/overlays. Do not let shadows vary in blur/spread/opacity from component to component.
3. **Accent color** — exactly one primary action color used for all primary CTAs, links, and focus states. A second, distinct color only for destructive actions. No third "just for this button" color.
4. **Icon set** — see icon-system-placement skill; one library, referenced as a token where possible.
5. **Light source / depth model** — decide once whether elevation is communicated via shadow-down, border, or flat-with-color, and use that model consistently — don't mix a neumorphic shadow style with flat bordered cards on the same screen.
6. **Type scale** — a fixed set of font sizes/weights (see visual-hierarchy-typography skill) referenced as tokens, not ad hoc `font-size: 15px` calls.

## Why constraint works better than instruction

Telling an AI builder "make it look premium" or "be more creative with spacing" does not reliably work — it just produces a different flavor of inconsistency. What works is restricting the solution space: give the agent a token file and instruct it that **every value must come from the token file, with no exceptions**, then have it audit its own output against that file before calling the work done. Constraining what the agent can choose is what makes its output cohere.

## Reference grounding beats adjectives

Before generating, provide 1–3 actual screenshots of reference UIs that represent the target quality bar (e.g. Linear, Stripe, Vercel dashboards for enterprise SaaS). Have the agent derive its token values FROM those references rather than inventing them from a text description. A picture constrains far more effectively than a word like "modern" or "professional," which means different things to different models and different people.

## Setting this up in a build

At the start of a new project or major feature, produce (or update) a single source-of-truth tokens file covering: color palette (including semantic tokens like `--color-success`, `--color-danger`), spacing scale (see spacing-layout-system skill), radius, shadow, and type scale. Every component built afterward must import from this file — flag and fix any component with a hardcoded raw value instead of a token reference.

## Pre-ship audit
- [ ] Grep the codebase for hardcoded hex colors, px radii, and shadow values outside the token file — every hit is a violation to fix
- [ ] Every card/button/input in the product uses the same radius value (or one of the two approved radius tiers)
- [ ] Only one shadow "recipe" exists per elevation level, applied consistently
- [ ] Only one primary accent color is used for all primary actions across every screen
- [ ] Token file was derived from real reference screenshots, not invented from adjectives alone
