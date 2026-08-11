import type { CreditBalance } from '../../../lib/api';

/**
 * Shared Web/Chrome credit pool.
 *
 * - Balance → meter.
 * - Error (signed-in fetch failed) → message + retry (never silent forever).
 * - Neither → hide (device session / signed-out ledger).
 *
 * Low / spent tones are never color-only: a text status sits beside the bar so
 * the cue survives deuteranopia and grayscale screenshots.
 */
export function CreditMeter({
  credits,
  error,
  onRetry,
}: {
  credits: CreditBalance | null;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (error) {
    return (
      <section className="wc-credits" aria-label="Credit balance">
        <div className="wc-context__meta">
          <span className="wc-eyebrow">Credits</span>
        </div>
        <p className="wc-error" role="alert">
          {error}
        </p>
        {onRetry ? (
          <button type="button" className="wc-btn" onClick={onRetry}>
            Retry loading credits
          </button>
        ) : null}
      </section>
    );
  }

  if (!credits) return null;

  const { remaining, allowance } = credits;
  const pct = Math.max(0, Math.min(100, (remaining / allowance) * 100));
  const spent = remaining <= 0;
  const low = !spent && pct <= 15;
  const tone = spent
    ? 'wc-credits__fill--spent'
    : low
      ? 'wc-credits__fill--low'
      : '';
  const resetLabel = credits.resetsAt
    ? new Date(credits.resetsAt).toLocaleDateString()
    : null;
  const status = spent
    ? resetLabel
      ? `Out of credits. Resets ${resetLabel}, or upgrade in WalkCroach Web.`
      : 'Out of credits. Upgrade in WalkCroach Web, or wait for the monthly reset.'
    : low
      ? 'Running low'
      : null;
  const valueText = spent
    ? `${remaining.toLocaleString()} of ${allowance.toLocaleString()} credits remaining — out of credits`
    : low
      ? `${remaining.toLocaleString()} of ${allowance.toLocaleString()} credits remaining — running low`
      : `${remaining.toLocaleString()} of ${allowance.toLocaleString()} credits remaining`;

  return (
    <section className="wc-credits" aria-label="Credit balance">
      <div className="wc-context__meta">
        <span className="wc-eyebrow">Credits</span>
        <span className="wc-mono wc-small">
          {remaining.toLocaleString()} / {allowance.toLocaleString()}
        </span>
      </div>
      <div
        className="wc-credits__bar"
        role="meter"
        aria-valuenow={remaining}
        aria-valuemin={0}
        aria-valuemax={allowance}
        aria-valuetext={valueText}
      >
        <div
          className={`wc-credits__fill ${tone}`.trim()}
          style={{ width: `${pct}%` }}
        />
      </div>
      {status && (
        <p
          className={`wc-credits__status ${
            spent
              ? 'wc-credits__status--spent'
              : low
                ? 'wc-credits__status--low'
                : ''
          }`.trim()}
          role="status"
        >
          {status}
        </p>
      )}
      <p className="wc-muted wc-small">
        Shared with WalkCroach Web
        {credits.resetsAt
          ? ` · resets ${new Date(credits.resetsAt).toLocaleDateString()}`
          : ''}
        {credits.plan ? ` · ${credits.plan}` : ''}
      </p>
    </section>
  );
}
