---
name: walkcroach-video-studio
description: >-
  Produces up to 30-second marketing videos with Nova Pro as orchestrator,
  one Nova Reel MULTI_SHOT_AUTOMATED invoke (durationSeconds=30), Polly
  voiceover, and ffmpeg compose. Paid-only; max one video per rolling 72 hours.
license: WalkCroach original
origin: walkcroach:web-modules
---

# WalkCroach Video Studio (30s)

## Hard product rules

- **Max duration 30 seconds** (DB check: `duration_sec <= 30`)
- **Max 1 video per owner per rolling 72 hours**
- **Paid only**; Nova Pro orchestrates
- Cost ~$2.40 Reel + Polly/compose → **270 credits**
- **One async job** — `MULTI_SHOT_AUTOMATED` with `durationSeconds: 30` (not five separate 6s `TEXT_VIDEO` / MANUAL shots)

## Pipeline

```
Propose reelPrompt + voiceover + aspect → confirm
 → debit 270 + assert video_jobs 72h slot
 → Bedrock StartAsyncInvoke Nova Reel MULTI_SHOT_AUTOMATED (durationSeconds=30)
 → poll GetAsyncInvoke → silent MP4 in S3
 → Polly neural TTS → audio
 → compose Lambda (ffmpeg): mux + branded outro ~2s + web MP4
 → optional 9:16 crop
 → video_jobs status=ready
```

## Scripts

| Script | Purpose |
|---|---|
| `scripts/assert_reel_still.py` | Legacy MANUAL still QA (1280×720) — unused on AUTOMATED default |

## Nova Reel notes

- Model: `amazon.nova-reel-v1:1`
- **Default task:** `MULTI_SHOT_AUTOMATED` — one text prompt (≤4000 chars), `durationSeconds: 30`
- Output: 1280×720 @ 24fps; English prompts
- Region: async invoke typically **us-east-1**
- `MULTI_SHOT_MANUAL` remains available in code for brand-still experiments; product path is AUTOMATED
- Reel has **no audio** — Polly is mandatory for voiced ads

## UX

- Chat shows async job card with progress (queued → generating → composing → ready)
- Failure states user-visible with retry (failed jobs do not consume the 72h cap)

## Never

- Stitch multiple Reel jobs for >30s
- Start without confirm + credit debit
- Run for free tier
- Default to five separate 6-second MANUAL shots when the user wants one 30s video
