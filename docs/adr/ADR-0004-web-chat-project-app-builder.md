# ADR-0004: Delineate WalkCroach Web as Chat · Project · App Builder

**Status:** Accepted  
**Date:** 2026-08-10  
**Deciders:** WalkCroach platform (Web delineation Phase 0)  
**Reversibility:** Two-way for UI copy and list filters; one-way once `kind=knowledge` rows and create paths ship (migration is additive)

## Context

WalkCroach Web already exposes three rail entries — Chat, Projects, Builder — but create/launch paths stamp almost everything as `kind=app` with `template_id='blank'`. Product copy calls Projects a knowledge container and Builder “a room,” yet `BuilderLaunchPage` will open any listed project or create an Untitled row that pollutes the Projects list. Session resume ignores `mode`, so App Builder can hydrate a chat thread.

The product intent is three pillars only: **Chat**, **Project**, **App Builder**. A prior draft of the plan introduced a fourth glossary noun “App” distinct from App Builder; that is rejected as terminology drift.

## Decision

1. **Three product pillars only** — Chat, Project, App Builder. Glossary: [`docs/web-product-glossary.md`](../web-product-glossary.md). Plan: [`docs/walkcroach web delineation.md`](../walkcroach%20web%20delineation.md).
2. **Same CockroachDB `projects` table** — do not split entities. Map:
   - Chat → `kind=general` (existing `__walkcroach_chat__`)
   - Project → `kind=knowledge` (**new**)
   - App Builder workspace → `kind=app` (existing meaning, narrowed)
3. **Create policy** — Projects UI creates `knowledge` with `template_id` null. App Builder / `/try` / pending-prompt create `kind=app` with template. Never use Projects create for Builder workspaces.
4. **Launch policy** — App Builder may only resume or list `kind=app`. Never open `knowledge` as Builder. Prefer a hub when no valid last workspace; do not invent Untitled into the Projects list.
5. **Backfill policy A** — existing non-`general` rows remain `kind=app`. New Projects are `knowledge`. No heuristic rewrite in MVP.
6. **Promote** (Project → App Builder) — Phase 6: create a **new** `kind=app` row (copy name/description/instructions); never mutate `knowledge` → `app` in place.
7. **Session isolation** — `getLatestSessionForProject` must filter by `mode` (`chat` vs `builder`) before App Builder hub ships.
8. **Builder routes** — canonical `/app/builder/:id`; legacy `/app/projects/:id/builder` redirects.

## Dominant trade-off

We keep one table and a kind discriminator so memory, documents, sessions, and IDE/Chrome links stay on `project_id` — giving up a pure domain model where “Project” and “App Builder workspace” are different tables/names in SQL. We also leave historical rows classified as App Builder (`app`) until users archive them, rather than risk mis-backfilling real sandboxes into Projects.

## Options considered

| Option | Fit | Why it lost / won |
|---|---|---|
| **Same table + kinds (chosen)** | Ship + tenancy | Matches memory key; additive migration |
| Separate `apps` table | Clean nouns | FK/migration blast across memory, docs, sessions, IDE, Chrome |
| UI-only split, keep all `kind=app` | Fast | Create/launch keep coupling; status drift continues |
| Four nouns (Chat / Project / App / Builder) | — | Rejected: App Builder is the pillar; “App” as separate product noun confuses IA |

## Consequences

**Positive:** Honest IA; Projects list stops accumulating Builder Untitled rows; App Builder launch is deterministic; copy can be audited against three nouns.  
**Negative / accepted costs:** `projects` table name remains overloaded; Apps rail is an output surface, not a pillar — needs careful empty-state copy.  
**What becomes harder later:** Renaming the table or splitting entities after `knowledge` rows exist in production.

## Fitness checks

After Phase 2+:

1. Projects create → `kind=knowledge`, `template_id` IS NULL.
2. App Builder create → `kind=app`.
3. App Builder launch never targets `kind=knowledge`.
4. Builder session resume uses `mode=builder`.
5. UI copy uses glossary nouns only (Phase 5 audit).

## Revisit trigger

Reopen if: (a) IDE/Chrome require a shared “work unit” that is neither Project nor App Builder, (b) promote-in-place (`knowledge` → `app`) becomes a contractual workflow, or (c) table overload blocks SDK tenancy clarity.

## Decision / Ask

**Accepted for Phase 0.** Phases 1–6 implemented 2026-08-11 (kinds, create/launch, session isolation, IA redesign, glossary polish, promote-to-new-row + `/app/builder/:id` routes + picker labels).
