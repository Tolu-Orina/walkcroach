# WalkCroach dual-funnel messaging (P0)

**Status:** Accepted · Aug 2026  
**Audience:** Product, eng, support, anyone writing external copy  
**Companion plan:** Cursor canvas `dual-funnel-implementation-plan` · product master §0 / §7

One brand. **Two products. Two messages.** Do not muddle them on the same page without a clear primary funnel.

---

## 1. Message matrix

| | **Funnel A — Coding agents** | **Funnel B — Platform / memory SDK** |
|---|---|---|
| **Surfaces** | IDE Extension, CLI, Desktop IDE | Web (memory + builder home), Browser Extension, `@walkcroach/sdk`, `@walkcroach/sdk-mcp`, Developer portal |
| **Buyer** | IC developer; eng lead evaluating local agents | Builder integrating memory; platform/org evaluating durable context |
| **Job** | Amplify craft in the editor/terminal | Persist and recall project memory across surfaces and your own agents |
| **Headline pattern** | You steer; we explore → act → verify | Your one memory layer / durable cross-surface memory |
| **Proof** | Approvals, phase graph, BYOK Bedrock, worktrees | `source_surface` on recall, supersede, asOf (bounded), export/import |
| **Never say** | “Replaces Cursor / Copilot” | “Hosted coding agent” / “the SDK runs the IDE loop” |
| **Org angle** | Propose→confirm, BYOK, audit of agent actions | Memory fabric, keys/scopes, no browser secret keys, shared credits |
| **Dev angle** | Autonomy slider; verify before done | `npm i @walkcroach/sdk` + portal key in minutes |

Shared brand line (safe everywhere): **One CockroachDB memory graph across six surfaces.**

---

## 2. Pitch one-pager (internal)

### Elevator (30s)

WalkCroach is an agentic work platform with a single durable memory layer. Capture a preference in Chrome, recall it in the IDE. Coding agents (IDE, CLI, Desktop) amplify how you write code with explore → act → verify. The public SDK is that same memory for your own products — not a hosted Cursor.

### Why we win

Competitors own editor intimacy or GitHub distribution. We own **cross-surface memory with provenance**. Coding surfaces are the wedge; memory is the moat.

### What we sell next

1. Account + surfaces that make the 30s demo boring-reliable.  
2. Developer portal keys/docs/usage.  
3. Coding-agent trust (approvals, evals) — parallel, never blocked on portal polish.

### Forbidden pitches

- Phase graph / Gather→Act→Verify as the **public SDK** benefit.  
- “Publish `agent-engine` as the WalkCroach SDK.”  
- Multi-year memory time travel (asOf ≈ cluster MVCC window, ~25h today).

---

## 3. Page routing (which funnel owns the page)

| Page / package | Primary funnel | Notes |
|---|---|---|
| Marketing landing (`/`) | **B** (memory) | Secondary CTA → coding agents section |
| `/app/developer/*` | **B** | Keys, docs, MCP — never coding-loop claims |
| `packages/sdk` README | **B** | Six surfaces; SDK ≠ coding host |
| IDE / CLI / Desktop READMEs + store | **A** | Amplify + memory as differentiator |
| Web App Builder in-product | Builder (Web) | Memory is standing context, not the SDK pitch |

**10-second test:** After removing the nav, can a stranger tell which product the page sells? If both, pick a primary and demote the other to a link.

---

## 4. Demo — Chrome → IDE in ~30s (moat)

**Script (human):**

1. Sign in on Web; create or open a project.  
2. Browser Extension: under **Saved → Project memory**, Remember a short decision (e.g. “Prefer Drizzle over Prisma for edge”). Confirm it shows as `source_surface: chrome`.  
   (Nav **Captures** / **Capture Recall** is page-capture search only — not the project graph.)  
3. IDE Extension: Link the same project → ask the agent or open mirrored memory → recall shows the Chrome decision.

**Script (API / staging, no UI):**

```bash
ALLOW_DEV_AUTH=true WALKCROACH_IDE_URL=http://localhost:3003 \
  node scripts/demo-chrome-to-ide-30s.mjs
```

Exit: `ok: true`, `ms < 30000`, recall hit includes `surface: chrome`.

Full multi-surface write/recall (under 60s): `scripts/demo-cross-surface-memory.mjs`.

**Coding surface (P4):** seed Chrome → format/assert CLI provenance lines:

```bash
ALLOW_DEV_AUTH=true WALKCROACH_IDE_URL=http://localhost:3003 \
  node scripts/demo-coding-surface-recall.mjs
```

Exit: `ok: true`, formatted output contains `[chrome…]`, hit text includes marker.

---

## 5. Copy snippets (approved)

**Coding (A)**  
- “You steer; we explore, act, and verify.”  
- “A memory-first coding agent in your editor / terminal.”  
- “BYOK inference. Approvals before writes.”

**Platform (B)**  
- “Your one memory layer.”  
- “Typed client for the WalkCroach agentic memory layer.”  
- “Mint a key in Developer. Call the same graph every surface uses.”

**Bridge (ok in both)**  
- “A decision recorded on one surface is available on the others.”

---

## 6. Revisit

Reopen this doc when: landing primary CTA changes, a public `@walkcroach/agent` ships (P6), or Org GTM needs a fleet/ROI page separate from IC amplify.
