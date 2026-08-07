# ADR-0002: Legal erase uses tombstones + audit — never silent hard DELETE

**Status:** Accepted  
**Date:** 2026-08-07  
**Deciders:** WalkCroach platform (Phase 1 implementation)  
**Reversibility:** One-way for rows already erased (text redacted); two-way for API shape until public SDK GA

## Context

Platform principle: **never delete — mark superseded** (belief provenance). GDPR / contractual right-to-forget requires removing *content* from active use and exportable corpora without pretending the event never happened.

Silent `DELETE FROM memory_entries` would break supersede chains, defeat audit, and make “never delete” folklore. Keeping full plaintext forever after an erase request fails the legal requirement.

## Decision

We will implement **erase as tombstone**:

1. Set `erased_at` (+ `erase_reason`); redact `text` to `[erased]`; null `embedding` so vector recall cannot resurface content.
2. Keep the row id and supersede links so lineage remains reconstructible as “this id existed and was erased.”
3. Every erase attempt (success or denied) writes `memory_audit` with action `erase` or `erase_export`.
4. `POST /v1/memory/erase` may set `exportFirst: true` to return an export bundle *before* tombstoning (export-for-erasure).
5. All live readers (`recall`, `list`, neighbour supersede, default export) filter `erased_at IS NULL`. Export-for-erasure and audit remain the durable record.

This **narrowly supersedes** “never delete” for **legal erase only**; ordinary belief change stays supersede-only.

## Dominant trade-off

We give up perfect reconstructability of erased *plaintext* in exchange for a fail-closed right-to-forget. Audit proves the erase; content does not survive in the SoR.

## Options considered

| Option | Fit | Why |
|---|---|---|
| **Tombstone + redact (chosen)** | Legal + provenance | Satisfies erase without silent DELETE |
| Hard DELETE | Simple | Breaks lineage; fails “never delete”; weak audit |
| Soft flag without redaction | Easy | Still stores personal data — not erase |
| Encrypt-at-rest with key destruction | Strong | Ops complexity deferred |

## Consequences

**Positive:** Clear API; audit trail; vector index cannot return erased text.  
**Negative:** Erased ids remain as tombstones (storage).  
**Harder later:** Undoing an erase cannot restore original text (by design).

## Revisit trigger

Reopen if a regulator requires physical row removal within N days, or if tombstone volume dominates table size (then partition/archive audit separately).

## Decision / Ask

Accepted with Phase 1 schema `037_memory_governance.sql`. Public docs must say erase redacts content and is audited.
