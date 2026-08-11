type ProductErrorBannerProps = {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
};

/** Inline error with optional retry — situation + next step. */
export function ProductErrorBanner({
  message,
  onRetry,
  retryLabel = 'Try again',
}: ProductErrorBannerProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-ember/40 bg-ember/10 px-4 py-3"
      role="alert"
    >
      <p className="text-sm text-ember">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="btn-ghost shrink-0 text-sm text-ember hover:text-paper"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
