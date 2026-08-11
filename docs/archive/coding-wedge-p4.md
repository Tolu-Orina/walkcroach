# Coding wedge — P4

**Status:** Accepted · 2026-08-11  
**Companion:** [`dual-funnel-messaging.md`](./dual-funnel-messaging.md) · plan canvas P4

## Goal

Feel disciplined agents where code lives — distribution + trust. Memory is the moat; coding surfaces are the wedge.

## Locked messaging (Funnel A)

| Audience | Line |
|---|---|
| **Dev** | You steer; we explore → act → verify |
| **Org** | Propose→confirm · BYOK · audit · no silent production mutate |

Surfaces: IDE Extension (Open VSX), CLI (npm), Desktop (unsigned preview). Never proxy the Microsoft Marketplace.

## Exit criteria

| Criterion | Where |
|---|---|
| `eval:gate` on IDE/CLI release trains | `ide/buildspec.yml`, `cli/buildspec.yml`, `publish-ide.yml`, `publish-cli.yml` |
| Store listings match P0 matrix | `ide/package.json` + `check:publishable`; `cli/package.json` + `--help` |
| Coding-surface demo leads with cross-surface recall | `scripts/demo-coding-surface-recall.mjs` (+ human path in messaging §4) |
| Recall UX shows `source_surface` | IDE activity chips · CLI `memory list` / tool_card · Desktop `ProvenanceChip` (already) |

## Explicit non-goals this phase

- Signed Desktop channel (when ready — do not block P4).
- Public `@walkcroach/agent` (P6).
- Feature race vs Cursor — ship reliability (phase graph, plan-gate, verify, evals).

## Fitness

```bash
cd packages/agent-engine && npm run eval:gate
ALLOW_DEV_AUTH=true WALKCROACH_IDE_URL=http://localhost:3003 \
  node scripts/demo-coding-surface-recall.mjs
```
