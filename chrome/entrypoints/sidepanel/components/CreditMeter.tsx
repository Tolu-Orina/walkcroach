import type { CreditBalance } from '../../../lib/api';

/**
 * Shared Web/Chrome credit pool (plan C7 → master plan Part 1 §4).
 *
 * Renders nothing until `fetchCredits` returns real data, so there is no
 * placeholder number to mistake for a balance. When the ledger endpoint ships
 * this appears on its own.
 */
export function CreditMeter({ credits }: { credits: CreditBalance | null }) {
  if (!credits) return null;

  const { remaining, allowance } = credits;
  const pct = Math.max(0, Math.min(100, (remaining / allowance) * 100));
  const tone =
    remaining <= 0
      ? 'wc-credits__fill--spent'
      : pct <= 15
        ? 'wc-credits__fill--low'
        : '';

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
        aria-valuetext={`${remaining.toLocaleString()} of ${allowance.toLocaleString()} credits remaining`}
      >
        <div
          className={`wc-credits__fill ${tone}`.trim()}
          style={{ width: `${pct}%` }}
        />
      </div>
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
