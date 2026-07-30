---
name: walkcroach-model-routing
description: >-
  Chooses Amazon Nova 2 Lite vs Nova Pro (and Canvas/Reel) for WalkCroach Web
  agent turns. Use at the start of any Chat/Builder turn that might need
  creative generation, long planning, or paid-only features.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach Model Routing (Native Bedrock)

WalkCroach does **not** call Anthropic/OpenAI models for Web Modules. All orchestration uses Amazon Nova on Bedrock.

## Default — Nova 2 Lite

**Model ID:** `global.amazon.nova-2-lite-v1:0` (override via `NOVA_MODEL_ID` / `BEDROCK_NOVA_MODEL_ID`)

Use for:

- Free-tier chat and builder turns
- Plan proposals, recall, light editing, connector **reads**
- Routing / classification ("is this a slide request?")
- Drafting copy that will later be upgraded under Pro when the user confirms a paid creative job

## Paid orchestrator — Nova Pro

**Model ID:** `amazon.nova-2-pro-v1:0` or platform-configured Pro ID (`NOVA_PRO_MODEL_ID`)

**Gate:** Cognito user on **Web Paid** (or equivalent entitlement claim). Free users never invoke Pro for creative pipelines — upgrade prompt instead.

Use Pro to **orchestrate**:

| Job | Pro does | Downstream |
|---|---|---|
| Slides | Creative brief, slide outline, image prompts, QA critique | `generate_image` (Canvas), `render_pptx` |
| Flyers | Philosophy + copy + layout field map | Canvas + `render_flyer` |
| Images | Prompt + negative prompt + palette | Nova Canvas only |
| Video | Shot list (5×6s), voiceover script, reference-still prompts | Canvas ×5 → Nova Reel → Polly → ffmpeg compose |

Pro is the planner/critic; it does not replace Canvas/Reel.

## Creative models (paid only)

| Model | ID (typical) | Role |
|---|---|---|
| Nova Canvas | `amazon.nova-canvas-v1:0` | Images; prefer `COLOR_GUIDED_GENERATION` |
| Nova Reel | `amazon.nova-reel-v1:1` | Video via `StartAsyncInvoke`; MULTI_SHOT_MANUAL for 30s |

## Routing algorithm

```
if action in {generate_image, render_pptx, render_flyer, start_video_job}:
  require paid entitlement
  enforce hard caps (see walkcroach-quota-and-credits)
  run brief/orchestration on Nova Pro
  call Canvas/Reel/render tools
else if turn is complex planning AND user is paid AND feature flag allows:
  optional Pro for quality
else:
  Nova 2 Lite
```

## Never

- Silently upgrade a free user to Pro
- Call Canvas/Reel without propose→confirm when credits/caps will be consumed
- Use third-party LLM APIs for these pipelines
