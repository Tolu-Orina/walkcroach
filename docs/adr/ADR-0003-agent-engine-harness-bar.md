# ADR-0003: Agent-engine harness production bar (Phase 3)

**Status:** Accepted  
**Date:** 2026-08-07  
**Deciders:** WalkCroach platform (Phase 3 implementation)  
**Reversibility:** Two-way for opt-in lazy worktrees; one-way for session-scoped approval API once Desktop ships PROTOCOL_VERSION 3

## Context

Industry coding-agent reliability (~98% of production failures) is dominated by the **harness**, not the model: schema-validated tool dispatch, approval gates that cannot be spoofed across fleet sessions, isolation for parallel agents, structured observability (OTel/EMF), and fail-closed budgets (timeout, disk). Research (OpenAI Codex sandbox + OTel logs; worktree-per-task factories; GenAI semconv) converges on the same Production Stack: Identify → Plan → Decide → Gate → Execute → Observe → Recover.

WalkCroach keeps `@walkcroach/agent-engine` **private**. Phase 3 raises that private harness to the production bar without publishing it or merging it with `@walkcroach/agent-harness`.

## Decision

1. **Uniform dispatch (P3.1):** Every tool call goes `validateToolInput → execute → observe` (`tools/dispatch.ts`). No bypass for “simple” tools.
2. **Session-scoped approvals (P3.2):** `ApprovalRequest.sessionId` + `FleetApprovalRouter`; cross-session `resolveApproval` is a no-op. Critical commands use `isCriticalCommand` (not only infra regex) so low_friction never auto-approves catastrophic shell.
3. **Lazy worktree opt-in (P3.3):** Default policy remains `none` for interactive IDE/CLI. Fleet uses `lazy_worktree` with `collisionMode: refuse` on non-git. Sidecar / workspace_root documented for non-git collision.
4. **Memory via bridge (P3.4):** Tools only call `ProjectMemoryBridge`; first-party hosts inject `/v1` SDK bridge. Workers may keep in-process DB bridges of the same shape.
5. **Structured telemetry + SLIs (P3.5):** `TelemetrySink` emits GenAI-shaped events and EMF; SLIs: recall p95, tool error rate, approval abandon rate (`AGENT_SLIS`).
6. **Security evals in CI (P3.6):** `src/eval/security.test.ts` covers injection, runaway, spoof, timeout/abandon, over-tooling, memory bridge.
7. **Production refuse plaintext (P3.7):** CLI + Desktop FileSecrets fail closed when profile is production and keychain/safeStorage is unavailable (escape hatch env).
8. **sdk-host budgets (P3.8):** `timeoutMs`, `MemoryFileSystem.maxBytes`, cancel mapping; write-scope remains fail-closed.
9. **Protocol single source (P3.9):** `@walkcroach/agent-protocol` (PROTOCOL_VERSION 3); Desktop `agent-ui` re-exports.

## Dominant trade-off

We accept a Desktop protocol bump (v2 → v3) and slightly stricter production secret UX in exchange for fleet safety and auditability. We do **not** surprise-default every IDE session into a worktree.

## Consequences

- Desktop workbench must echo `sessionId` on `resolveApproval` (agent-ui already does via `req.sessionId ?? activeFleetId`).
- Hosts creating fleet members must construct one `ApprovalController` / `DesktopHostAdapter` per session id and route through `FleetApprovalRouter`.
- Publish of agent-engine remains a non-goal.
