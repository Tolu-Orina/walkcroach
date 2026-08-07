# Review and Readiness Checklists

> Checklists are for *catching omissions*, not for scoring. A design that "passes" every item can still be wrong; a design that fails three items may be entirely correct with three documented, accepted risks. Use these to find what wasn't considered — then judge.

## Contents
1. Architecture review
2. Production readiness
3. Security review
4. Agentic-system review
5. Reviewing someone else's design (conduct)

---

## 1. Architecture review

**Problem and requirements**
- [ ] The actual problem is stated, not just the proposed solution
- [ ] Business driver named — and the design traces back to it
- [ ] Quality attributes ranked and measurable (not adjectives)
- [ ] Explicit non-goals
- [ ] Constraints stated (budget, date, vendor, regulatory, team shape)

**Design**
- [ ] At least two real options considered; "do nothing / extend what exists" among them
- [ ] The dominant trade-off is named, not buried
- [ ] Rejected options have specific reasons, not hand-waves
- [ ] Component responsibilities are singular and clear
- [ ] Interfaces and contracts defined, with a versioning approach
- [ ] Data ownership unambiguous — one system of record per entity
- [ ] Failure modes analysed per component (fails how / detected how / blast radius / recovery)
- [ ] Boundaries align with team shape (Conway's Law check)
- [ ] Complexity is justified by a named requirement, not anticipated need

**Durability**
- [ ] Fitness function, revisit trigger, or owner defined
- [ ] Reversibility assessed — two-way door vs. one-way door
- [ ] Migration/rollout path, including rollback
- [ ] Cost model at expected scale, with the dominant driver named

**Communication**
- [ ] Written at the right altitude for its audience
- [ ] Claims labelled verified / inferred / assumed
- [ ] Ends with a Decision / Ask
- [ ] Someone who disagrees can locate exactly where they disagree

## 2. Production readiness

Ordered roughly by how often each is the thing actually missing.

**Observability** *(most commonly absent)*
- [ ] Structured logs sufficient to trace one user action end to end
- [ ] Metrics for the SLIs that matter (not just CPU)
- [ ] Alerts on user-visible symptoms, routed to someone on call
- [ ] Distributed tracing across service boundaries
- [ ] Per-tenant attribution on logs, metrics, and cost
- [ ] A synthetic check exercising the critical path on a schedule
- [ ] Dashboards answer specific questions, rather than displaying everything available

**Reliability**
- [ ] SLOs defined with error budgets
- [ ] Timeouts on every remote call
- [ ] Retries with backoff and jitter, on idempotent operations only
- [ ] Circuit breakers on external dependencies
- [ ] Graceful degradation defined for each dependency failure
- [ ] Load tested at expected peak, and beyond it
- [ ] Rollback tested, not just documented

**Security and access**
- [ ] Least-privilege credentials, scoped per tenant/project
- [ ] No secret reachable from client-side code (verified automatically, not by review)
- [ ] Secrets in a managed store, rotatable
- [ ] Authn and authz at every trust boundary
- [ ] Audit trail sufficient to reconstruct an incident
- [ ] Data classification, retention, and deletion path defined

**Operations**
- [ ] Runbook for the top 3 predictable failures
- [ ] Deploy is automated, repeatable, and reversible
- [ ] Config separated from code; environment parity understood
- [ ] Backup *and a tested restore* (an untested backup is a belief)
- [ ] Capacity headroom known, with a scaling trigger
- [ ] Cost monitored with an alert on anomalous spend

**Data**
- [ ] Migrations reversible or expand-migrate-contract
- [ ] No destructive migration without a tested rollback
- [ ] Provenance preserved (superseded, not deleted)

## 3. Security review

- [ ] Trust boundaries drawn explicitly on the diagram
- [ ] STRIDE walked per boundary (see `distributed-systems.md` §8)
- [ ] Input validated at every boundary, not just the outermost
- [ ] Authorisation checked at the resource, not only at the route
- [ ] Tenant scoping enforced in one layer, not repeated per query
- [ ] Third-party dependencies audited; versions pinned
- [ ] Anything recommended to users is continuously validated, not checked once
- [ ] Sensitive data identified, encrypted at rest and in transit
- [ ] Incident response: who is called, what they can access, how they contain it

## 4. Agentic-system review

Use alongside §1 whenever the design includes an agent. Full detail in `agentic-systems.md`.

- [ ] The agency level is the *least* that solves the problem (single call → … → multi-agent)
- [ ] Tool descriptions are unambiguous; no two tools need "use this when…" disambiguation
- [ ] Read and write tools separated at the **registry** level, not just by policy
- [ ] Destructive/spending/irreversible actions are on a **static** always-escalate list, never model-judged
- [ ] Approval tiers designed against approval fatigue
- [ ] Context strategy defined: retrieval scope, compaction, sub-agent isolation
- [ ] Memory writes are visible to the user, and correctable
- [ ] Bounded execution: step caps, repeat detection, spend caps
- [ ] Prompt-injection considered for every path where the agent reads external content
- [ ] Verification step in the loop — the agent checks results rather than trusting its own claims
- [ ] Evaluation set exists, including tasks the agent should decline
- [ ] Cost attributed per tenant and per feature

## 5. Reviewing someone else's design — conduct

The technical checklist is the easy half. How the review is conducted determines whether it improves the design or just produces defensiveness.

- **Separate "wrong" from "different from how I'd do it."** Say which one you mean. Most review friction is the second dressed as the first.
- **Ask before asserting.** "What happens if the vector index is unavailable?" surfaces the gap without presuming it wasn't considered.
- **Rank findings**: blocking / should-fix / consider. An unranked list of twenty comments gets ignored entirely.
- **Name what's good, specifically.** Not politeness — it tells the author which parts not to change.
- **Distinguish the reversible from the one-way door.** Spend review energy proportionally; a two-way door decision doesn't warrant a fight.
- **Accept documented risk.** "We know, we've accepted it, here's the trigger to revisit" is a legitimate answer to a finding.
- **Offer the alternative.** A criticism without a candidate replacement is an obstacle, not a review.