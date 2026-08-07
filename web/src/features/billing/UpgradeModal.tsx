import { useEffect, useState } from 'react';
import { getBillingStatus, startBillingCheckout } from '../../api/client';

type Props = {
  open: boolean;
  message: string;
  feature?: string;
  onClose: () => void;
};

/**
 * Free → Paid conversion surface (Phase G4).
 * Hard caps stay after upgrade — this sells access, not uncapped burn.
 */
export function UpgradeModal({ open, message, feature, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutEnabled, setCheckoutEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setCheckoutEnabled(null);
    void getBillingStatus()
      .then((s) => {
        if (!cancelled) setCheckoutEnabled(s.checkoutEnabled);
      })
      .catch(() => {
        if (!cancelled) setCheckoutEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const onUpgrade = async () => {
    if (checkoutEnabled === false) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await startBillingCheckout();
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
    >
      <div className="depth-surface glass-strong glass-hairline w-full max-w-md p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-signal">
          Paid plan · ~$20/mo
        </p>
        <h2
          id="upgrade-title"
          className="mt-2 font-display text-xl font-bold text-paper"
        >
          Unlock creatives & connectors
        </h2>
        <p className="mt-2 text-sm text-mist">{message}</p>
        {feature && (
          <p className="mt-1 font-mono text-[11px] text-mist/80">
            Feature: {feature}
          </p>
        )}
        <ul className="mt-4 space-y-1.5 text-[13px] text-mist">
          <li>Nova image creatives (slides, flyers, Canvas)</li>
          <li>Images ≤3/day · Video ≤1/72h when studio is live (hard caps)</li>
          <li>Connector writes (Gmail, Calendar, Slack, …)</li>
          <li>Shared credit pool with Chrome</li>
        </ul>
        {checkoutEnabled === false && (
          <p className="mt-3 text-sm text-mist" role="status">
            Billing checkout is not configured in this environment yet.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-ember">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || checkoutEnabled !== true}
            onClick={() => void onUpgrade()}
            className="interactive rounded-[var(--radius-control)] bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {busy
              ? 'Opening Checkout…'
              : checkoutEnabled === null
                ? 'Checking billing…'
                : 'Upgrade · ~$20/mo'}
          </button>
          <button
            type="button"
            disabled={busy}
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
