# @walkcroach/sdk-host (internal)

**Status:** private · not published to npm  
**Consumers:** `lambda-ide` content publish worker (`runProgrammatic`)

## What this is

A programmatic `HostAdapter` plus `runProgrammatic` that drives the same
`@walkcroach/agent-engine` loop used by the IDE Extension and CLI — against an
in-memory / sandbox filesystem instead of a VS Code workspace.

It is **not** the public WalkCroach SDK. The public product is
`@walkcroach/sdk` (memory / content / keys). See `docs/dual-funnel-messaging.md`.

## What this is not

- Not a public npm package (depends on private `file:../agent-engine`).
- Not a substitute for `@walkcroach/sdk` memory APIs.
- Not a hosted “coding agent as a service” product surface (that remains gated as dual-funnel P6).

## Usage (first-party only)

```ts
import { runProgrammatic, SandboxHostAdapter } from '@walkcroach/sdk-host';
```

Content publish path: ide-api `handlers/content.ts` → `agent-runner.ts` →
`runProgrammatic`.

## Dual-funnel note

| Package | Public? | Role |
|---|---|---|
| `@walkcroach/sdk` | yes | Memory / content / keys HTTP client |
| `@walkcroach/sdk-mcp` | yes | MCP over memory |
| `@walkcroach/sdk-host` | **no** | Internal HostAdapter for content runs |
| `@walkcroach/agent-engine` | **no** | Coding loop |

## Tests

```bash
cd packages/sdk-host && npm test
```

Includes hardening, run, and memory-fs unit coverage. Full content-publish
integration against live APIGW is covered by ide-api isolation/contract suites
when `ALLOW_DEV_AUTH` is set.
