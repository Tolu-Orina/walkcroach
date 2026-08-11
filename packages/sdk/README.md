# @walkcroach/sdk

Typed client for the **WalkCroach agentic memory layer** — durable, tenant-scoped, provenance-preserving memory backed by CockroachDB.

**This is the public platform product (funnel B).** It is not a hosted coding agent and does not ship `@walkcroach/agent-engine`. Coding agents live in the IDE Extension, CLI, and Desktop IDE.

One memory layer already spans six first-party surfaces: Web, Browser Extension, IDE Extension, CLI, Desktop IDE, and this SDK (plus MCP). Your agents read and write the same graph those surfaces use.

```bash
npm install @walkcroach/sdk
```

Get a key from **WalkCroach Web → Developer → API keys**, or mint one with a signed-in session (see below). Messaging rules: [docs/dual-funnel-messaging.md](../../docs/dual-funnel-messaging.md).

## Quick start

```ts
import { WalkCroach } from '@walkcroach/sdk';

const wc = new WalkCroach({ apiKey: process.env.WALKCROACH_API_KEY });

await wc.memory.remember({
  projectId,
  kind: 'decision',
  text: "Chose Drizzle over Prisma — Prisma's engine binary breaks on edge runtimes",
  surface: 'my-agent',
});

const hits = await wc.memory.recall({
  projectId,
  query: 'which ORM did we pick, and why?',
});
```

Inject into a system prompt with a budget (how many hits / characters to keep):

```ts
import { formatHitsForPrompt, clampRecallLimit } from '@walkcroach/sdk';

const hits = await wc.memory.recall({
  projectId,
  query: '…',
  limit: clampRecallLimit(requested),
});
const memoryBlock = formatHitsForPrompt(hits, { budget: { maxHits: 5, maxChars: 2000 } });
```

Get a key from the WalkCroach web app, or mint one with a signed-in session:

```ts
const key = await wc.keys.create({ name: 'ci', scopes: ['memory:read'] });
console.log(key.key); // shown once, never retrievable again
```

## What makes this different

Three things no other agent-memory system does today.

### Writes are transactional, and supersedes are visible

Restating a preference does not append a second, contradictory memory. The nearest same-kind entry within a distance threshold is retired in the **same transaction** as the insert, so a concurrent write cannot leave two entries both claiming to be current.

When that happens you are told:

```ts
const { id, supersededId } = await wc.memory.remember({ projectId, text: '…' });
if (supersededId) {
  // Tell your user. "Noted — this replaces your earlier note about X."
}
```

Surfacing this is deliberate. The threshold is a judgement call rather than an eval-backed constant, so a wrong call must be *correctable* by the user rather than silent.

### Point-in-time recall — what the agent believed, not just what is true

Built on CockroachDB `AS OF SYSTEM TIME`, so it reads straight off MVCC with no extra tables and no modelling cost:

```ts
const past = wc.memory.asOf('2026-08-04T09:00:00Z');
const thenHits = await past.recall({ projectId, query: 'which ORM?' });

const drift = await wc.memory.diff({ projectId, from: '2026-08-04T09:00:00Z', to: 'now' });
// { added: [...], retired: [...], unchanged: 12 }
```

`asOf()` returns a **read-only** view — it has no `remember`, so a timestamp cannot be passed to a write by accident.

**Bounded by MVCC retention.** The window is the cluster's `gc.ttlseconds` on `memory_entries` (currently **25 hours**). Beyond it the data is garbage-collected, not merely inaccessible:

```ts
try {
  await wc.memory.asOf('2020-01-01').recall({ projectId, query: 'x' });
} catch (err) {
  err.code; // 'RETENTION_WINDOW_EXCEEDED'
}
```

### Your memory is portable

```ts
const bundle = await wc.memory.export({ projectId });
await wc.memory.import({ projectId: otherProject, bundle });
```

`walkcroach-memory-export/1.0` is a plain, documented JSON envelope. It includes **superseded entries and their supersede links** — the provenance record — because an export of only current entries loses what changed and why.

Embeddings ride along by default, with `embeddingModel` naming what produced them. That makes import exact and offline-capable, and it means a destination on a different model knows it must re-embed rather than silently mixing incompatible vector spaces. Import is idempotent: entries match on `(kind, text)`, so re-importing skips rather than duplicates.

## API

| Method | Notes |
|---|---|
| `memory.remember({ projectId, text, kind?, surface? })` | Returns `{ id, supersededId }` |
| `memory.recall({ projectId, query, limit?, kinds?, surfaces? })` | Semantic search |
| `memory.list({ projectId, limit?, surfaces? })` | Reverse chronological |
| `memory.asOf(at)` | Read-only view at a past instant |
| `memory.diff({ projectId, from, to? })` | What changed between two instants |
| `memory.export({ projectId, embeddings?, superseded? })` | Portable bundle |
| `memory.import({ projectId, bundle })` | Idempotent |
| `memory.erase({ projectId, reason, entryIds?, exportFirst? })` | Tombstone erase (audited) |
| `memory.audit({ projectId })` | Control-plane audit events |
| `keys.create / list / revoke` | Requires a **user** token, not an API key |
| `createHostMemoryBridge({…})` | First-party IDE/CLI/Desktop adapter onto `/v1` |

### `projectId` is required on every call

