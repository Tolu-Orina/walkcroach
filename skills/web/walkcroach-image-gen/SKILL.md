---
name: walkcroach-image-gen
description: >-
  Generates images with Amazon Nova Canvas for WalkCroach Chat creatives.
  Paid-only; max 3 images per rolling 24 hours. Use when the user asks for an
  image, illustration, social still, or reference still for slides/video.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach Image Generation (Nova Canvas)

## Gates

1. `load_skill` → `walkcroach-model-routing` + `walkcroach-quota-and-credits`
2. Paid entitlement required
3. Remaining daily image quota ≥ 1 (and ≥ N if batching)
4. Propose prompt + size + palette → confirm → `generate_image`

## API shape (Bedrock InvokeModel)

Prefer **color-guided** generation when brand hexes exist:

```json
{
  "taskType": "COLOR_GUIDED_GENERATION",
  "colorGuidedGenerationParams": {
    "text": "<prompt>",
    "colors": ["#0b0c0f", "#f0b429", "#6b9eff"]
  },
  "imageGenerationConfig": {
    "width": 1024,
    "height": 1024,
    "quality": "standard",
    "numberOfImages": 1
  }
}
```

Also supported: `TEXT_IMAGE`, `IMAGE_VARIATION`, `BACKGROUND_REMOVAL` (for compositing into slides/flyers).

Resolution rules: sides 320–4096, divisible by 16, aspect 1:4–4:1, < 4.2M pixels.

## Prompt craft (Pro)

- Subject, setting, lighting, style; avoid trademarked characters
- Positive brand cues; keep text-in-image minimal (Canvas is weak at small type — put type in `render_pptx` / `render_flyer`)
- Always ask Pro for **alt text** stored on `creative_assets`

## After generation

```bash
python skills/web/walkcroach-image-gen/scripts/check_image_asset.py /tmp/out.png --min-edge 512
```

- Store PNG/JPEG in S3; row in `creative_assets` (`kind='image'`)
- Embed brief+prompt (Titan) for recall
- Debit 4 credits; increment daily image counter
- Run Bedrock Guardrails / marketing moderation on prompt + alt text
- Fail the tool call if `check_image_asset.py` exits non-zero

## Quotas

- **Max 3 images / owner / rolling 24h** (includes images generated as part of slide/flyer/video pipelines)
- Video reference stills (up to 5 for a 30s job) **consume the daily image budget** — if fewer than 5 remain, refuse the video job with a clear message or offer a lower shot count only when product allows (default: require 5 remaining or abort)

## Never

- Generate for free tier
- Upscale beyond native resolution when placing into slides (HD-enforcement in render tool)
- Skip confirm when quota/credits will be spent
