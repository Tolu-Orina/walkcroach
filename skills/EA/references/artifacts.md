# Architecture Artifacts — Structures

> Each structure below is a starting shape, not a form to fill in mechanically. Drop sections that don't earn their place; say so when you do. Every artifact ends with a **Decision / Ask**.

## Contents
1. Architecture Decision Record (ADR)
2. Solution / system design document
3. Target architecture
4. Reference architecture / pattern
5. Options analysis (incl. build-vs-buy)
6. Capability map
7. Standard or principle
8. ARCHITECTURE.md
9. Executive architecture brief
10. Diagram conventions

---

## 1. Architecture Decision Record (ADR)

The workhorse. One decision, one file, immutable once accepted — superseded by a new ADR rather than edited.

```markdown
# ADR-0042: <Decision stated as a claim, not a topic>

**Status:** Proposed | Accepted | Superseded by ADR-0057 | Deprecated
**Date:** YYYY-MM-DD
**Deciders:** <names/roles>
**Reversibility:** Two-way door (cheap to undo) | One-way door (expensive/impossible)

## Context
What forces this decision now. The constraints, the driver, what breaks if
nothing changes. Label verified / inferred / assumed.

## Decision
What we're doing, stated actively: "We will use X for Y."

## Dominant trade-off
What we are giving up to get this. Name it plainly.

## Options considered
| Option | Fit against ranked attributes | Why it lost |
|---|---|---|
| A (chosen) | … | — |
| B | … | <specific reason> |
| C (do nothing) | … | <specific reason> |

## Consequences
**Positive:** …
**Negative / accepted costs:** …
**What becomes harder later:** …

## Revisit trigger
Reopen this if: <measurable condition — load exceeds X, vendor changes Y,
team grows past Z>.

## Decision / Ask
<What is being approved, by whom, by when.>
```

**Title as a claim.** "ADR-0042: Use CockroachDB follower reads for admin dashboards" beats "ADR-0042: Admin dashboard data access".

## 2. Solution / system design document

For designing a system or significant feature now.

```markdown
# <System> — Design

## Summary
The recommendation in 3–5 sentences. Lead with it.

## Problem & drivers
What business/user problem, and what forces it now.

## Requirements
**Functional:** the capabilities.
**Quality attributes (ranked):** 1. … 2. … with measurable targets.
**Constraints:** fixed budget/date/vendor/regulation/team shape.
**Explicit non-goals:** what this deliberately does not do.

## Proposed design
Narrative first, then views (C4 context → container → component as needed).
Each diagram states the question it answers.

## Data model
Entities, ownership, lifecycle, retention, provenance.

## Interfaces
APIs/events/contracts, with versioning and compatibility approach.

## Failure modes & resilience
What breaks, blast radius, detection, degradation, recovery.

## Security & access control
Trust boundaries, authn/authz, secrets, data classification.

## Observability
What is logged/measured/alerted, and what question each answers.

## Cost model
Rough per-unit and at expected scale. Name the dominant cost driver.

## Alternatives considered
Options, and why each lost.

## Migration / rollout
Phasing, feature flags, rollback plan, backfill.

## Open questions & spikes
What is genuinely unknown, and what experiment resolves it.

## Decision / Ask
```

## 3. Target architecture

For "where should we be in 12–18 months". The four-part spine is the point — omit none of it.

```markdown
# Target Architecture — <domain>

## 1. Current state
What exists, honestly. Verified vs. inferred labelled. Include the pain.

## 2. Target state
Where we're going and *why that shape*. Traced to business drivers.

## 3. Gap analysis
| Gap | Impact if unclosed | Effort | Sequence position |

## 4. Migration path
**Now (0–3 mo):** …   **Next (3–9 mo):** …   **Later (9–18 mo):** …
Dependencies between steps. What can run in parallel.

## Dominant trade-off
## Risks & mitigations
## Decision / Ask
```

## 4. Reference architecture / pattern

For "how should we build things like this, generally". Distinguish carefully:

- **Pattern** — a reusable shape and its trade-offs, technology-agnostic.
- **Reference architecture** — a pattern bound to a specific stack, with defaults.
- **Implementation** — one concrete instance.

Conflating these is a common failure: teams copy an *implementation* when they needed the *pattern*, and inherit decisions that were specific to someone else's constraints.

```markdown
# Pattern: <name>

## Problem it solves
## When to use / when NOT to use    ← the second half matters more
## Structure (diagram + components)
## Trade-offs accepted
## Variations
## Anti-patterns / common misapplications
## Worked example
```

## 5. Options analysis (incl. build-vs-buy)

```markdown
# Options Analysis — <decision>

## Decision being made & who decides
## Ranked quality attributes (the scoring basis)
1. … 2. … 3. …

## Options
### Option A — <name>
Description · fit against each ranked attribute · cost (build + run) ·
risks · time-to-value · exit cost

(repeat; always include "do nothing / extend what exists")

## Comparison
| | A | B | C |
|---|---|---|---|
| Attribute 1 (highest weight) | | | |
| Total cost of ownership (3yr) | | | |
| Time to value | | | |
| Exit cost / lock-in | | | |

## Recommendation
One option. Reasoning. **What would have to be true for B to win instead.**

## Decision / Ask
```

For build-vs-buy specifically, weigh: is this a **core differentiator** (build) or **table stakes** (buy)? Buying table stakes and building differentiators is the default; inverting it is a strategic error that looks like an engineering preference.

## 6. Capability map

Business capabilities (what the organisation *does*), not systems or teams.

```markdown
# Capability Map — <domain>

## Level 1 capabilities
For each: current maturity (1–5) · strategic importance (H/M/L) ·
supporting systems · gap · investment signal (invest / sustain / divest)

## Heat view
Highlight: high importance + low maturity = investment priority.

## Investment recommendation
```

Capabilities are stable; systems and org charts are not. That stability is why the map stays useful across reorganisations — which is the main reason to build one.

## 7. Standard or principle

A standard without a compliance mechanism and an exception path is a suggestion.

```markdown
# Standard: <name>

**Statement:** <the rule, unambiguous and testable>
**Rationale:** why — traced to a driver, not to taste
**Applies to:** scope and boundaries
**Implications:** what teams must do differently
**Compliance measure:** how conformance is *detected* (ideally a fitness function)
**Exception path:** who approves a deviation, on what basis, for how long
**Review date:**
```

## 8. ARCHITECTURE.md

Durable orientation for a codebase. Written for someone joining in six months.

```markdown
# Architecture

## What this system does (and doesn't)
## System context — how it fits the wider platform
## Key design decisions   ← link to ADRs; summarise the "why" in one line each
## Component map — with the responsibility of each
## Data model & ownership
## Runtime view — request/job lifecycle for the 2–3 main flows
## Cross-cutting concerns — auth, logging, config, errors, secrets
## Known limitations & debt   ← honest; this section builds the most trust
## How to change things safely — extension points, dangerous areas, invariants
```

## 9. Executive architecture brief

One page or 5–7 slides. Answers *"do we fund this, and what's the risk?"*

- Claim-style headings — "Consolidating on one memory layer cuts integration cost 40%", not "Memory Architecture".
- Money, risk, time. No component diagrams.
- The recommendation on the first slide, not the last.
- One slide of alternatives and why they lost.
- Close on the Decision/Ask with a date.

## 10. Diagram conventions

- **State the question the diagram answers** above it. A diagram without a question is decoration.
- **C4 levels**: Context (systems and actors) → Container (deployable units) → Component (inside one container) → Code (rarely worth drawing). Pick the level that answers the question; don't produce all four by default.
- **One diagram, one idea.** If it needs a legend with more than five entries, split it.
- **Label the edges**, not just the boxes — what flows, in which direction, synchronously or not.
- Prefer Mermaid (diffable, reviewable in a PR) over binary image formats. This is the "architecture as code" property: the diagram evolves with the system instead of decaying beside it.