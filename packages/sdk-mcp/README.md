# @walkcroach/sdk-mcp

An **MCP server** exposing the WalkCroach agentic memory layer to any compliant host — Claude Code, Cursor, VS Code, or your own.

Implements the **2026-07-28** revision of the Model Context Protocol, and still speaks **2025-11-25**.

## Quick start

```bash
npm install -g @walkcroach/sdk-mcp
export WALKCROACH_API_KEY=wc_live_…
walkcroach-mcp serve
```

Then point a host at it:

```bash
claude mcp add --transport http walkcroach http://127.0.0.1:7801/mcp
```

Ask Claude Code *"what did we decide about the ORM?"* and it recalls a decision written by the web builder or the Chrome extension — cross-surface memory, in a host we did not build.

## Tools

| Tool | Scope | What it does |
|---|---|---|
| `recall_project_memory` | `memory:read` | Semantic search across every surface's memory |
| `remember` | `memory:write` | Record a decision, preference, or convention |
| `list_memory` | `memory:read` | Recent entries, reverse chronological |
| `memory_timeline` | `memory:read` | What changed between two instants (`AS OF SYSTEM TIME`) |

`recall_project_memory` and `remember` keep the names the internal agent harness uses, so a prompt written against the first-party surfaces ports here without rewording. Every tool declares an `outputSchema`, so hosts get `structuredContent` rather than parsing prose.

## Protocol conformance

The 2026-07-28 revision is the largest break since authorization was added. What this server implements:

- **`server/discover`** — mandatory in this revision; advertises identity, versions, capabilities.
- **No `initialize` handshake.** Protocol version and client capabilities travel in `_meta` on every request. An unknown version returns `UnsupportedProtocolVersionError` (`-32022`, renumbered this revision).
- **No sessions, no `Mcp-Session-Id`.** Cross-call state is server-minted handles passed as ordinary tool arguments.
- **`resultType` on every result.**
- **`ttlMs` + `cacheScope` on list results** — always `private`, never `public`: these responses are tenant-shaped and a shared intermediary caching one tenant's for another would be a data leak.
- **Deterministic `tools/list` order**, so host-side caching and provider prompt caching both hit.
- **OpenTelemetry `traceparent`** propagated from `_meta` into results.
- **No Roots, Sampling, or Logging** — all three are deprecated as of this revision.

### Why 2025-11-25 support is load-bearing

As of 2026-08-04 the official `@modelcontextprotocol/sdk@1.30.0` — published 2026-07-27, one day before the spec froze — still declares `LATEST_PROTOCOL_VERSION = '2025-11-25'` and ships no `server/discover`. Hosts built on it speak the older revision. A server that answered only 2026-07-28 would be spec-correct and unable to connect to anything.

So `initialize`, `ping`, `resources/list`, and `prompts/list` are all answered, and a request with no `_meta` version is treated as 2025-11-25 rather than rejected.

### Statelessness is a fit, not a compromise

The removal of protocol-level sessions matches how the WalkCroach backend already works: API Gateway plus `streamifyResponse` holds no cross-call state, and sandbox tools already resume through server-minted handles. Adopting this revision meant deleting workarounds, not adding them.

## Transport

Streamable HTTP, POST only. 2026-07-28 removed the GET/SSE endpoint, SSE resumability, and message redelivery — a broken stream loses the in-flight request and the client re-issues it — so there is nothing to resume and the transport is a plain request/response cycle.

**Binds to loopback by default.** The process holds a `wc_live_` key in memory; binding to `0.0.0.0` would expose an unauthenticated proxy to that key on the local network.

**stdio is not supported**, deliberately. That posture is documented separately in the repo's stdio MCP security review and is not reopened here.

## Programmatic use

```ts
import { createDispatcher, createMcpHttpServer } from '@walkcroach/sdk-mcp';
import { WalkCroach } from '@walkcroach/sdk';

// Transport-agnostic: hand it a JSON-RPC request, get a response.
const dispatch = createDispatcher(new WalkCroach({ apiKey }));
const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

// Or run the HTTP transport yourself.
const server = createMcpHttpServer({ apiKey, port: 7801 });
```

The dispatcher retains nothing between calls, so one instance serves concurrent clients safely.

## Host configs

### Claude Code (HTTP)

```bash
export WALKCROACH_API_KEY=wc_live_…
export WALKCROACH_BASE_URL=https://api.walkcroach.rinegansolutions.com
npx -y @walkcroach/sdk-mcp serve --port 7801

claude mcp add --transport http walkcroach http://127.0.0.1:7801/mcp
```

### Cursor / VS Code

Run the same `serve` process, then in MCP settings:

```json
{
  "mcpServers": {
    "walkcroach": {
      "url": "http://127.0.0.1:7801/mcp"
    }
  }
}
```

**Do not** configure a stdio `command`/`args` entry for this package — stdio is not implemented.

## Scopes

A key minted with only `memory:read` cannot call `remember`; the refusal names the missing scope. Mint keys with the least scope the integration needs.

## Licence

MIT.
