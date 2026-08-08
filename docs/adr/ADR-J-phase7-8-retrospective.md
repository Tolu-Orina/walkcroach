# ADR-J — Phase 7/8 close-out: model critic tiers + retrospective go/no-gos

**Status:** Accepted  
**Date:** 2026-08-08  
**Extends:** `docs/agentic-pattern-upgrade-implementation-plan.md` (ADR-D, ADR-I, A6)  
**Ranking attribute:** Outcome quality (unchanged)

## Context

Phases 0–6b shipped: bounded executor, Planner-as-subagent, internal Graph + CRDB checkpoints, deterministic CriticGate floor, `content.publish` on Graph, SDK contracts, public Run Graph DSL (catalog-only).

Phase 7 was **evidence-gated**. Phase 8 required explicit go/no-gos so deferred items do not silently become scope.

### Assumptions architected against

1. No production canary yet proving Tier-1 escape rate — therefore model critic ships as **opt-in capability**, default off.
2. Quality still outranks cost; model critic must not disable or weaken the Tier-1 floor.
3. Public BYO tools remain rejected (ADR-I); Phase 8 revisits with a recorded decision, not an implementation.

## Decision — Phase 7 (model critic)

| Tier | Implementation | Default |
|---|---|---|
| 1 | Deterministic CriticGate (unchanged) | Always on |
| 2 | `createTier2HeuristicModelCritic` — cheap semantic smells (TODO/FIXME, lorem, script, eval, thin page) | Off until `WALKCROACH_ENABLE_MODEL_CRITIC=1` (tier 2 default) |
| 3 | `createTier3LlmModelCritic` — Bedrock Converse JSON judge; fail-soft on infra errors | Off; set `WALKCROACH_MODEL_CRITIC_TIER=3` when enabling |

**Wiring:** `content.publish` Critique node + public `critique` catalog node resolve via `resolveModelCriticFromEnv()` / explicit deps.

**Events:** `critic.model_invoked` / `critic.model_skipped` (A6 events-first).

**Trade-off:** Opt-in delays semantic catch until operators have evidence — accepted to avoid unbounded Bedrock cost on every publish before need is proven. Floor quality is not sacrificed.

**Revisit trigger for default-on Tier 2:** eval suite or production shows ≥1 forbidden-artifact escape / 100 succeeded publishes that Tier-1 missed, *or* revise loops average >1.5 rounds with clean Tier-1.

## Decision — Phase 8 go/no-gos

| Item | Decision | Why |
|---|---|---|
| **ACE playbook** (Reflector/Curator strategy memory) | **No** | Distinct from Cockroach fact memory; high build cost; house-style Remember already covers publish conventions. Reopen only with measured strategy-repeat failures. |
| **Role subagents + compaction** beyond Planner | **No (deferred)** | Planner isolation is met; compaction is a Desktop/fleet cost problem (separate track), not required to close this upgrade. |
| **`critic_findings` table** | **No** | A6 events-first stands; `agent_run_events` + result `criticFindings` suffice. Table adds schema without query product. |
| **BYO tools on Graph DSL** | **No** | Default from ADR-I. Undifferentiated vs LangGraph/Strands; support sink. Reopen only if catalog graphs are stable in production **and** a paid support tier exists. |
| **Always-Planner for publish** | **Keep** | No Phase 8 evidence to swap back to light Plan; cost is metered, quality ranks. |

## Hardening shipped with this ADR

1. **CI fitness functions** — harness `src/fitness/agentic-pattern-fitness.test.ts` + engine `src/fitness/agentic-pattern-fitness.test.ts` covering §0.1 scenarios 1–6.
2. **Checkpoint GC** — migration `041_agent_run_checkpoint_gc.sql` + `pruneStaleGraphCheckpoints` (30-day default retention of bulky `stage_state`).

## Consequences

- Operators can enable Tier 2/3 without a code change; default path unchanged.
- Deferred ACE / BYO / critic table require a new ADR to reverse — not a quiet PR.
- Fitness suite is the compliance measure for dual-loop agentic quality attributes.

## Decision / Ask

Accepted as the close-out of the agentic-pattern upgrade programme for Phases 7–8. Next work is operational (deploy migration 041, optional canary with `WALKCROACH_ENABLE_MODEL_CRITIC=1`), not further pattern expansion under this plan.
