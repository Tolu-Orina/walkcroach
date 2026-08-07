# Distributed Systems, Data, Resilience, Security

## Contents
1. The fallacies
2. CAP and PACELC
3. Consistency models
4. Data architecture
5. Multi-tenancy
6. Resilience patterns
7. Failure-mode analysis
8. Security and threat modelling

---

## 1. The fallacies of distributed computing

Assumed-true and always false. Every one has a named mitigation; a design that has no answer for a fallacy is relying on it.

| Fallacy | Mitigation |
|---|---|
| The network is reliable | Retries with backoff, idempotency, timeouts |
| Latency is zero | Batch, cache, co-locate, async where possible |
| Bandwidth is infinite | Pagination, compression, bounded payloads |
| The network is secure | TLS everywhere, authn/authz per hop, least privilege |
| Topology doesn't change | Service discovery, no hardcoded endpoints |
| There is one administrator | Explicit ownership, runbooks, on-call |
| Transport cost is zero | Egress and inter-region cost in the model |
| The network is homogeneous | Explicit contracts, version negotiation |

## 2. CAP and PACELC

**CAP**: on a network **P**artition, choose **C**onsistency (refuse) or **A**vailability (serve possibly-stale). Partitions are not optional — the choice is only ever C vs. A.

**PACELC** is the more useful formulation because it covers the normal case: *if Partition then A-or-C, Else Latency-or-Consistency.* Most systems spend ~100% of their life in the "Else" branch, trading latency against consistency on every read.

Practical framing: don't ask "is this system CP or AP" — ask **per operation**. A payment write and a dashboard read in the same system can and should sit on opposite sides.

*WalkCroach note*: CockroachDB is a CP system with serializable isolation by default, and offers **follower reads / `AS OF SYSTEM TIME`** for bounded-staleness reads that don't contend with the write path. That's the idiomatic answer for reporting/dashboard queries — it delivers the read-replica property without provisioning a second database.

## 3. Consistency models

Strongest to weakest — pick deliberately, per operation:

- **Strict serializable** — as if operations ran one at a time, in real-time order. Simplest to reason about, most expensive.
- **Serializable** — some valid serial order exists; no real-time guarantee across clients.
- **Snapshot isolation** — reads see a consistent snapshot; write skew possible.
- **Bounded staleness** — stale by at most *t*. The sweet spot for dashboards and analytics.
- **Read-your-writes** — a client always sees its own writes. Often the minimum users actually notice.
- **Eventual** — converges, eventually. Fine for counters and caches; dangerous for anything a user reasons about.

**Design heuristic**: default to the strongest the system affords, then *deliberately* relax where a measured latency or cost problem justifies it. Relaxing consistency preemptively is a common source of bugs that surface months later.

## 4. Data architecture

- **Single system of record per entity.** Multiple writable copies of the same truth is the most expensive architectural mistake to unwind. (WalkCroach's "CockroachDB is the sole system of record" rule exists for this reason.)
- **Ownership is explicit.** Every table/stream has one owning service. Shared-write tables are coupling disguised as convenience.
- **Provenance over deletion.** Immutable or superseded-marked records preserve the ability to answer "what did we believe, and when". Cheap to design in; near-impossible to retrofit.
- **Schema evolution**: additive changes only where possible; expand-migrate-contract for breaking ones; never a destructive migration without a tested rollback.
- **Access pattern first, schema second.** Model the queries you must serve, then design the schema and indexes for them.
- **Vector data**: keeping embeddings in the operational database (rather than a separate vector store) removes the consistency gap and the reindexing pipeline — a real architectural simplification, not just convenience.

**Retention and classification** belong in the design, not in a later compliance scramble: what is stored, for how long, under what classification, and what the deletion path is.

## 5. Multi-tenancy

| Model | Isolation | Cost per tenant | Fits |
|---|---|---|---|
| Shared everything (tenant_id column) | Weakest | Lowest | Self-serve SaaS, many small tenants |
| Shared DB, schema per tenant | Medium | Medium | Mid-market, moderate tenant count |
| Database per tenant | Strong | Higher | Regulated, enterprise, noisy-neighbour risk |
| Full stack per tenant | Strongest | Highest | Sovereignty/regulatory requirement |

Whichever is chosen, design in from the start:

- **Tenant scoping enforced at one layer**, not repeated in every query. A missing `WHERE tenant_id` is a data breach.
- **Noisy-neighbour controls** — per-tenant rate limits and quotas.
- **Per-tenant cost attribution.** Retrofitting this is disproportionately painful; tag inference calls, storage, and compute with tenant identity from day one.
- **Per-tenant observability** — tenant ID on spans and metrics, so "is it slow for everyone or just them" is answerable.

## 6. Resilience patterns

- **Timeouts** — on every remote call, always. An unbounded call is a latent outage.
- **Retry with exponential backoff + jitter** — only for idempotent operations; jitter prevents synchronised retry storms.
- **Circuit breaker** — stop calling a failing dependency; fail fast, recover on probe.
- **Bulkhead** — isolate resource pools so one saturated dependency can't consume all capacity.
- **Graceful degradation** — decide *in advance* what a partial outage looks like. A user-facing transaction should still work when a recommendation service is down.
- **Idempotency keys** — for anything that spends money or creates records.
- **Backpressure** — bounded queues that shed or reject rather than growing without limit.
- **Blue/green or canary** — a failed deploy must never take down the working version.

## 7. Failure-mode analysis

For each significant component, answer four questions. If any is unanswered, that's the design gap.

1. **How does it fail?** (crash, slow, wrong answers, partial, silent)
2. **How is it detected?** (alert, health check, user report — user report is a finding, not an answer)
3. **What's the blast radius?** (one user, one tenant, one region, everything)
4. **What's the recovery?** (automatic, runbook, manual, none)

**Silent and partial failures deserve extra attention** — a component returning wrong answers confidently is far more dangerous than one that crashes, and is the failure class agentic systems produce most.

Complement with **pre-mortem**: assume this design failed badly six months from now; write the incident report backwards. It surfaces risks that forward-looking review misses.

## 8. Security and threat modelling

**STRIDE**, applied per trust boundary:

| Threat | Property violated | Typical control |
|---|---|---|
| **S**poofing | Authenticity | Strong authn, mTLS, signed tokens |
| **T**ampering | Integrity | Signatures, checksums, immutable logs |
| **R**epudiation | Non-repudiation | Audit logging with identity |
| **I**nformation disclosure | Confidentiality | Encryption, least privilege, scoping |
| **D**enial of service | Availability | Rate limits, quotas, autoscaling, bulkheads |
| **E**levation of privilege | Authorisation | Least privilege, scoped tokens, no ambient authority |

**Principles that survive contact with reality:**

- **Least privilege, scoped per project/tenant** — never a cluster-wide or org-wide credential where a scoped service account works.
- **Secrets never reach the client.** Backend-mediated proxy; verify with an automated leak scan in CI rather than by review.
- **Trust boundaries drawn explicitly** on the architecture diagram. Most vulnerabilities live at a boundary someone didn't realise was one.
- **Defence in depth** — no single control is the only thing preventing a serious outcome.
- **Audit what would be needed to reconstruct an incident**, and make sure it's queryable before you need it.

**For agentic systems specifically**, add: prompt injection via retrieved content, tool-permission escalation, and data exfiltration through an agent's legitimate outbound tools. See `agentic-systems.md` §6.

**Third-party and supply chain**: audit before adopting, pin versions, and continuously validate anything you recommend to users — a stale recommendation list is an attack surface, which is exactly how the January 2026 Open VSX namesquatting exposure worked across four separate well-resourced editors.