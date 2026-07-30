import type { SiteProfile } from '../../../lib/site-profiles/matcher';

/**
 * Page verbs: one-shot actions *about the page you are looking at*, kept beside
 * the page context they operate on (plan §3.2: "one job in the first screen").
 *
 * Deliberately not the Ask field. Asking is conversational and repeated, so it is
 * docked at the bottom of the shell — see Composer.
 *
 * When a sector profile matches, its action takes the amber CTA — that is the
 * Chrome wedge, and it should outrank generic Summarize. With no profile,
 * Summarize is promoted so the panel is never a wall of equal-weight buttons.
 */
export function PrimaryActions({
  profile,
  disabled,
  streaming,
  primaryDemoted,
  activeWorkspaceName,
  onSectorAction,
  onSummarize,
  onDraft,
  onSave,
  onOpenInWebChat,
}: {
  profile: SiteProfile | null;
  disabled: boolean;
  streaming: boolean;
  /**
   * Step aside: something else on screen owns the decision right now (a site
   * grant, or a pending write). Amber marks exactly one action per screen, so
   * when a notice or confirm card holds it, this row goes quiet.
   */
  primaryDemoted: boolean;
  activeWorkspaceName: string;
  onSectorAction: () => void;
  onSummarize: () => void;
  onDraft: () => void;
  onSave: () => void;
  onOpenInWebChat: () => void;
}) {
  const busy = disabled || streaming;
  const primaryClass = primaryDemoted ? 'wc-btn' : 'wc-btn wc-btn--primary';

  return (
    <div className="wc-section">
      <div className="wc-actions">
        {profile ? (
          <>
            <button
              type="button"
              className={primaryClass}
              disabled={busy}
              onClick={onSectorAction}
            >
              {profile.label}
            </button>
            <div className="wc-actions__secondary">
              <button type="button" className="wc-btn" disabled={busy} onClick={onSummarize}>
                Summarize
              </button>
              <button type="button" className="wc-btn" disabled={busy} onClick={onDraft}>
                Draft
              </button>
              <button type="button" className="wc-btn" disabled={busy} onClick={onSave}>
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className={primaryClass}
              disabled={busy}
              onClick={onSummarize}
            >
              Summarize this page
            </button>
            <div className="wc-actions__secondary">
              <button type="button" className="wc-btn" disabled={busy} onClick={onDraft}>
                Draft
              </button>
              <button type="button" className="wc-btn" disabled={busy} onClick={onSave}>
                Save{activeWorkspaceName ? ` → ${activeWorkspaceName}` : ''}
              </button>
            </div>
          </>
        )}
      </div>

      <div>
        <button
          type="button"
          className="wc-btn wc-btn--ghost"
          disabled={busy}
          onClick={onOpenInWebChat}
        >
          Open in Web Chat
        </button>
      </div>
    </div>
  );
}
