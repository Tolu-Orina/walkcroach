---
name: walkcroach-model-routing
description: >-
  Routes WalkCroach Web agent turns on Amazon Nova 2 Lite (extended thinking
  always on) plus Canvas/Reel for paid creatives. Nova 1 Pro is unsupported.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach Model Routing (Native Bedrock)

WalkCroach does **not** call Anthropic/OpenAI models for Web Modules. Text and
creative **orchestration** use **Amazon Nova 2 Lite** on Bedrock with **extended
thinking always enabled**. Image/video generation use Canvas / Reel.

## Why not Nova 1 Pro (or Nova 2 Pro)

AWS recommends migrating Nova 1 Pro workloads **directly to Nova 2 Lite** with
extended thinking — not to Nova 2 Pro (restricted). With thinking on, Nova 2 Lite
surpasses first-gen Pro/Premier on multi-step agentic work, at much lower cost
and latency, with a **1M-token** context window. See `docs/nova-2-lite.md`.

**Do not** configure `amazon.nova-pro-v1:0`, `NOVA_PRO_MODEL_ID`, or disable
extended thinking.

## Default — Nova 2 Lite (all text / briefs)

**Model ID:** `global.amazon.nova-2-lite-v1:0` (override via `NOVA_MODEL_ID` / `BEDROCK_NOVA_MODEL_ID`)

**Extended thinking:** always on. Tier via `BEDROCK_NOVA_REASONING=low|medium|high` (default **medium**).

Use for:

- Free-tier and paid chat / builder turns
- Plan proposals, recall, editing, connector **reads**
- Creative **briefs** (slides, flyers, video scripts) — paid entitlement gates the *feature*, not a different text model
- Routing / classification ("is this a slide request?")

## Creative models (paid only)

| Model | ID (typical) | Role |
|---|---|---|
| Nova Canvas | `amazon.nova-canvas-v1:0` | Images; prefer `COLOR_GUIDED_GENERATION` |
| Nova Reel | `amazon.nova-reel-v1:1` | Video via `StartAsyncInvoke`; MULTI_SHOT_MANUAL for 30s |

Nova 2 Lite plans/critiques; Canvas/Reel generate media.

## Routing algorithm

```
if action in {generate_image, render_pptx, render_flyer, start_video_job}:
  require paid entitlement
  enforce hard caps (see walkcroach-quota-and-credits)
  run brief/orchestration on Nova 2 Lite (extended thinking)
  call Canvas/Reel/render tools
else:
  Nova 2 Lite (extended thinking)
```

## Never

- Invoke Amazon Nova 1 Pro (or assume Nova 2 Pro availability)
- Silently upgrade a free user past entitlement gates
- Call Canvas/Reel without propose→confirm when credits/caps will be consumed
- Use third-party LLM APIs for these pipelines
- Disable extended thinking (`BEDROCK_NOVA_REASONING=off` is ignored → medium)
