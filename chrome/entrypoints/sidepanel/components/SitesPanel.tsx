import { originLabel } from '../../../lib/permissions';
import { EmptyState } from './EmptyState';

/**
 * The honest Trust surface (Phase B3, dressed for Phase C).
 *
 * Every row here is a real `chrome.permissions` grant and Revoke really calls
 * `permissions.remove` — this replaced FR-C15 copy that described controls the
 * activeTab-only build did not have. The empty state teaches the model rather
 * than apologising for being empty.
 */
export function SitesPanel({
  origins,
  onRevoke,
}: {
  origins: string[];
  onRevoke: (origin: string) => void;
}) {
  return (
    <section className="wc-section" aria-labelledby="wc-sites-title">
      <h3 className="wc-section__title" id="wc-sites-title">
        Sites you allow
      </h3>

      {origins.length === 0 ? (
        <EmptyState title="No sites allowed yet">
          Click an action on the <strong>Page</strong> tab and WalkCroach will ask
          for that one site. Sites you allow show up here, and you can withdraw
          any of them.
        </EmptyState>
      ) : (
        <>
          <ul className="wc-list">
            {origins.map((origin) => (
              <li key={origin}>
                <div className="wc-list__body">
                  <span className="wc-list__title">{originLabel(origin)}</span>
                  <span className="wc-list__sub">{origin}</span>
                </div>
                <button
                  type="button"
                  className="wc-btn wc-btn--danger"
                  onClick={() => onRevoke(origin)}
                  aria-label={`Revoke access to ${originLabel(origin)}`}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
          <p className="wc-muted wc-small">
            Revoking takes effect immediately and clears any page text WalkCroach
            had cached for that site.
          </p>
        </>
      )}
    </section>
  );
}
