---
name: walkcroach-quota-and-credits
description: >-
  Enforces WalkCroach Web free vs paid entitlements, credit weights, and hard
  caps for image (3/day) and video (1×30s per 3 days). Use before any creative
  or connector write tool call.
license: WalkCroach original
origin: walkcroach:web-modules
---

# Quotas, Credits, and Entitlements

## Tiers (Web)

| Tier | Text (Nova 2 Lite + thinking) | Creative briefs (Lite) | Images (Canvas) | Video (Reel 30s) | Connectors |
|---|---|---|---|---|---|
| **Free** | Yes (monthly credit grant) | No | No | No | Read-only if connected; writes gated |
| **Paid (~$20/mo)** | Yes | Yes | **Max 3 per rolling 24h** | **Max 1 per rolling 72h**, ≤30s | Full propose→confirm |

Chrome paid shares the Web paid credit pool; creative hard caps are **per owner_id**, not per surface.

## Hard caps (DB-enforced, not only UI)

```sql
-- Conceptual; see migrations in the Web Modules plan
-- images: COUNT(*) FROM creative_assets
--   WHERE owner_id=$1 AND kind='image' AND created_at > now()-interval '24 hours'
--   AND status IN ('generating','ready')  < 3
-- video: COUNT(*) FROM video_jobs
--   WHERE owner_id=$1 AND created_at > now()-interval '72 hours'
--   AND status NOT IN ('failed','declined')  < 1
-- AND duration_sec <= 30
```

On deny: return structured error `{ code: 'QUOTA_IMAGE_DAY' | 'QUOTA_VIDEO_3DAY' | 'PAID_REQUIRED', resetAt, remaining }`.

## Credit weights (extend `CREDIT_COSTS`)

| Action | Credits | Notes |
|---|---|---|
| `agent_turn` | 1 | Lite or Pro text |
| `generate_image` | 4 | Still counts toward 3/day |
| `render_flyer` | 10 | Includes brief + ≤2 images (images also hit daily cap) |
| `render_pptx` | 20 | Includes brief + images used in deck |
| `start_video_job` | 270 | Also hits 1/72h cap |
| `connector_write` | 2 | send email, create event, etc. |
| `connector_read` | 0–1 | balance/list — prefer 0 or 1 |

Atomic `debitCredits` **before** starting expensive async jobs (same pattern as deploy).

## Propose → confirm

Any action that spends credits or hits a hard cap must show:

- What will be generated
- Credits to charge
- Remaining daily/3-day quota after success
- Cancel / Confirm

## UX copy

- Free user asks for video: upgrade CTA, do not start the job
- Paid user at image cap: "You've used 3/3 images today. Next reset {time}."
- Paid user at video cap: "Next 30s video available {time}."
