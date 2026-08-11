# Agent-engine eval suite

Private package — these tests live next to the code under test. Do **not**
publish `@walkcroach/agent-engine` or move this suite into a public npm
package unless Phase 6 triggers fire and an ADR accepts a fixture-only
`@walkcroach/agent-evals` extraction.

## Run

```bash
cd packages/agent-engine
npm run eval              # vitest run src/eval (goldens + security + trajectories)
npm run test:fitness      # remask / planner / thrash / dual-validation unit fitness
npm run eval:gate         # P4 exit gate: eval + fitness (IDE/CLI release trains)
npm test                  # full package tests (includes eval)
```

## Coverage

| File | Focus |
|---|---|
| `golden.test.ts` | Pre–P6 coding-task golden paths (read/edit/verify habits) |
| `security.test.ts` | Invalid tool input, runaway iterations, fleet cross-approve, abort, unknown tool, memory bridge-only |
| `phase-graph.trajectory.test.ts` | **P5** remask trajectories: phase sequence, per-turn tool sets, verify outcome |
| `trajectories/phase-graph.ts` | Recorded golden definitions |
| `trajectory.ts` / `metrics.ts` | Types, asserts, dashboard metric concepts |
| `harness.ts` | Shared scripted Bedrock turns |

## P4 release gate (phase graph default-on)

Phase graph is **default ON** in agent-engine (`phaseGraphEnabled` unset → on;
pass `false` to restore the flat menu). IDE settings remain explicit defaults.
`npm run eval:gate` must stay green on remask + fitness changes, and is required
on IDE/CLI CodeBuild + publish workflows (dual-funnel P4).

## CI expectation

`npm run eval` (or the package `test` script that includes `src/eval`) must
stay green on every PR that touches agent-engine loop, tools, approvals,
phase-graph, or HostAdapter. A security or trajectory eval failure is a ship
blocker, not a flake.

## Related

- ADR-0003 — agent-engine production bar
- `docs/research/agentic-frameworks-landscape-2026.md` — Pre-P6 eval stance
- LangSmith trajectory evals — optional external sink; we own the fixtures
