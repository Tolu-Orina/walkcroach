---
name: framer-motion-micro-interactions
description: Enterprise-grade motion design for React/Tailwind/shadcn UIs using Framer Motion — when to reach for it over CSS, orchestration and easing principles, performance discipline, and reduced-motion support. Use this skill whenever adding animation, transitions, hover/press states, page transitions, or "delightful" micro-interactions to a React build, or reviewing a build where motion feels janky, gratuitous, or inconsistent.
---

# Framer Motion & Micro-Interactions

Motion should support intent, not decorate it. In a well-built React/Tailwind/shadcn system, motion is a layer on top of a UI that already works without it — not the foundation the UI depends on to feel finished.

## Reach for CSS first, Framer Motion second

Plain Tailwind/CSS transitions are sufficient for most cases and have zero runtime cost:
- Hover and focus transitions (`transition-colors`, `transition-transform`)
- Simple fades and slides via `@keyframes`
- Loading states, dropdown/tooltip open-close motion

Reach for Framer Motion specifically when the animation depends on component state that CSS can't express cleanly: shared layout transitions between two different DOM positions (`layoutId`), animating in response to data changes, gesture-driven interaction (drag, swipe), or orchestrating a sequence across multiple children (`staggerChildren`). If it can be expressed in CSS, it probably should be — this keeps the UI simpler, more predictable, and lighter.

## Orchestration over scattered effects

An orchestrated moment — one sequence with clear timing across a few elements — reads as intentional. Several unrelated elements animating independently on load reads as noisy. When multiple items enter together (a card grid, a list), use `staggerChildren` with a small delay (40–80ms) rather than animating every item with an identical, simultaneous transition — the stagger is what makes it feel choreographed instead of triggered all at once.

## Easing and duration discipline

- **Duration**: most UI micro-interactions belong in the 150–350ms range. Under 100ms reads as a glitch; over 500ms starts to feel sluggish for anything the user directly triggered (hover, click, toggle). Page-level or hero-moment transitions can run longer (400–800ms).
- **Easing**: avoid linear easing for anything meant to feel natural — use spring physics (Framer Motion's `type: "spring"`) for interactive, physical-feeling elements (drag, press feedback, modal entrance) and standard eased curves (`easeOut` for entrances, `easeIn` for exits) for simpler fades/slides.
- **Physics-based interpolation** (spring, with mass/stiffness/damping tuned per element) reads as more premium than fixed-duration tweening for anything meant to feel tactile — a button press, a card lifting on hover — but is overkill for a simple opacity fade.

## Isolate motion, don't rewrite primitives

Keep Framer Motion logic in a thin wrapper component around a shadcn primitive (`motion(Button)` or a wrapping `motion.div`) rather than editing the shadcn source component directly — this keeps the underlying primitive re-runnable via the shadcn CLI and keeps all motion logic auditable in one place. See react-shadcn-component-architecture for the fuller component-boundary rationale.

## Performance discipline

- Animate `transform` and `opacity` wherever possible — these are compositor-only properties and don't trigger layout/paint. Animating `width`, `height`, `top`/`left`, or box-shadow directly is expensive; use `transform: scale()`/`translate()` and a pre-blurred pseudo-element instead where a shadow needs to "grow."
- Use `will-change` sparingly and only on elements actively animating — leaving it on permanently wastes GPU memory.
- For lists/grids with many animated items, cap simultaneous animating elements or virtualize — animating hundreds of DOM nodes at once is a common real-world jank source, distinct from any single animation being "too slow."

## Reduced motion is mandatory, not optional

Respect `prefers-reduced-motion` at the system level: wrap decorative/ambient animation (looping background motion, parallax, large entrance transitions) so it's disabled or reduced to a simple opacity fade for users who've set this preference. Functional motion that conveys state change (e.g., a checkbox toggling) can keep a very short transition even under reduced motion, but anything purely ornamental should stop.

## Pre-ship checklist
- [ ] Every animation that could be pure CSS is pure CSS; Framer Motion is used only where state/gesture/orchestration genuinely requires it
- [ ] Multi-element entrances use staggered timing, not identical simultaneous animation
- [ ] Interactive micro-interactions land in the 150–350ms range; nothing user-triggered exceeds ~500ms
- [ ] Animations primarily transform `transform`/`opacity`, not layout-triggering properties
- [ ] `prefers-reduced-motion` disables or minimizes all decorative/ambient motion
- [ ] Motion logic lives in wrapper components, not inside edited shadcn primitives
