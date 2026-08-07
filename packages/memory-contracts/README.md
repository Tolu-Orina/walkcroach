# @walkcroach/memory-contracts

Shared **memory semantics** for WalkCroach’s dual agent loops:

- `@walkcroach/agent-harness` — Web / Chrome / content SoR
- `@walkcroach/agent-engine` — IDE / CLI / Desktop (via SDK bridge)
- `@walkcroach/sdk` — public `/v1` client

## What lives here

| Export | Purpose |
|---|---|
| `MEMORY_KINDS` / `MemoryKind` | Canonical kind enum |
| `normalizeMemoryKind` | Shared coercion policy |
| `EXPORT_FORMAT` / `EXPORT_VERSION` / `validateExport` | Portable envelope |
| `RememberResult` / `SupersedeWriteResult` | Write + supersede shape |
| `SharedMemoryUiEvent` | Minimal UI chip (not full AgentEvent) |

## What does not

- Bedrock embedding calls, DB access, HostAdapter, tool registries
- Full harness or engine `AgentEvent` unions (intentionally dual)

See `docs/ARCHITECTURE.md` § Dual loops.
