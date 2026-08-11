type ProductEmptyStateProps = {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
};

/** Centered empty state with one primary CTA. */
export function ProductEmptyState({
  title,
  body,
  actionLabel,
  onAction,
  actionDisabled,
}: ProductEmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-surface)] border border-dashed border-line px-6 py-16 text-center">
      <h2 className="font-display text-xl font-bold text-paper">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-mist">{body}</p>
      <button
        type="button"
        onClick={onAction}
        disabled={actionDisabled}
        className="btn-primary mt-6 text-sm"
      >
        {actionLabel}
      </button>
    </div>
  );
}
