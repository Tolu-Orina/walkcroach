import type { ConnectorProvider } from '../../../lib/api';
import { EmptyState } from './EmptyState';

/**
 * Connected accounts (Chrome plan E2).
 *
 * Status and disconnect only. Connecting happens on WalkCroach Web — the plan's
 * §9.2 decision — so this panel deep-links there rather than running a second
 * OAuth client inside the extension. The upside for the user is that a Gmail
 * account connected in Web Chat is immediately usable here, and disconnecting
 * here takes effect everywhere.
 *
 * Scopes are shown, not summarised. "Create drafts and send email as you" is the
 * disclosure, and the raw scope list is available underneath, because a user
 * deciding whether to trust this deserves the specifics.
 */
export function ConnectorsPanel({
  providers,
  requiresSignIn,
  connectUrl,
  busyProvider,
  onDisconnect,
  onOpenConnect,
}: {
  providers: ConnectorProvider[];
  requiresSignIn: boolean;
  connectUrl: string;
  busyProvider: string | null;
  onDisconnect: (provider: string) => void;
  onOpenConnect: () => void;
}) {
  return (
    <section className="wc-section" aria-labelledby="wc-connectors-title">
      <h3 className="wc-section__title" id="wc-connectors-title">
        Connected accounts
      </h3>

      {requiresSignIn ? (
        <EmptyState title="Sign in to connect accounts">
          Connections belong to your WalkCroach account, not to this browser, so
          they work in Web Chat and the IDE too.
        </EmptyState>
      ) : providers.length === 0 ? (
        <EmptyState title="No connectors available yet">
          Calendar, Gmail, Slack and Stripe arrive as each one is switched on for
          your workspace.
        </EmptyState>
      ) : (
        <>
          <ul className="wc-list">
            {providers.map((p) => {
              const c = p.connection;
              const live = c?.status === 'connected';
              return (
                <li key={p.id}>
                  <div className="wc-list__body">
                    <span className="wc-list__title">{p.label}</span>
                    <span className="wc-muted wc-small">{p.disclosure}</span>
                    {live && c?.accountLabel && (
                      <span className="wc-list__sub">{c.accountLabel}</span>
                    )}
                    {c?.status === 'error' && c.lastError && (
                      <span className="wc-connector__error">
                        {c.lastError} — reconnect in WalkCroach Web.
                      </span>
                    )}
                    {live && (
                      <details className="wc-small">
                        <summary className="wc-muted">
                          What WalkCroach can do
                        </summary>
                        <ul className="wc-scopes">
                          {p.scopes.map((s) => (
                            <li key={s} className="wc-mono">
                              {s}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  {live ? (
                    <button
                      type="button"
                      className="wc-btn wc-btn--danger"
                      disabled={busyProvider === p.id}
                      aria-busy={busyProvider === p.id}
                      /*
                        The label tracks the state. A static "Disconnect Gmail"
                        overrides the visible "Removing…" for a screen reader,
                        so the one user who cannot see the button changing is
                        also the one told nothing is happening.
                      */
                      aria-label={
                        busyProvider === p.id
                          ? `Removing ${p.label}…`
                          : `Disconnect ${p.label}`
                      }
                      onClick={() => onDisconnect(p.id)}
                    >
                      {busyProvider === p.id ? 'Removing…' : 'Disconnect'}
                    </button>
                  ) : (
                    <span className="wc-muted wc-small">Not connected</span>
                  )}
                </li>
              );
            })}
          </ul>

          {connectUrl && (
            <div>
              <button
                type="button"
                className="wc-btn"
                onClick={onOpenConnect}
              >
                Connect an account in WalkCroach Web
              </button>
              <p className="wc-muted wc-small">
                Accounts are connected once and shared across every WalkCroach
                surface. WalkCroach never sees or stores your password, and
                access tokens never reach this extension.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
