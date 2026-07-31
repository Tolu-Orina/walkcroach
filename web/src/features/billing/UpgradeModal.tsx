import { useState } from 'react';
import { startBillingCheckout } from '../../api/client';

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

  if (!open) return null;

  const onUpgrade = async () => {
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
      <div className="w-full max-w-md rounded-[var(--radius-surface)] border border-signal/40 bg-panel p-5 shadow-xl">
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
          <li>Nova Pro slides, flyers, and video studio</li>
          <li>Images ≤3/day · Video ≤1/72h (hard caps protect margin)</li>
          <li>Connector writes (Gmail, Calendar, Slack, …)</li>
          <li>Shared credit pool with Chrome</li>
        </ul>
        {error && <p className="mt-3 text-sm text-ember">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onUpgrade()}
            className="interactive rounded-[var(--radius-control)] bg-signal px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {busy ? 'Opening Checkout…' : 'Upgrade · ~$20/mo'}
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
