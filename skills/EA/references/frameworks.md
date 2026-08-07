# Frameworks as Lenses

> Use these to *think*, never to perform. The reader should feel the rigour without being shown the scaffolding. If naming a framework doesn't change the answer, don't name it.

Each entry answers three questions: what it's genuinely good for, when it's overhead, and the one idea worth stealing even if you never use the rest.

## Contents
TOGAF ADM · C4 · Wardley Mapping · Domain-Driven Design · Team Topologies & Conway's Law · Zachman · ArchiMate · Well-Architected frameworks · Evolutionary architecture · Choosing between them

---

## TOGAF ADM

**Good for**: large, multi-year, multi-stakeholder transformation where governance and traceability genuinely matter. Its real contribution is the *sequence* — vision → business → information systems → technology → opportunities → migration planning → governance — which stops teams from designing technology before establishing why.

**Overhead when**: applied to a single system or a small team. Full TOGAF ceremony on a two-service feature is theatre.

**Steal this**: the discipline of establishing business drivers and target state *before* technology, and the explicit gap-analysis → migration-planning step that most design documents skip entirely.

## C4 Model

**Good for**: communicating a system at controlled altitude. Four levels — **Context** (systems and actors), **Container** (deployable/runnable units), **Component** (inside one container), **Code** (rarely worth drawing).

**Overhead when**: producing all four levels by default. Pick the level that answers the question at hand.

**Steal this**: the insight that most architecture-diagram confusion is an *altitude* problem — mixing deployment units and classes in one picture. Also: name the diagram's question before drawing it.

## Wardley Mapping

**Good for**: strategy and build-vs-buy. Position components on two axes — value-chain position (user need → invisible infrastructure) and **evolution** (genesis → custom-built → product → commodity). The insight it produces reliably: *don't custom-build a commodity, and don't buy your genesis-stage differentiator.*

**Overhead when**: the decision is purely technical with no strategic content.

**Steal this**: the evolution axis alone. Asking "is this component genesis, custom, product, or commodity?" resolves a surprising number of build-vs-buy arguments in one question.

## Domain-Driven Design

**Good for**: complex business domains, and deciding service boundaries. Key concepts worth actually using:

- **Bounded context** — an explicit boundary within which a model and its terms are consistent. The single most useful DDD idea; most bad microservice boundaries are missing bounded contexts.
- **Ubiquitous language** — the same words in code, conversation, and documents.
- **Context mapping** — how contexts relate (partnership, customer-supplier, conformist, anticorruption layer, shared kernel).
- **Aggregate** — the consistency boundary for a transaction. Aggregate boundaries usually indicate where distribution is safe.

**Overhead when**: the domain is genuinely simple (CRUD over a well-understood entity). Tactical DDD patterns applied to a simple domain add ceremony without insight.

**Steal this**: bounded contexts as the primary input to service decomposition — and the anticorruption layer as the standard answer to integrating a legacy or third-party model you don't control.

## Team Topologies & Conway's Law

**Conway's Law**: systems mirror the communication structure of the organisation that builds them. This is empirical, not aspirational — the architecture *will* reflect team shape whether or not it's designed to.

**Inverse Conway manoeuvre**: shape teams to the architecture you want. Powerful and frequently the actual blocker; a microservice architecture with one team owning forty services is a distributed monolith with extra latency.

Four team types worth knowing: **stream-aligned** (the default), **enabling**, **complicated-subsystem**, **platform**. Three interaction modes: collaboration, X-as-a-service, facilitating.

**Steal this**: always ask *"how many teams will own this day-to-day?"* during discovery. The answer constrains viable decompositions more tightly than the domain does.

## Zachman Framework

**Good for**: completeness checking. A 6×6 matrix (what/how/where/who/when/why × audience perspectives). Genuinely useful as a checklist to find *what you haven't considered*.

**Overhead when**: used as a production method — filling all 36 cells is almost never worth it.

**Steal this**: the six interrogatives as a coverage check. "Have I addressed *who* and *when*, or only *what* and *how*?" catches real gaps in minutes.

## ArchiMate

**Good for**: formal modelling in organisations that maintain an architecture repository, especially where business/application/technology-layer traceability is a compliance requirement.

**Overhead when**: nobody will maintain the model. An out-of-date formal model is worse than no model — it's confidently wrong.

**Steal this**: the three-layer separation (business / application / technology) as a way to check whether a proposal actually connects to business capability or floats free of it.

## Well-Architected frameworks (AWS and equivalents)

Six pillars: operational excellence, security, reliability, performance efficiency, cost optimisation, sustainability.

**Good for**: a fast, structured review of a cloud design; the pillar questions are a decent pre-built checklist.

**Overhead when**: treated as a compliance exercise rather than a prompt for real trade-off conversations.

**Steal this**: cost optimisation and operational excellence as *first-class architecture concerns* rather than afterthoughts — the two most commonly omitted from design documents.

## Evolutionary architecture

Three aspects: **incremental change**, **fitness functions**, and **appropriate coupling**. The core claim is that architecture cannot be finished — it can only be *guided*, and guidance requires automated, objective checks. See `quality-attributes.md` §5 for fitness functions in depth.

**Steal this**: "appropriate coupling" as the framing. Not *low* coupling everywhere — *appropriate*. Some coupling is correct and cheaper than the abstraction that avoids it.

Related and worth knowing: **Architecture as Code** (2026) — treating architecture artifacts as machine-readable, version-controlled, reviewable text so that automation can verify what's running still matches what was decided. This is the practical bridge between a design document and a fitness function.

---

## Choosing between them

| The question is… | Reach for |
|---|---|
| Where should the business be, and how do we get there? | TOGAF spine (drivers → target → gap → migration) |
| How do I explain this system to that audience? | C4, at one chosen level |
| Build, buy, or ignore? | Wardley evolution axis |
| Where do the service boundaries go? | DDD bounded contexts + Conway's Law |
| Have I missed anything? | Zachman's six interrogatives |
| Is this cloud design sound? | Well-Architected pillars |
| How do I stop this decaying? | Fitness functions |
| Why does the org keep rebuilding the same thing? | Capability map (see `artifacts.md`) |

Most real work uses two or three lenses briefly, not one framework thoroughly.