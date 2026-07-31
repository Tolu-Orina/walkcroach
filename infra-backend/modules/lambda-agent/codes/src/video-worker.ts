/**
 * Non-streaming Lambda entry for Step Functions video steps (Phase D4).
 * Separated from streamifyResponse API handler — SFN cannot use response streaming.
 */
import { createDbClient } from '@walkcroach/db';
import { ensureRuntimeSecrets } from './secrets.js';
import { handleVideoSfnStep } from './handlers/video.js';

export async function handler(event: {
  source?: string;
  step?: string;
  jobId?: string;
  ownerId?: string;
  forceFail?: boolean;
  errorMessage?: string;
}): Promise<Record<string, unknown>> {
  await ensureRuntimeSecrets();
  if (event.source !== 'sfn-video' || !event.jobId || !event.ownerId || !event.step) {
    return { ok: false, error: 'invalid_sfn_payload' };
  }
  if (event.forceFail || event.step === 'fail') {
    const { creativeMetric } = await import('@walkcroach/agent-harness');
    creativeMetric('VideoJobFail', {
      feature: event.errorMessage === 'reel_poll_timeout' ? 'reel_timeout' : 'sfn',
      tier: 'paid',
    });
    const db = createDbClient();
    try {
      await db.query(
        `UPDATE video_jobs
         SET status = 'failed',
             error = $2::jsonb,
             updated_at = now()
         WHERE id = $1::uuid
           AND status NOT IN ('ready', 'failed')`,
        [
          event.jobId,
          JSON.stringify({
            message: (event.errorMessage ?? 'sfn_failed').slice(0, 500),
          }),
        ],
      );
      return { ok: false, jobId: event.jobId, status: 'failed' };
    } finally {
      await db.close();
    }
  }
  const db = createDbClient();
  try {
    return await handleVideoSfnStep(db, {
      step: event.step,
      jobId: event.jobId,
      ownerId: event.ownerId,
    });
  } finally {
    await db.close();
  }
}
