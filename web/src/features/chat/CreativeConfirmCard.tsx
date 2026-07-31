type CreativeBriefReady = {
  assetId?: string;
  jobId?: string;
  kind: 'slide_deck' | 'flyer' | 'video';
  brief: {
    title?: string;
    subtitle?: string;
    headline?: string;
    support?: string;
    cta?: string;
    brand?: string;
    eyebrow?: string;
    template?: string;
    philosophy?: { name?: string; notes?: string };
    voiceoverScript?: string;
    reelPrompt?: string;
    durationSec?: number;
    aspect?: string;
    shots?: Array<{ title?: string; text?: string; bullets?: string[] }>;
    slides?: Array<{ title?: string; bullets?: string[] }>;
  };
  credits: number;
  estimatedImages: number;
  remainingImages: number;
  imageDailyLimit: number;
  remainingVideo?: number;
  videoLimit?: number;
  videoResetAt?: string;
  stub?: boolean;
};

type ConfirmCardProps = {
  pending: CreativeBriefReady;
  busy?: boolean;
  onConfirm: () => void;
  onDecline: () => void;
};

/**
 * Propose → confirm → execute card for Creative + Video Studio.
 */
export function CreativeConfirmCard({
  pending,
  busy,
  onConfirm,
  onDecline,
}: ConfirmCardProps) {
  const isFlyer = pending.kind === 'flyer';
  const isVideo = pending.kind === 'video';
  const slideCount = pending.brief.slides?.length ?? 0;
  const title =
    pending.brief.headline ??
    pending.brief.title ??
    (isVideo ? 'Untitled video' : isFlyer ? 'Untitled flyer' : 'Untitled deck');

  const studioLabel = isVideo
    ? 'Video Studio'
    : isFlyer
      ? 'Creative Studio · Flyer'
      : 'Creative Studio · Slides';

  return (
    <div
      className="rounded-[var(--radius-surface)] border border-signal/35 bg-raised/80 p-4"
      role="region"
      aria-label={
        isVideo ? 'Confirm video' : isFlyer ? 'Confirm flyer' : 'Confirm slide deck'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wide text-signal">
            {studioLabel}
          </p>
          <h3 className="mt-1 truncate font-display text-lg font-bold text-paper">
            {title}
          </h3>
          {(pending.brief.support || pending.brief.subtitle) && (
            <p className="mt-0.5 text-sm text-mist">
              {pending.brief.support ?? pending.brief.subtitle}
            </p>
          )}
        </div>
        {pending.stub && (
          <span className="shrink-0 rounded-[0.3rem] border border-line px-1.5 py-0.5 font-mono text-[10px] text-mist">
            draft brief
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {isVideo && (
          <>
            <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
              <dt className="font-mono text-[10px] uppercase text-mist">Reel</dt>
              <dd className="mt-0.5 text-sm font-semibold text-paper">
                1 job
                <span className="font-normal text-mist"> automated</span>
              </dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
              <dt className="font-mono text-[10px] uppercase text-mist">Duration</dt>
              <dd className="mt-0.5 text-sm font-semibold text-paper">
                {pending.brief.durationSec ?? 30}s
              </dd>
            </div>
          </>
        )}
        {isFlyer ? (
          <>
            <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
              <dt className="font-mono text-[10px] uppercase text-mist">
                Template
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-paper">
                {pending.brief.template ?? 'sale'}
              </dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
              <dt className="font-mono text-[10px] uppercase text-mist">
                Philosophy
              </dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-paper">
                {pending.brief.philosophy?.name ?? '—'}
              </dd>
            </div>
          </>
        ) : !isVideo ? (
          <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
            <dt className="font-mono text-[10px] uppercase text-mist">Slides</dt>
            <dd className="mt-0.5 text-sm font-semibold text-paper">
              {slideCount + 1}
              <span className="font-normal text-mist"> incl. title</span>
            </dd>
          </div>
        ) : null}
        <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
          <dt className="font-mono text-[10px] uppercase text-mist">Images</dt>
          <dd className="mt-0.5 text-sm font-semibold text-paper">
            ~{pending.estimatedImages}
            <span className="font-normal text-mist">
              {' '}
              ({pending.remainingImages}/{pending.imageDailyLimit} left)
            </span>
          </dd>
        </div>
        <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
          <dt className="font-mono text-[10px] uppercase text-mist">Credits</dt>
          <dd className="mt-0.5 text-sm font-semibold text-signal">
            {pending.credits}
          </dd>
        </div>
        {isVideo && (
          <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
            <dt className="font-mono text-[10px] uppercase text-mist">Video slot</dt>
            <dd className="mt-0.5 text-sm font-semibold text-paper">
              {pending.remainingVideo ?? 0}/{pending.videoLimit ?? 1}
              <span className="font-normal text-mist"> /72h</span>
            </dd>
          </div>
        )}
        {!isFlyer && !isVideo && (
          <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
            <dt className="font-mono text-[10px] uppercase text-mist">Format</dt>
            <dd className="mt-0.5 text-sm font-semibold text-paper">
              .pptx · 16:9
            </dd>
          </div>
        )}
        {isFlyer && (
          <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
            <dt className="font-mono text-[10px] uppercase text-mist">Format</dt>
            <dd className="mt-0.5 text-sm font-semibold text-paper">
              .pdf · A4
            </dd>
          </div>
        )}
        {isVideo && (
          <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
            <dt className="font-mono text-[10px] uppercase text-mist">Format</dt>
            <dd className="mt-0.5 text-sm font-semibold text-paper">
              .mp4 · {pending.brief.aspect ?? '16:9'}
            </dd>
          </div>
        )}
      </dl>

      {isFlyer && pending.brief.cta && (
        <p className="mt-3 border-t border-line/60 pt-3 text-[13px] text-mist">
          CTA:{' '}
          <span className="font-semibold text-signal">{pending.brief.cta}</span>
        </p>
      )}

      {isVideo && pending.brief.voiceoverScript && (
        <p className="mt-3 line-clamp-3 border-t border-line/60 pt-3 text-[13px] text-mist">
          VO: {pending.brief.voiceoverScript}
        </p>
      )}
      {isVideo && pending.brief.reelPrompt && (
        <p className="mt-2 line-clamp-2 text-[12px] text-mist/80">
          Reel: {pending.brief.reelPrompt}
        </p>
      )}

      {!isFlyer && !isVideo && slideCount > 0 && (
        <ol className="mt-3 max-h-40 space-y-1 overflow-y-auto border-t border-line/60 pt-3">
          {pending.brief.slides!.map((s, i) => (
            <li key={`${s.title}-${i}`} className="text-[13px] text-mist">
              <span className="font-mono text-[10px] text-signal/80">
                {i + 1}.
              </span>{' '}
              <span className="text-paper">{s.title ?? 'Slide'}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="interactive rounded-[var(--radius-control)] bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {busy
            ? isVideo
              ? 'Starting…'
              : 'Rendering…'
            : `Confirm · ${pending.credits} credits`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="btn-ghost text-sm disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