Not ergonomics — correctness. The C-SPANN vector index is prefixed on `(project_id, superseded_by)`, and CockroachDB only uses a vector index when **every** prefix column is pinned to a value. An unscoped recall would still return correct rows, by scanning the whole table. That failure is invisible until it is expensive, which is exactly how it went unnoticed before it was found and fixed. The SDK validates the id client-side and never sends an unscoped query.

### Relevance, not distance

`recall()` returns `relevance` in `0..1`, not the raw cosine distance. The distance is an index implementation detail — the opclass has already had to change once — and publishing it would make the next such change a breaking API change. Treat `relevance` as ordinal, not as a calibrated probability.

### Writes are synchronous on purpose

`memory.remember` awaits the durable write (and supersede) before returning. There is no fire-and-forget server flag: async memory on the hot path is how contradictory preferences leak. If p95 hurts UX, buffer client-side and flush through an outbox you own — do not drop the await without one.

## Errors

All extend `WalkCroachError` and carry `requestId` where the server supplied one.

| Class | HTTP | Retried automatically |
|---|---|---|
| `AuthError` | 401, 403 | No |
| `ValidationError` | 400, 422 | No |
| `NotFoundError` | 404 | No |
| `QuotaError` | 429 | Yes, honouring `Retry-After` |
| `TransientError` | 502–504, network | Yes, full-jitter backoff |
| `ServerError` | 500 | **No** |

A 500 is deliberately not retried: on a write path it may have committed before failing to respond, and replaying could duplicate an entry.

A 404 is returned both for "no such project" and "not your project". That is intentional — a 403 would confirm existence and let a caller enumerate other tenants' ids.

## Content publish (`content.publish/v1`)

Turn a document into a pull request (or dry-run files) via a durable run:

```ts
import {
  WalkCroach,
  CONTENT_PUBLISH_CONTRACT_VERSION,
  isStageProgressEvent,
  isCriticProgressEvent,
  isPlanProgressEvent,
} from '@walkcroach/sdk';

const wc = new WalkCroach({ apiKey: process.env.WALKCROACH_API_KEY });

const run = await wc.content.publish({
  source: { kind: 'markdown', content: '# Hello\n\nBody', title: 'Hello' },
  target: { repo: 'acme/site' },
  writeScope: { mode: 'additive' },
});

const result = await run.wait({
  onProgress: (e) => {
    if (isPlanProgressEvent(e.type)) console.log('plan', e.type);
    if (isStageProgressEvent(e.type)) console.log('stage', e.type, e.payload);
    if (isCriticProgressEvent(e.type)) console.log('critic', e.type);
  },
});

console.log(result.contractVersion); // 'content.publish/v1'
// Also available: result.planAutoApproved, result.criticFindings, result.approvedPlan
```

### Plan approval: auto vs required

| Policy | `content.publish/v1` |
|---|---|
| **Auto (default)** | Plan stage runs the schema-restricted Planner, then **auto-approves** (A1). Async SDK / Lambda have no live HITL channel. |
| **`requirePlanApproval` / `planApproval: 'required'`** | **Rejected** at the client with `ValidationError`. Interactive `present_plan` lives in the IDE. |

`InterruptKind` includes `plan_decision` for future async HITL; do not rely on it for publish v1.

Progress/result shapes (`RunSnapshot`, `PublishResult`, `stage.*` / `critic.*` / `plan.auto_approved`) are shared with `graphs.run` — there is **no** public GraphBuilder in v1.

## Run Graph DSL (`graphs.*`)

Compose a quality pipeline from the **platform node catalog** only (ADR-I). BYO tools and HostAdapter plugins are rejected.

```ts
import { WalkCroach, isStageProgressEvent } from '@walkcroach/sdk';

const wc = new WalkCroach({ apiKey: process.env.WALKCROACH_API_KEY });

const catalog = await wc.graphs.catalog();
// catalog.nodes: fence, plan, draft, critique, revise, remember, memory.* …
// catalog.presets: content.publish

const check = await wc.graphs.validate({
  graph: {
    entry: 'fence',
    maxNodeExecutions: 12,
    nodes: [
      { id: 'fence', type: 'fence' },
      { id: 'critique', type: 'critique', config: { minArtifacts: 0 } },
    ],
    edges: [
      { from: 'fence', to: 'critique' },
      { from: 'critique', to: null },
    ],
  },
});
if (!check.ok) throw new Error(check.errors.join('; '));

const run = await wc.graphs.run({
  graph: check.graph!,
  input: { text: 'Untrusted customer brief' },
});

const result = await run.wait({
  onProgress: (e) => {
    if (isStageProgressEvent(e.type)) console.log(e.type, e.payload);
  },
});
// result.contractVersion === 'graph.run/v1' (custom graphs)
```

`preset: 'content.publish'` forwards to the same pipeline as `content.publish` (use publish fields: `source`, `writeScope`, …).

## Security

`apiKey` is **server-side only**. The constructor throws if it is used where `window` is defined, because a service key shipped to a page is a full tenant compromise that rotating one user's password does not undo. Use `accessToken` for user-context calls in a browser.

API keys cannot create or revoke API keys — otherwise one leaked key could issue itself replacements and outlive the revocation of the credential that leaked.

## Runtimes

Node 20+, browsers, and edge/worker runtimes. Uses the global `fetch` and imports nothing from `node:*`. Pass `fetch` explicitly on runtimes without one.

## Licence

MIT.
