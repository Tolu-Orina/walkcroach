type CreativeBriefReady = {
  assetId: string;
  kind: 'slide_deck';
  brief: {
    title?: string;
    subtitle?: string;
    slides?: Array<{ title?: string; bullets?: string[] }>;
  };
  credits: number;
  estimatedImages: number;
  remainingImages: number;
  imageDailyLimit: number;
  stub?: boolean;
};

type ConfirmCardProps = {
  pending: CreativeBriefReady;
  busy?: boolean;
  onConfirm: () => void;
  onDecline: () => void;
};

/**
 * Propose → confirm → execute card for Creative Studio decks (Phase B5 / A6).
 * Shows slide count, estimated images, credits, and remaining image quota.
 */
export function CreativeConfirmCard({
  pending,
  busy,
  onConfirm,
  onDecline,
}: ConfirmCardProps) {
  const slideCount = pending.brief.slides?.length ?? 0;
  const title = pending.brief.title ?? 'Untitled deck';

  return (
    <div
      className="rounded-[var(--radius-surface)] border border-signal/35 bg-raised/80 p-4"
      role="region"
      aria-label="Confirm slide deck"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wide text-signal">
            Creative Studio · Slides
          </p>
          <h3 className="mt-1 truncate font-display text-lg font-bold text-paper">
            {title}
          </h3>
          {pending.brief.subtitle && (
            <p className="mt-0.5 text-sm text-mist">{pending.brief.subtitle}</p>
          )}
        </div>
        {pending.stub && (
          <span className="shrink-0 rounded-[0.3rem] border border-line px-1.5 py-0.5 font-mono text-[10px] text-mist">
            draft brief
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
          <dt className="font-mono text-[10px] uppercase text-mist">Slides</dt>
          <dd className="mt-0.5 text-sm font-semibold text-paper">
            {slideCount + 1}
            <span className="font-normal text-mist"> incl. title</span>
          </dd>
        </div>
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
        <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-2.5 py-2">
          <dt className="font-mono text-[10px] uppercase text-mist">Format</dt>
          <dd className="mt-0.5 text-sm font-semibold text-paper">.pptx · 16:9</dd>
        </div>
      </dl>

      {slideCount > 0 && (
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
          {busy ? 'Rendering…' : `Confirm · ${pending.credits} credits`}
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
