# Agent-engine eval suite (Pre–Phase 6 discoverability)

Private package — these tests live next to the code under test. Do **not**
publish `@walkcroach/agent-engine` or move this suite into a public npm
package unless Phase 6 triggers fire and an ADR accepts a fixture-only
`@walkcroach/agent-evals` extraction.

## Run

```bash
cd packages/agent-engine
npm run eval          # vitest run src/eval
npm test              # full package tests (includes eval)
```

## Coverage

| File | Focus |
|---|---|
| `golden.test.ts` | Coding-task golden paths (read/edit/verify habits) |
| `security.test.ts` | Invalid tool input, runaway iterations, fleet cross-approve, abort abandon, unknown tool, memory bridge-only |
| `harness.ts` | Shared FakeHost / fixtures for evals |

## CI expectation

`npm run eval` (or the package `test` script that includes `src/eval`) must
stay green on every PR that touches agent-engine loop, tools, approvals, or
HostAdapter. A security eval failure is a ship blocker, not a flake.

## Related

- ADR-0003 — agent-engine production bar
- `docs/research/agentic-frameworks-landscape-2026.md` — Pre-P6 eval stance
- LangSmith trajectory evals — optional external sink; we own the fixtures
