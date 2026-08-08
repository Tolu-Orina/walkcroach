import { useEffect, useState } from 'react';
import {
  getBillingStatus,
  startBillingCheckout,
  type BillingPlanCatalogItem,
  type BillingStatus,
} from '../../api/client';

type Props = {
  open: boolean;
  message: string;
  feature?: string;
  onClose: () => void;
};

/**
 * Free → Starter / Pro conversion surface.
 * Hard caps stay after upgrade — this sells access, not uncapped burn.
 */
export function UpgradeModal({ open, message, feature, onClose }: Props) {
  const [busyPlan, setBusyPlan] = useState<'starter' | 'pro' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setStatus(null);
    void getBillingStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const wantsVideo = feature === 'video' || /video/i.test(message);
  const paidTiers = (status?.catalog ?? []).filter((p) => p.paid);
  const checkoutEnabled = status?.checkoutEnabled === true;

  const onUpgrade = async (planId: 'starter' | 'pro') => {
    if (!checkoutEnabled) return;
    setBusyPlan(planId);
    setError(null);
    try {
      const result = await startBillingCheckout(planId);
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      if (result.changed) {
        window.location.assign(result.url ?? '/app/settings?billing=success');
        return;
      }
      setError('Checkout did not return a URL.');
      setBusyPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusyPlan(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
    >
      <div className="depth-surface glass-strong glass-hairline w-full max-w-lg p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-signal">
          Subscriptions
        </p>
        <h2
          id="upgrade-title"
          className="mt-2 font-display text-xl font-bold text-paper"
        >
          {wantsVideo ? 'Unlock Video on Pro' : 'Choose a plan'}
        </h2>
        <p className="mt-2 text-sm text-mist">{message}</p>
        {feature && (
          <p className="mt-1 font-mono text-[11px] text-mist/80">
            Feature: {feature}
          </p>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {paidTiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              recommended={wantsVideo ? tier.id === 'pro' : tier.id === 'starter'}
              disabled={!checkoutEnabled || !tier.checkoutAvailable || busyPlan !== null}
              busy={busyPlan === tier.id}
              onSelect={() => void onUpgrade(tier.id as 'starter' | 'pro')}
            />
          ))}
        </div>

        {!status && (
          <p className="mt-3 text-sm text-mist" role="status">
            Loading plans…
          </p>
        )}
        {status && !checkoutEnabled && (
          <p className="mt-3 text-sm text-mist" role="status">
            Billing checkout is not configured in this environment yet.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-ember">{error}</p>}
        <div className="mt-5">
          <button
            type="button"
            disabled={busyPlan !== null}
            onClick={onClose}
            className="btn-ghost text-sm"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

function TierCard({
  tier,
  recommended,
  disabled,
  busy,
  onSelect,
}: {
  tier: BillingPlanCatalogItem;
  recommended: boolean;
  disabled: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`flex h-full flex-col rounded-[var(--radius-control)] border p-3 ${
        recommended ? 'border-signal/50 bg-signal/5' : 'border-line bg-ink/30'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold text-paper">{tier.name}</p>
        <p className="text-sm text-mist">{tier.priceLabel}</p>
      </div>
      <p className="mt-1 text-[12px] text-mist">{tier.blurb}</p>
      <ul className="mt-2 space-y-1 text-[11px] text-mist">
        {tier.highlights.slice(0, 3).map((h) => (
          <li key={h}>· {h}</li>
        ))}
      </ul>
      <div className="mt-auto pt-3">
        <button
          type="button"
          disabled={disabled || !tier.checkoutAvailable}
          onClick={onSelect}
          className="interactive w-full rounded-[var(--radius-control)] bg-signal px-3 py-2 text-xs font-semibold text-ink disabled:opacity-50"
        >
          {busy
            ? 'Opening…'
            : !tier.checkoutAvailable
              ? 'Unavailable'
              : `Choose ${tier.name}`}
        </button>
      </div>
    </div>
  );
}
