type ProductPageHeaderProps = {
  eyebrow: string;
  title: string;
  support: string;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryBusyLabel?: string;
  busy?: boolean;
};

/** Standard list/hub header — one primary CTA. */
export function ProductPageHeader({
  eyebrow,
  title,
  support,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryBusyLabel,
  busy,
}: ProductPageHeaderProps) {
  return (
    <header className="border-b border-line pb-8">
      <p className="eyebrow">{eyebrow}</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-paper sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-mist">{support}</p>
        </div>
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled || busy}
          className="btn-primary shrink-0 text-sm"
        >
          {busy && primaryBusyLabel ? primaryBusyLabel : primaryLabel}
        </button>
      </div>
    </header>
  );
}
