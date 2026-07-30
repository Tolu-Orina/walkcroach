---
name: walkcroach-video-studio
description: >-
  Produces up to 30-second marketing videos with Nova Pro as orchestrator,
  Nova Canvas reference stills, Nova Reel MULTI_SHOT_MANUAL, Polly voiceover,
  and ffmpeg compose. Paid-only; max one video per rolling 72 hours.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach Video Studio (30s)

## Hard product rules

- **Max duration 30 seconds** (DB check: `duration_sec <= 30`)
- **Max 1 video per owner per rolling 72 hours**
- **Paid only**; Nova Pro orchestrates
- Cost ~$2.65–2.75 underlying → **270 credits**
- Reference stills (typically 5) consume **image daily quota** — require quota before start

## Pipeline

```
Propose shot list + voiceover + aspect → confirm
 → Nova Pro: 5 shots × 6s + script
 → Canvas: 5× 1280×720 reference stills (color-guided)
 → for each still:
      python scripts/assert_reel_still.py shot_N.png
      python ../walkcroach-image-gen/scripts/check_image_asset.py shot_N.png
 → Bedrock StartAsyncInvoke Nova Reel MULTI_SHOT_MANUAL
 → poll GetAsyncInvoke → silent MP4 in S3
 → Polly neural TTS → audio
 → compose Lambda (ffmpeg): mux + branded outro ~2s + web MP4
 → optional 9:16 crop
 → video_jobs status=ready
```

## Scripts

| Script | Purpose |
|---|---|
| `scripts/assert_reel_still.py` | Enforce 1280×720 before Reel accepts the still |

## Nova Reel notes

- Model: `amazon.nova-reel-v1:1`
- Output: 1280×720 @ 24fps; English prompts
- Region: async invoke typically **us-east-1** — plan cross-region if API is eu-west-2
- `MULTI_SHOT_AUTOMATED` allowed for simpler jobs; prefer **MANUAL** with Canvas stills for brand consistency
- Reel has **no audio** — Polly is mandatory for voiced ads

## UX

- Chat shows async job card with progress (queued → generating → composing → ready)
- Failure states user-visible with retry (retry still respects 72h cap if a prior job reached `ready`; failed jobs may be excluded from cap — product default: **only successful or in-flight jobs count**)

## Never

- Stitch multiple Reel jobs for >30s
- Start without confirm + credit debit
- Run for free tier
