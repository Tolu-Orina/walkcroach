import type { UsageSummary } from '../../api/client';

/** Shared monthly credit pool meter (Web + SDK keys). */
export function CreditPoolBar({
  usage,
  compact = false,
}: {
  usage: UsageSummary;
  compact?: boolean;
}) {
  const monthly = usage.monthlyCredits || 0;
  const remaining = usage.remaining ?? 0;
  const used = usage.used ?? Math.max(0, monthly - remaining);
  const pctUsed = monthly > 0 ? Math.min(100, Math.round((used / monthly) * 100)) : 0;
  const tone =
    remaining === 0
      ? 'bg-ember'
      : remaining / Math.max(monthly, 1) < 0.15
        ? 'bg-amber-400'
        : 'bg-signal';

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-paper">
          {remaining} / {monthly} credits left
        </span>
        <span className="font-mono text-[11px] text-mist">{pctUsed}% used</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={pctUsed}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Monthly credit usage"
      >
        <div
          className={`h-full transition-all ${tone}`}
          style={{ width: `${pctUsed}%` }}
        />
      </div>
      {usage.sharedPool && (
        <p className="text-[11px] text-mist">
          Shared pool — Web chat, Chrome, and SDK keys debit the same balance.
        </p>
      )}
    </div>
  );
}
