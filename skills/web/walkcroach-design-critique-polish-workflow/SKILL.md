---
name: walkcroach-design-critique-polish-workflow
description: A multi-phase build process (explore, critique, converge, refine, audit, polish) that replaces single-pass AI UI generation with the iterative process real designers use. Use this skill for any non-trivial UI build — full pages, multi-component features, or full applications — rather than generating final output in one shot. Especially use when a first-pass build "looks fine but somehow wrong," or before declaring any substantial UI build finished.
---

> WalkCroach Web skill — companion to `walkcroach-frontend-design`. Prefer Graphite Lumen tokens when the surface is WalkCroach-branded; customer brand tokens win for customer creatives.
# Design Critique & Polish Workflow

No professional designer ships final output in a single pass. AI agents are capable of executing each phase of a real design process well — they're weak at compressing all phases into one generation. This skill decompresses that process back into its natural phases so quality compounds instead of getting averaged-out in a single attempt.

## The six phases

1. **Explore** — generate 2–3 structurally different directions for the layout/component before committing to one (e.g., different information architecture for a dashboard, different hero layout for a landing page). Don't lock in the first idea.
2. **Critique** — before any visual polish, evaluate the chosen direction against structure and usability: Is the information hierarchy clear? Does the primary user flow make sense? Are there missing states or unclear affordances? A beautifully polished interface with broken information hierarchy is still a bad interface — do not skip this step to get to the satisfying "make it pretty" part.
3. **Converge** — pick one direction (informed by the critique) and commit; stop branching.
4. **Refine** — build out the full interface honestly, including secondary states and edge cases (loading, empty, error — see state-coverage-edge-cases skill), not just the primary happy-path screen.
5. **Audit** — check the built result against the project's design tokens, spacing scale, icon system, and accessibility floor (see the relevant skills) — catch drift before it ships, using a checklist rather than a vibe check.
6. **Polish** — the final micro-detail pass: alignment, spacing consistency, visual rhythm, optical adjustments. This is what separates "done" from "crafted," and it should be the LAST step, not the first thing attempted.

## Why order matters

Jumping straight to polish on a structurally weak layout wastes effort — you'll polish something that needs to be rebuilt anyway once the critique step reveals a hierarchy or flow problem. Running critique before refine catches expensive problems while they're still cheap to fix.

## Verification, not self-report

At the audit and polish stages, verify by rendering and looking at a screenshot of the actual output — not by reading the generated code and assuming it's correct. Code that looks right in the editor can still render with visual misalignment once real content and breakpoints are involved. The "squint test" (shrink the render to thumbnail size and check whether hierarchy and section rhythm still read clearly) is a fast, reliable check at this stage.

## Practical application in a single conversation

When asked to build something substantial, don't produce one giant finished file immediately. Instead: state the 2–3 structural directions briefly, pick the strongest with a one-line rationale (or ask which the user prefers), build it fully with all states, then do an explicit audit pass against the token/spacing/icon/accessibility skills before presenting it as finished. For smaller, well-specified components, the full six-phase process can compress — but the critique and audit steps should never be skipped entirely, even for a single component.

## Pre-ship checklist
- [ ] More than one structural direction was considered before committing, for anything non-trivial
- [ ] A critique pass happened before visual polish — hierarchy and flow were checked, not assumed
- [ ] The build was audited against the project's spacing, token, icon, and accessibility standards, not just eyeballed
- [ ] A final polish pass specifically targeted alignment and spacing consistency, done last
- [ ] The finished result was verified by viewing a render/screenshot, not just by reading the code
