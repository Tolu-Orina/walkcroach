---
name: ambient-bubble-background-effects
description: Industry best practices for animated bubble, blob, and gradient-orb background effects in React/Tailwind UIs — subtlety, performance, accessibility, and coherence with the rest of the page. Use this skill whenever a build calls for a bubble background, floating blobs, ambient gradient spheres, or any decorative animated background motif, especially behind glassmorphism or hero sections.
---

# Ambient Bubble & Blob Background Effects

Animated bubble/blob backgrounds are a well-established web motif (CSS blob morphing, floating gradient orbs, particle bubbles) — but the line between "elegant ambient atmosphere" and "distracting novelty" is thin, and current best practice leans hard toward restraint, performance, and purpose over spectacle.

## Pick the right technique for the effect

- **CSS blob (border-radius morphing)** — a shape with organic, animated `border-radius` values (e.g. `border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%`, animated between a few keyframe states). Lightweight, no JS required, best for one or two large ambient shapes behind content.
- **Gradient orbs** — large, heavily-blurred radial-gradient circles (`filter: blur(80px)` or more) that drift slowly via `transform: translate()`. This is the dominant pattern behind modern glassmorphism ("dark glassmorphism") — smooth, vector-like color meshes rather than sharp particles, since sharp/high-frequency shapes create visible artifacts once blurred.
- **Particle/bubble field** (many small floating circles) — use only for genuinely playful/consumer contexts, sparingly, and via CSS transforms or a lightweight canvas — never DOM-heavy (hundreds of individually animated `<div>`s), which is a common real-world performance failure.

For enterprise/professional UI, gradient orbs or a single large morphing blob reads as premium and ambient; a dense particle bubble field reads as playful/consumer and is usually the wrong register for an enterprise-grade build unless the brief specifically calls for a lighter, more playful tone.

## Subtlety is the current best practice, not a compromise

Industry guidance in this space consistently converges on the same points: gentle movement over expressive motion, muted/low-opacity color over saturated fills, and background elements that support the foreground rather than compete with it. A background that draws the eye before the content does has failed its job. Concretely:
- Keep opacity low (typically 10–30%) and blur heavy enough that shapes read as atmosphere, not distinct objects
- Keep movement slow (think 15–40 second loop durations) and small in amplitude — drifting, not bouncing
- Limit to 2–4 shapes per view; more than that adds visual noise without adding perceived depth

## Coherence with the page's token system

Blob/orb colors must be drawn from the established palette (see design-token-discipline), not introduced as one-off decorative hues — a background using colors that don't appear anywhere else in the UI reads as bolted-on. If the product's accent is amber and a secondary is teal, the ambient shapes should be built from those same tokens at low opacity, not a separate "pretty gradient" palette invented just for the background.

## Performance discipline

- Animate `transform` (translate/scale) only — never animate `width`, `height`, `top`/`left`, or the blur radius itself frame-by-frame, all of which force expensive repaints.
- A single `filter: blur()` element is cheap; many overlapping blurred elements compound cost fast — test with more than 2-3 simultaneous blurred/animated shapes before shipping, on a mid-tier device, not just a dev machine.
- Prefer `position: fixed` or `absolute` shapes contained in a dedicated background layer (`z-index` isolated, `pointer-events-none`) rather than shapes interleaved with real content in the DOM flow.

## Accessibility requirements

- Mark purely decorative bubble/blob elements `aria-hidden="true"` so they never reach the accessibility tree or add screen-reader noise.
- Wrap all looping/morphing motion in `@media (prefers-reduced-motion: reduce)` and snap to a static frame (a fixed gradient, no animation) rather than simply slowing the loop — reduced motion means stopped, not "less."
- Never let a bubble/blob shape reduce text contrast where it overlaps content — if a shape drifts under a heading or button, verify contrast still holds at that specific position, not just in the shape's "resting" position.

## Pre-ship checklist
- [ ] The chosen technique (CSS blob / gradient orb / particle field) matches the product's register — enterprise builds default to gradient orbs or a single morphing blob, not a dense particle field
- [ ] Shape colors come from the existing design tokens, not a separate one-off palette
- [ ] Opacity is low and motion is slow — background reads as atmosphere, never competes with foreground content
- [ ] No more than 2–4 animated shapes appear in one view; only `transform`-based properties are animated
- [ ] Decorative shapes are `aria-hidden`, contained in an isolated background layer, and respect `prefers-reduced-motion` by stopping, not just slowing
- [ ] Contrast was checked with shapes in their worst-case overlapping position, not just their resting position
