import { describePageAccess, type PageAccess } from '../../../lib/page-access';

/**
 * The Phase A3 page-access gate, given a visual form.
 *
 * The state machine already guarantees every non-ready state names the one
 * action that resolves it, so this component never invents copy — it renders
 * whatever `describePageAccess` returns and wires the single button. Terminal
 * states drop the amber urgency because there is nothing the user can do here.
 */
export function AccessNotice({
  access,
  onGrant,
  onRecheck,
}: {
  access: PageAccess | null;
  onGrant: () => void;
  onRecheck: () => void;
}) {
  if (!access) return null;
  const notice = describePageAccess(access);
  if (!notice.message) return null;

  return (
    <div
      className={
        notice.terminal ? 'wc-notice wc-notice--terminal' : 'wc-notice'
      }
      // Announce because this can change under the user (tab switch, revoke)
      // without them having touched the panel.
      role="status"
      aria-live="polite"
    >
      <p>{notice.message}</p>
      {notice.action === 'grant' && (
        <button type="button" className="wc-btn wc-btn--primary" onClick={onGrant}>
          {notice.actionLabel}
        </button>
      )}
      {notice.action === 'retry' && (
        <div>
          <button type="button" className="wc-btn" onClick={onRecheck}>
            {notice.actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
