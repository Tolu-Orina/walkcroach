/**
 * Async Video Studio job card — polls GET /video-jobs/:id (Phase D4).
 */
import { useEffect, useState } from 'react';
import { getVideoJob, type VideoJobStatus } from '../../api/client';

const LABELS: Record<string, string> = {
  proposed: 'Awaiting confirm',
  queued: 'Queued',
  generating: 'Generating (Nova Reel)',
  composing: 'Composing (Polly + ffmpeg)',
  ready: 'Ready',
  failed: 'Failed',
  declined: 'Declined',
};

type Props = {
  jobId: string;
  initialStatus?: string;
  durationSec?: number;
  aspect?: string;
  creditsCharged?: number;
};

export function VideoJobCard({
  jobId,
  initialStatus = 'queued',
  durationSec = 30,
  aspect = '16:9',
  creditsCharged = 270,
}: Props) {
  const [job, setJob] = useState<VideoJobStatus | null>({
    id: jobId,
    status: initialStatus,
    durationSec,
    aspect,
    creditsCharged,
    imagesConsumed: 0,
    downloadUrl: null,
    s3Key: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      void getVideoJob(jobId)
        .then((j) => {
          if (!cancelled) setJob(j);
        })
        .catch(() => {
          /* keep last */
        });
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId]);

  const status = job?.status ?? initialStatus;
  const done = status === 'ready' || status === 'failed';

  return (
    <div
      className="rounded-[var(--radius-surface)] border border-signal/30 bg-raised/70 p-4"
      role="status"
      aria-live="polite"
      aria-label="Video job progress"
    >
      <p className="font-mono text-[10px] uppercase tracking-wide text-signal">
        Video Studio · Job
      </p>
      <h3 className="mt-1 font-display text-base font-bold text-paper">
        {LABELS[status] ?? status}
      </h3>
      <p className="mt-1 font-mono text-[11px] text-mist">
        {durationSec}s · {aspect} · {creditsCharged} credits · {jobId.slice(0, 8)}
      </p>
      {!done && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink">
          <div className="h-full w-2/5 animate-pulse rounded-full bg-signal/80" />
        </div>
      )}
      {status === 'ready' && job?.downloadUrl && (
        <a
          href={job.downloadUrl}
          className="mt-3 inline-flex interactive rounded-[var(--radius-control)] bg-signal px-3 py-1.5 text-sm font-semibold text-ink"
          download
        >
          Download MP4
        </a>
      )}
      {status === 'failed' && (
        <p className="mt-3 text-sm text-red-300">
          {typeof job?.error === 'object' &&
          job?.error &&
          'message' in (job.error as object)
            ? String((job.error as { message?: string }).message)
            : 'Generation failed — failed jobs do not consume the 72h slot.'}
        </p>
      )}
    </div>
  );
}
