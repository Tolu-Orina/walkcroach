# Quality Attributes, NFRs, and Fitness Functions

> Architecture is mostly the business of choosing which quality attributes to favour at the expense of others. Getting these explicit and ranked is the highest-leverage thing to do early — most bad architecture traces back to unranked or unstated attributes.

## Contents
1. The ranking discipline
2. ISO 25010 coverage checklist
3. Quality-attribute scenarios
4. Common tensions
5. Fitness functions
6. SLIs, SLOs, error budgets

---

## 1. The ranking discipline

"Fast, reliable, secure, and cheap" is not a requirement set — it's a wish. Force three things:

1. **Rank them.** Which two dominate? "All of them" isn't an answer; the ranking is what decides the design when they conflict.
2. **Make them measurable.** Replace adjectives with numbers and conditions.
3. **State the acceptable failure.** For each attribute, what degradation is tolerable? This is often more informative than the target.

**Before → after:**

| Vague | Usable |
|---|---|
| "Must be fast" | "p95 < 300 ms for interactive reads at 500 concurrent sessions; p99 < 1 s" |
| "Highly available" | "99.5% monthly; a failed deploy must not take down the previous version" |
| "Should scale" | "Handle 10× today's row count without retrieval p95 exceeding 1.5 s" |
| "Secure" | "No credential reachable from client-side JS; verified by an automated leak scan in CI" |
| "Maintainable" | "A new surface can consume the memory API without changes to the memory service" |

The middle column is a wish; the right column can be **tested**, which is what makes it survive past the design document.

## 2. ISO 25010 coverage checklist

Run through these when eliciting. Most projects need 3–5 seriously and can consciously deprioritise the rest — the value is in *conscious* deprioritisation rather than silent omission.

- **Functional suitability** — completeness, correctness, appropriateness
- **Performance efficiency** — time behaviour, resource use, capacity
- **Compatibility** — co-existence, interoperability
- **Interaction capability** (usability) — learnability, operability, accessibility, error protection
- **Reliability** — maturity, availability, fault tolerance, recoverability
- **Security** — confidentiality, integrity, non-repudiation, accountability, authenticity, resistance
- **Maintainability** — modularity, reusability, analysability, modifiability, testability
- **Flexibility** (portability) — adaptability, installability, replaceability, scalability
- **Safety** — operational constraint, risk identification, fail-safe, hazard warning

Two additions worth treating as first-class for this platform, though not ISO categories:

- **Observability** — can you tell what happened, after the fact, without reproducing it?
- **Cost efficiency** — unit economics at expected scale, not just total spend.

## 3. Quality-attribute scenarios

The most reliable way to make an NFR testable. Six parts:

```
Source      — who/what triggers it
Stimulus    — the event
Artifact    — what part of the system
Environment — under what conditions (normal / peak / degraded)
Response    — what the system does
Measure     — the observable threshold
```

**Example:**
> **Source** a signed-in user · **Stimulus** submits a prompt that triggers memory recall · **Artifact** the recall path (vector index + API) · **Environment** at 500 concurrent sessions, index at 1M rows · **Response** returns ranked results and streams the first token · **Measure** recall p95 ≤ 1.5 s; first token p50 ≤ 2.5 s.

Write 5–10 of these for a significant system. They become the acceptance criteria, the load-test spec, and the alert thresholds — one artifact, three uses.

## 4. Common tensions

Name which side you're taking, and why.

| Tension | The real question |
|---|---|
| Consistency ↔ availability | On partition, do you refuse or serve possibly-stale data? |
| Latency ↔ durability | Ack before or after the write is safely replicated? |
| Flexibility ↔ simplicity | Is the generality paid for by a *known* future need? |
| Security ↔ usability | Where does friction genuinely buy safety, vs. train people to click through? |
| Cost ↔ resilience | What is an hour of downtime actually worth? |
| Speed now ↔ optionality later | Is this a one-way door? |
| Autonomy ↔ control (agents) | Which actions can never be auto-approved? |

## 5. Fitness functions

An **architecture fitness function** is any objective, repeatable mechanism that assesses whether an architectural characteristic still holds. The term is borrowed from evolutionary computation. The point is that architecture decays silently without one — a document says the system is decoupled; only a test proves it still is.

They can be unit tests, ArchUnit-style dependency tests, performance benchmarks, chaos runs, monitoring alerts, license scans, or scheduled manual reviews. The defining property is **objectivity**: measurable and repeatable, not a matter of opinion.

**Four layers to cover:**

| Layer | Governs | Examples |
|---|---|---|
| **Structural** | Code dependencies, boundaries, contracts | No module outside `memory/` imports the vector client; API schema is backward-compatible |
| **Behavioural** | Latency, throughput, resilience, consistency | Recall p95 under threshold; retry budget not exceeded |
| **Operational** | Deployability, observability, runbooks, SLO compliance | Every new Lambda emits structured logs; synthetic smoke test passes |
| **Semantic** | Domain integrity, naming, ownership | Every `memory_entries` write carries provenance; no orphaned tables |

Semantic fitness is where architecture programmes get serious, and it's the layer most often skipped.

**Rules that keep them from being ignored:**

- **They must live where engineers work** — source control, CI, observability tooling. A check that lives in a wiki does not exist.
- **Fast.** A 40-minute gate gets routed around. If it's slow, run it nightly and alert on trend rather than blocking every commit.
- **Checklist, not stick.** Prioritise per function per context — the same check may be blocking for a security-critical service and advisory for internal tooling. Architects who make everything a hard gate get overruled or ignored.
- **Soft warnings matter**: rising dependency counts, deepening call chains, drifting service autonomy. Trend alerts catch decay that pass/fail gates miss.

**WalkCroach applications, concretely:** the existing secret-leak scan is already a structural fitness function. The absent-monitoring gap means there are currently no behavioural or operational ones — that is the largest fitness gap on the platform.

## 6. SLIs, SLOs, error budgets

- **SLI** — the measured indicator (request success rate, p95 latency, freshness).
- **SLO** — the target for that indicator over a window (99.5% monthly).
- **Error budget** — the permitted shortfall (0.5% ≈ 3.6 h/month). This is the *useful* part: it converts reliability from an argument into arithmetic. Budget remaining → ship features. Budget exhausted → reliability work takes priority.

**Choose SLIs the user would notice.** CPU utilisation is not an SLI; "did the user's build succeed" is. Pick 2–4 per service; more than that and none of them drive behaviour.

Set SLOs from what the business actually needs, not from what's technically achievable — then discover whether the gap requires investment or an expectation reset. A 99.99% target nobody needs is expensive; a 99% target on a paid product is a support problem waiting to happen.