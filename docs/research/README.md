# Research notes

| Note | Purpose |
|---|---|
| [agentic-frameworks-landscape-2026.md](./agentic-frameworks-landscape-2026.md) | Pre–Phase 6 deep dive: LangChain/LangGraph/LangSmith, Strands, Loom, AgentCore, Claude/OpenAI Agents SDKs, CrewAI, ADK, Mastra — reuse vs build for `@walkcroach/agent` |
| [../observability-agent-telemetry.md](../observability-agent-telemetry.md) | Pre-P6 TelemetrySink → OTEL / LangSmith / Langfuse + interrupt vocabulary |
| [README.md](./README.md) (this file) | Index |

## Anthropic skills clone

Sparse checkout of [anthropics/skills](https://github.com/anthropics/skills) for review while authoring WalkCroach Web Modules.

**Do not import proprietary `pptx`/`pdf`/`docx`/`xlsx` bodies into product.** See `skills/web/NOTICE.md`.

Adapted Apache-2.0 outputs live in `skills/web/`.
