/**
 * Video Studio REST + pipeline (Phase D).
 *
 * ConfirmCard → debit 270 + assert 72h video slot
 * → Reel MULTI_SHOT_AUTOMATED (durationSeconds=30, one job)
 * → SFN poll / compose (Polly + ffmpeg)
 * → JobCard polls GET /video-jobs/:id
 *
 * Cap rule (§5.2): status IN (queued|generating|composing|ready) within 72h.
 */
import { randomUUID } from 'node:crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { DbClient } from '@walkcroach/db';
import {
  creativeMetric,
  getReelStatus,
  invokeComposeVideo,
  startMultiShotAutomated,
  type VideoBrief,
} from '@walkcroach/agent-harness';
import type { AuthContext } from '../auth.js';
import { jsonResponse } from '../http.js';
import { getPresignedGetUrl } from '../artefacts.js';
import {
  assertCredits,
  assertVideoQuota,
  debitCredits,
  getEntitlement,
  HARD_QUOTAS,
  hasVideoAccess,
  peekVideoQuota,
  refundCredits,
} from './billing.js';

type RestResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const VIDEO_CREDIT_COST = 270;

function videoStateMachineArn(): string {
  return (process.env.VIDEO_STATE_MACHINE_ARN ?? '').trim();
}

/** Explicit stub only — empty SFN ARN must NOT imply stub (burns Reel otherwise). */
function videoStudioStub(): boolean {
  const v = (process.env.VIDEO_STUDIO_STUB ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse s3://bucket/key → key (or return path-like URIs unchanged). */
export function s3UriToObjectKey(uri: string | undefined | null): string | null {
  if (!uri) return null;
  const trimmed = uri.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('s3://')) {
    const without = trimmed.slice('s3://'.length);
    const slash = without.indexOf('/');
    if (slash < 0) return null;
    return without.slice(slash + 1) || null;
  }
  return trimmed;
}

async function pollReelUntilDone(invocationArn: string): Promise<{
  status: string;
  outputS3Uri?: string;
  failureMessage?: string;
}> {
  if (invocationArn.startsWith('stub:') || videoStudioStub()) {
    return getReelStatus(invocationArn);
  }
  const maxAttempts = Math.max(
    1,
    Number(process.env.VIDEO_REEL_POLL_ATTEMPTS ?? 12),
  );
  const delayMs = Math.max(
    1000,
    Number(process.env.VIDEO_REEL_POLL_MS ?? 20_000),
  );
  for (let i = 0; i < maxAttempts; i++) {
    const st = await getReelStatus(invocationArn);
    if (st.status === 'Completed' || st.status === 'Failed') return st;
    if (i < maxAttempts - 1) await sleep(delayMs);
  }
  return { status: 'Failed', failureMessage: 'reel_poll_timeout' };
}

type VideoJobRow = {
  id: string;
  owner_id: string;
  shot_list: unknown;
  voiceover_script: string | null;
  duration_sec: number;
  aspect: string;
  invocation_arn: string | null;
  status: string;
  s3_key: string | null;
  preview_s3_key: string | null;
  credits_charged: number;
  images_consumed: number;
  error: unknown;
  created_at: Date;
  updated_at: Date;
};

function briefFromShotList(shotList: unknown, voiceover: string | null, aspect: string): VideoBrief {
  const list = Array.isArray(shotList) ? shotList : [];
  const meta =
    list[0] && typeof list[0] === 'object'
      ? (list[0] as Record<string, unknown>)
      : {};
  const reelPrompt = String(
    meta.reelPrompt ?? meta.text ?? voiceover ?? 'WalkCroach 30 second teaser',
  ).slice(0, 4000);
  return {
    title: String(meta.title ?? 'Video'),
    brand: String(meta.brand ?? 'WalkCroach'),
    reelPrompt,
    voiceoverScript: voiceover ?? '',
    shots: [],
    durationSec: 30,
    aspect: aspect === '9:16' ? '9:16' : '16:9',
    estimatedImages: 0,
    palette: ['#0b0c0f', '#f2f3f5', '#f0b429', '#6b9eff'],
  };
}

export async function handleGetVideoJob(
  db: DbClient,
  auth: AuthContext,
  jobId: string,
): Promise<RestResult> {
  const { rows } = await db.query<VideoJobRow>(
    `SELECT id, owner_id, shot_list, voiceover_script, duration_sec, aspect,
            invocation_arn, status, s3_key, preview_s3_key, credits_charged,
            images_consumed, error, created_at, updated_at
     FROM video_jobs WHERE id = $1::uuid`,
    [jobId],
  );
  const row = rows[0];
  if (!row || row.owner_id !== auth.ownerId) {
    return jsonResponse(404, { error: 'not_found' });
  }

  let downloadUrl: string | null = null;
  if (row.status === 'ready' && row.s3_key) {
    try {
      downloadUrl = await getPresignedGetUrl(row.s3_key, 900);
    } catch {
      downloadUrl = null;
    }
  }

  return jsonResponse(200, {
    id: row.id,
    status: row.status,
    durationSec: row.duration_sec,
    aspect: row.aspect,
    creditsCharged: row.credits_charged,
    imagesConsumed: row.images_consumed,
    downloadUrl,
    s3Key: row.s3_key,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}

export async function handleConfirmVideoJob(
  db: DbClient,
  auth: AuthContext,
  jobId: string,
): Promise<RestResult> {
  const plan = await getEntitlement(db, auth.ownerId);
  if (!hasVideoAccess(plan)) {
    return jsonResponse(402, {
      error: 'pro_plan_required',
      message: 'Video studio requires the Pro plan.',
    });
  }

  const { rows } = await db.query<VideoJobRow>(
    `SELECT id, owner_id, shot_list, voiceover_script, duration_sec, aspect,
            invocation_arn, status, s3_key, preview_s3_key, credits_charged,
            images_consumed, error, created_at, updated_at
     FROM video_jobs WHERE id = $1::uuid`,
    [jobId],
  );
  const row = rows[0];
  if (!row || row.owner_id !== auth.ownerId) {
    return jsonResponse(404, { error: 'not_found' });
  }
  if (row.status === 'ready') {
    return jsonResponse(200, {
      ok: true,
      jobId,
      status: 'ready',
      alreadyReady: true,
    });
  }
  if (['queued', 'generating', 'composing'].includes(row.status)) {
    return jsonResponse(200, {
      ok: true,
      jobId,
      status: row.status,
      alreadyStarted: true,
    });
  }
  if (row.status !== 'proposed') {
    return jsonResponse(409, { error: 'invalid_status', status: row.status });
  }

  const imageNeed = 0; // MULTI_SHOT_AUTOMATED — no Canvas stills
  void row.shot_list;

  const credits = await assertCredits(db, auth.ownerId, 'start_video_job');
  if (!credits.ok) {
    return jsonResponse(402, {
      error: 'insufficient_credits',
      remaining: credits.remaining,
    });
  }

  // Atomic claim: proposed→queued only if 72h slot is free (other counting jobs).
  // Closes double-confirm / dual-job races that previously double-debited.
  const { rows: claimed } = await db.query<{ id: string }>(
    `UPDATE video_jobs v
     SET status = 'queued',
         credits_charged = $2,
         images_consumed = $3,
         updated_at = now()
     WHERE v.id = $1::uuid
       AND v.owner_id = $4
       AND v.status = 'proposed'
       AND (
         SELECT COUNT(*)::int
         FROM video_jobs o
         WHERE o.owner_id = $4
           AND o.status IN ('queued', 'generating', 'composing', 'ready')
           AND o.created_at > now() - interval '72 hours'
           AND o.id <> v.id
       ) < $5
     RETURNING v.id`,
    [
      jobId,
      VIDEO_CREDIT_COST,
      imageNeed,
      auth.ownerId,
      HARD_QUOTAS.video_gen_3day.limit,
    ],
  );

  if (!claimed[0]) {
    const videoQ = await assertVideoQuota(db, auth.ownerId);
    if (!videoQ.ok) {
      creativeMetric('CreativeQuotaDenied', {
        feature: 'start_video_job',
        tier: 'paid',
      });
      return jsonResponse(429, {
        error: 'video_quota_exceeded',
        used: videoQ.used,
        limit: videoQ.limit,
        resetAt: videoQ.resetAt,
      });
    }
    const { rows: again } = await db.query<{ status: string }>(
      `SELECT status FROM video_jobs WHERE id = $1::uuid AND owner_id = $2`,
      [jobId, auth.ownerId],
    );
    const st = again[0]?.status;
    if (st && ['queued', 'generating', 'composing'].includes(st)) {
      return jsonResponse(200, {
        ok: true,
        jobId,
        status: st,
        alreadyStarted: true,
      });
    }
    if (st === 'ready') {
      return jsonResponse(200, {
        ok: true,
        jobId,
        status: 'ready',
        alreadyReady: true,
      });
    }
    return jsonResponse(409, { error: 'confirm_race', status: st ?? 'unknown' });
  }

  const debit = await debitCredits(db, auth.ownerId, 'start_video_job', undefined, {
    jobId,
  });
  if (!debit.ok) {
    await db.query(
      `UPDATE video_jobs
       SET status = 'proposed', credits_charged = 0, updated_at = now()
       WHERE id = $1::uuid AND status = 'queued'`,
      [jobId],
    );
    return jsonResponse(402, {
      error: 'insufficient_credits',
      remaining: debit.remaining,
    });
  }

  // Kick pipeline: SFN when configured; otherwise inline poll+compose (or stub).
  try {
    if (videoStateMachineArn() && !videoStudioStub()) {
      const sfn = new SFNClient({});
      await sfn.send(
        new StartExecutionCommand({
          stateMachineArn: videoStateMachineArn(),
          name: `video-${jobId}`.slice(0, 80),
          input: JSON.stringify({
            jobId,
            ownerId: auth.ownerId,
            step: 'start',
            pollAttempt: 0,
          }),
        }),
      );
    } else {
      await runVideoPipelineLocal(db, auth.ownerId, jobId);
    }
  } catch (err) {
    creativeMetric('VideoJobFail', {
      feature: 'pipeline_start',
      tier: 'paid',
    });
    await db.query(
      `UPDATE video_jobs
       SET status = 'failed',
           error = $2::jsonb,
           updated_at = now()
       WHERE id = $1::uuid`,
      [
        jobId,
        JSON.stringify({
          message: err instanceof Error ? err.message : String(err),
        }),
      ],
    );
    // Refund only when the pipeline never started (start throw / ExecutionAlreadyExists race).
    await refundCredits(db, auth.ownerId, 'start_video_job', VIDEO_CREDIT_COST, undefined, {
      jobId,
      reason: 'pipeline_start_failed',
    });
    return jsonResponse(500, {
      error: 'pipeline_start_failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const { rows: after } = await db.query<{ status: string }>(
    `SELECT status FROM video_jobs WHERE id = $1::uuid`,
    [jobId],
  );

  return jsonResponse(200, {
    ok: true,
    jobId,
    status: after[0]?.status ?? 'queued',
    creditsCharged: VIDEO_CREDIT_COST,
    remainingCredits: debit.remaining,
    remainingVideo: (await peekVideoQuota(db, auth.ownerId)).remaining,
  });
}

/**
 * Local/CI + stub path AND SFN `start` step:
 * Canvas (best-effort) → Reel start. Compose is a separate step when using SFN;
 * stub/local continues through compose in one shot when VIDEO_STUDIO_STUB / no SFN.
 */
export async function runVideoPipelineLocal(
  db: DbClient,
  ownerId: string,
  jobId: string,
  opts: { composeInline?: boolean } = {},
): Promise<void> {
  const composeInline = opts.composeInline ?? true;
  const { rows } = await db.query<VideoJobRow>(
    `SELECT id, owner_id, shot_list, voiceover_script, duration_sec, aspect,
            invocation_arn, status, s3_key, preview_s3_key, credits_charged,
            images_consumed, error, created_at, updated_at
     FROM video_jobs WHERE id = $1::uuid`,
    [jobId],
  );
  const row = rows[0];
  if (!row) throw new Error('video job missing');

  await db.query(
    `UPDATE video_jobs SET status = 'generating', updated_at = now() WHERE id = $1::uuid`,
    [jobId],
  );

  const brief = briefFromShotList(row.shot_list, row.voiceover_script, row.aspect);

  const started = await startMultiShotAutomated({
    jobId,
    ownerId,
    text: brief.reelPrompt,
    durationSec: 30,
  });

  await db.query(
    `UPDATE video_jobs
     SET invocation_arn = $2, images_consumed = 0, updated_at = now()
     WHERE id = $1::uuid`,
    [jobId, started.invocationArn],
  );

  if (!composeInline) {
    return;
  }

  const status = await pollReelUntilDone(started.invocationArn);
  if (status.status === 'Failed') {
    creativeMetric('VideoJobFail', { feature: 'reel', tier: 'paid' });
    await db.query(
      `UPDATE video_jobs
       SET status = 'failed', error = $2::jsonb, updated_at = now()
       WHERE id = $1::uuid`,
      [jobId, JSON.stringify({ message: status.failureMessage ?? 'reel failed' })],
    );
    return;
  }

  await db.query(
    `UPDATE video_jobs SET status = 'composing', updated_at = now() WHERE id = $1::uuid`,
    [jobId],
  );

  const reelS3Key = s3UriToObjectKey(status.outputS3Uri);
  const composed = await invokeComposeVideo({
    ownerId,
    jobId,
    voiceoverScript: brief.voiceoverScript,
    brand: brief.brand,
    aspect: brief.aspect,
    reelS3Key,
  });

  if (!composed.ok) {
    creativeMetric('VideoJobFail', { feature: 'compose', tier: 'paid' });
    await db.query(
      `UPDATE video_jobs
       SET status = 'failed', error = $2::jsonb, updated_at = now()
       WHERE id = $1::uuid`,
      [jobId, JSON.stringify({ message: composed.error ?? 'compose failed' })],
    );
    return;
  }

  creativeMetric('VideoJobSuccess', {
    feature: composed.partialCompose ? 'compose_partial' : 'compose',
    tier: 'paid',
  });
  await db.query(
    `UPDATE video_jobs
     SET status = 'ready',
         s3_key = $2,
         error = $3::jsonb,
         updated_at = now()
     WHERE id = $1::uuid`,
    [
      jobId,
      composed.s3Key ?? null,
      composed.partialCompose
        ? JSON.stringify({
            partialCompose: true,
            note: composed.note ?? 'video-only mux fallback',
          })
        : null,
    ],
  );

  try {
    const { embedAndStoreVideoJob } = await import('@walkcroach/agent-harness');
    await embedAndStoreVideoJob({
      db,
      jobId,
      title: brief.title,
      reelPrompt: brief.reelPrompt,
      voiceoverScript: brief.voiceoverScript,
      brand: brief.brand,
    });
  } catch {
    /* optional */
  }
}

/**
 * SFN task payload handler — called when video-worker receives
 * `{ source: 'sfn-video', step, jobId, ownerId }`.
 */
export async function handleVideoSfnStep(
  db: DbClient,
  payload: {
    step: string;
    jobId: string;
    ownerId: string;
  },
): Promise<Record<string, unknown>> {
  const { step, jobId, ownerId } = payload;
  if (step === 'start' || step === 'generate') {
    await runVideoPipelineLocal(db, ownerId, jobId, { composeInline: false });
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM video_jobs WHERE id = $1::uuid`,
      [jobId],
    );
    return { jobId, status: rows[0]?.status ?? 'unknown' };
  }
  if (step === 'poll') {
    const { rows } = await db.query<{ invocation_arn: string | null; status: string }>(
      `SELECT invocation_arn, status FROM video_jobs WHERE id = $1::uuid`,
      [jobId],
    );
    const arn = rows[0]?.invocation_arn;
    if (!arn) return { jobId, reelStatus: 'Failed', error: 'no_invocation' };
    const st = await getReelStatus(arn);
    if (st.status === 'Completed') {
      await db.query(
        `UPDATE video_jobs SET status = 'composing', updated_at = now() WHERE id = $1::uuid`,
        [jobId],
      );
    }
    if (st.status === 'Failed') {
      creativeMetric('VideoJobFail', { feature: 'reel', tier: 'paid' });
      await db.query(
        `UPDATE video_jobs
         SET status = 'failed', error = $2::jsonb, updated_at = now()
         WHERE id = $1::uuid`,
        [jobId, JSON.stringify({ message: st.failureMessage ?? 'reel failed' })],
      );
    }
    return {
      jobId,
      reelStatus: st.status,
      reelS3Key: s3UriToObjectKey(st.outputS3Uri),
    };
  }
  if (step === 'compose') {
    const { rows } = await db.query<VideoJobRow>(
      `SELECT id, owner_id, shot_list, voiceover_script, duration_sec, aspect,
              invocation_arn, status, s3_key, preview_s3_key, credits_charged,
              images_consumed, error, created_at, updated_at
       FROM video_jobs WHERE id = $1::uuid`,
      [jobId],
    );
    const row = rows[0];
    if (!row) return { ok: false, error: 'missing_job' };
    const brief = briefFromShotList(row.shot_list, row.voiceover_script, row.aspect);
    let reelS3Key: string | null = null;
    if (row.invocation_arn) {
      const st = await getReelStatus(row.invocation_arn);
      reelS3Key = s3UriToObjectKey(st.outputS3Uri);
    }
    const composed = await invokeComposeVideo({
      ownerId,
      jobId,
      voiceoverScript: brief.voiceoverScript,
      brand: brief.brand,
      aspect: brief.aspect,
      reelS3Key,
    });
    if (!composed.ok) {
      creativeMetric('VideoJobFail', { feature: 'compose', tier: 'paid' });
      await db.query(
        `UPDATE video_jobs
         SET status = 'failed', error = $2::jsonb, updated_at = now()
         WHERE id = $1::uuid`,
        [jobId, JSON.stringify({ message: composed.error ?? 'compose failed' })],
      );
      return { ok: false, error: composed.error };
    }
    creativeMetric('VideoJobSuccess', {
      feature: composed.partialCompose ? 'compose_partial' : 'compose',
      tier: 'paid',
    });
    await db.query(
      `UPDATE video_jobs
       SET status = 'ready',
           s3_key = $2,
           error = $3::jsonb,
           updated_at = now()
       WHERE id = $1::uuid`,
      [
        jobId,
        composed.s3Key ?? null,
        composed.partialCompose
          ? JSON.stringify({
              partialCompose: true,
              note: composed.note ?? 'video-only mux fallback',
            })
          : null,
      ],
    );
    try {
      const { embedAndStoreVideoJob } = await import('@walkcroach/agent-harness');
      await embedAndStoreVideoJob({
        db,
        jobId,
        title: brief.title,
        reelPrompt: brief.reelPrompt,
        voiceoverScript: brief.voiceoverScript,
        brand: brief.brand,
      });
    } catch {
      /* Titan may be unavailable in local/dev */
    }
    return { ok: true, jobId, status: 'ready', s3Key: composed.s3Key };
  }
  return { ok: false, error: `unknown_step:${step}` };
}

/** Insert a proposed video job from a brief (agent tool path). */
export async function insertProposedVideoJob(
  db: DbClient,
  params: {
    ownerId: string;
    sessionId?: string | null;
    projectId?: string | null;
    brief: VideoBrief;
  },
): Promise<string> {
  const id = randomUUID();
  const shotList = [
    {
      taskType: 'MULTI_SHOT_AUTOMATED',
      reelPrompt: params.brief.reelPrompt,
      title: params.brief.title,
      brand: params.brief.brand,
    },
  ];
  await db.query(
    `INSERT INTO video_jobs (
       id, project_id, owner_id, session_id, shot_list, voiceover_script,
       duration_sec, aspect, status, images_consumed
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4::uuid, $5::jsonb, $6,
       $7, $8, 'proposed', $9
     )`,
    [
      id,
      params.projectId ?? null,
      params.ownerId,
      params.sessionId ?? null,
      JSON.stringify(shotList),
      params.brief.voiceoverScript,
      params.brief.durationSec,
      params.brief.aspect,
      0,
    ],
  );
  return id;
}
