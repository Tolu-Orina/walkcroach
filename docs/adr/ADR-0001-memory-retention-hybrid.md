# ADR-0001: Keep MVCC asOf short; govern long-lived memory with application audit + erase tombstones

**Status:** Accepted  
**Date:** 2026-08-07  
**Deciders:** WalkCroach platform (Phase 1 implementation)  
**Reversibility:** One-way door for claiming multi-year *asOf* without bi-temporal tables; two-way for raising `gc.ttlseconds` further

## Context

Point-in-time recall today is CockroachDB `AS OF SYSTEM TIME` over `memory_entries`, bounded by zone `gc.ttlseconds = 90000` (~25h) — **verified** in migration `034_memory_retention.sql` and advertised on `/v1/sdk-health`.

Enterprise buyers treat “memory audit / replay” as days–years, not hours. Raising cluster GC TTL alone (option A) inflates storage for *all* MVCC history on the table and still does not give legal erase, actor lineage, or queryable audit. Full bi-temporal columns + snapshot tables (option B) are the correct long-term model for multi-year *asOf*, but are a large schema and write-path change mid-platform build.

## Decision

We will use **hybrid (option C)**:

1. **Operational asOf/diff** continues to use MVCC with the current **90_000s** GC window. Health must keep advertising that window honestly (`mechanism: cockroachdb_mvcc_gc_ttl`).
2. **Enterprise governance** is application-level: durable `memory_audit` rows, provenance columns on writes, and **erase tombstones** (`erased_at`) that survive beyond MVCC usefulness for legal / right-to-forget workflows.
3. We will **not** claim multi-year asOf until a follow-on ADR introduces bi-temporal (or snapshot) storage. Portal and SDK docs must not imply otherwise.

## Dominant trade-off

We give up “one mechanism for all time travel” and accept two clocks: short MVCC debug replay vs long audit/erase governance. Callers who need year-scale *belief at time T* must wait for bi-temporal work.

## Options considered

| Option | Fit | Why it lost / won |
|---|---|---|
| **C Hybrid (chosen)** | Security + honesty + shippable now | Keeps asOf cheap; adds governance without pretending MVCC is an archive |
| A Raise `gc.ttlseconds` only | Easy | Storage cost; still no erase/audit/actor; dishonest if marketed as enterprise retention |
| B Full bi-temporal now | Best long-term asOf | One-way schema complexity before first-party surfaces share one client (Phase 2) |
| Do nothing | — | Blocks enterprise grade; health already discloses ~25h |

## Consequences

**Positive:** Honest product surface; legal erase path; audit queryable per project/owner; asOf stays a sharp debug tool.  
**Negative / accepted costs:** Two retention stories to teach; asOf and audit answer different questions.  
**What becomes harder later:** Migrating historical rows into bi-temporal form if we never stored `valid_until`.

## Revisit trigger

Reopen when: (a) a design partner requires asOf older than 7 days as a contractual SLA, or (b) `memory_entries` MVCC storage cost forces GC *below* 90_000s, or (c) Phase 2 cross-surface golden tests need reproducible multi-day belief replay.

## Decision / Ask

Accepted for Phase 1. Do not market MVCC asOf as compliance retention. Next retention ADR only when bi-temporal is funded.
