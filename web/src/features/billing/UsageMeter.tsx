import { useEffect, useState } from 'react';
import { getUsage, type UsageSummary } from '../../api/client';

function planHint(plan: string | undefined): { title: string; suffix: string } {
  if (plan === 'starter') {
    return {
      title: 'Starter plan credits this month (shared with Chrome)',
      suffix: ' · starter',
    };
  }
  if (plan === 'pro' || plan === 'paid') {
    return {
      title: 'Pro plan credits this month (shared with Chrome)',
      suffix: ' · pro',
    };
  }
  return {
    title: 'Free plan credits this month — upgrade for creatives',
    suffix: ' · free',
  };
}

export function UsageMeter() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    const load = () => {
      void getUsage()
        .then(setUsage)
        .catch(() => setUsage(null));
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!usage) return null;

  const pct = usage.monthlyCredits
    ? Math.round((usage.remaining / usage.monthlyCredits) * 100)
    : 0;
  const hint = planHint(usage.plan);

  return (
    <div
      className="flex items-center gap-2 rounded-sm border border-line bg-ink/60 px-2 py-1"
      title={hint.title}
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
        <div
          className="h-full bg-signal transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-mist">
        {usage.remaining}/{usage.monthlyCredits}
        {hint.suffix}
      </span>
    </div>
  );
}
