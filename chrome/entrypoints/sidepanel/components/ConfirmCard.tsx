/**
 * Propose → confirm → execute (Phase C4).
 *
 * The single component every write in the panel passes through. Two shapes:
 *
 *  - `fields` — an editable proposal (sector extraction, price track). The user
 *    can correct the model before anything is stored, which is the whole point:
 *    an LLM guess written silently to CockroachDB is unauditable.
 *  - `summary` — a read-only "here is exactly what will be saved" for writes
 *    with nothing to edit, so Save is still a confirmation and not a silent
 *    commit.
 *
 * Rendered as a `<form>` so Enter submits and Escape-free keyboard users get the
 * native affordance. `busy` disables both paths to make double-execution
 * impossible.
 */
export type ConfirmSummaryRow = { label: string; value: string };

export function ConfirmCard({
  title,
  intent,
  fields,
  summary,
  confirmLabel = 'Confirm & save',
  busy = false,
  /** Shown on the primary button while `busy` (defaults to “Saving…”). */
  busyLabel = 'Saving…',
  /** Shown on the dismiss button (defaults to “Discard”; use “Cancel” for deletes). */
  dismissLabel = 'Discard',
  /** Irreversible once executed — sending mail, posting to a channel. */
  irreversible = false,
  extra,
  onFieldChange,
  onConfirm,
  onDismiss,
}: {
  title: string;
  /** One line naming the consequence, e.g. "Saves to Leads · Acme Ltd". */
  intent?: string;
  fields?: Record<string, string> | null;
  summary?: ConfirmSummaryRow[] | null;
  confirmLabel?: string;
  busy?: boolean;
  busyLabel?: string;
  dismissLabel?: string;
  irreversible?: boolean;
  /** Extra opt-in controls shown above the buttons, e.g. the screenshot toggle. */
  extra?: React.ReactNode;
  onFieldChange?: (key: string, value: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const entries = fields ? Object.entries(fields) : [];

  return (
    <form
      className={
        irreversible ? 'wc-confirm wc-confirm--irreversible' : 'wc-confirm'
      }
      aria-labelledby="wc-confirm-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onConfirm();
      }}
    >
      <div className="wc-confirm__head">
        <h3 className="wc-confirm__title" id="wc-confirm-title">
          {title}
        </h3>
        <span className="wc-eyebrow">Review</span>
      </div>

      {irreversible && (
        <p className="wc-confirm__warn">This cannot be undone.</p>
      )}
      {intent && <p className="wc-muted wc-small">{intent}</p>}

      {entries.length > 0 && (
        <div className="wc-confirm__fields">
          {entries.map(([key, value]) => (
            <label className="wc-field" key={key}>
              <span className="wc-field__label">{humanise(key)}</span>
              <input
                className="wc-input"
                value={value}
                disabled={busy}
                onChange={(e) => onFieldChange?.(key, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}

      {summary && summary.length > 0 && (
        <dl className="wc-summary">
          {summary.map((row) => (
            <div key={row.label} style={{ display: 'contents' }}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {extra && <div className="wc-confirm__extra">{extra}</div>}

      <div className="wc-confirm__actions">
        <button type="submit" className="wc-btn wc-btn--primary" disabled={busy}>
          {busy ? busyLabel : confirmLabel}
        </button>
        <button
          type="button"
          className="wc-btn wc-btn--ghost"
          onClick={onDismiss}
          disabled={busy}
        >
          {dismissLabel}
        </button>
      </div>
    </form>
  );
}

/** `productName` / `product_name` → `Product name`. */
export function humanise(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
