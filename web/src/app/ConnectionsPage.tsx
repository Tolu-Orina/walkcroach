import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  disconnectConnector,
  listConnectors,
  startConnectorOauth,
  type ConnectorProviderView,
} from '../api/client';

/**
 * Settings → Connections (Phase F2).
 * OAuth completes on this origin; Chrome deep-links here.
 */
export function ConnectionsPage() {
  const [providers, setProviders] = useState<ConnectorProviderView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const flash = searchParams.get('connected');

  const refresh = useCallback(async () => {
    try {
      const res = await listConnectors();
      setProviders(res.providers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onConnect = async (providerId: string) => {
    setBusy(providerId);
    try {
      const { authorizeUrl } = await startConnectorOauth(providerId);
      window.location.assign(authorizeUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const onDisconnect = async (providerId: string) => {
    setBusy(providerId);
    try {
      await disconnectConnector(providerId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:px-6">
      <p className="eyebrow">
        <Link to="/app/settings" className="text-mist hover:text-signal">
          Settings
        </Link>
        <span className="mx-2 text-mist/50">/</span>
        Connections
      </p>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-paper">
        Connections
      </h1>
      <p className="mt-2 text-sm text-mist">
        Connect Gmail, Calendar, Sheets, Slack, Stripe, or HubSpot. Tokens stay
        in Secrets Manager — never in the browser.
      </p>

      {flash && (
        <p className="mt-4 rounded-[var(--radius-control)] border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
          Connected {flash}.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-[var(--radius-control)] border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-ember">
          {error}
        </p>
      )}

      <ul className="mt-8 space-y-3">
        {providers.length === 0 && (
          <li className="surface p-5 text-sm text-mist">
            No OAuth apps configured yet. Add provider credentials to the
            runtime secret, then refresh.
          </li>
        )}
        {providers.map((p) => {
          const connected = p.connection?.status === 'connected';
          return (
            <li key={p.id} className="surface flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-paper">{p.label}</h2>
                  <span className="font-mono text-[10px] uppercase text-mist">
                    tier {p.tier}
                  </span>
                  {connected && (
                    <span className="rounded-[0.3rem] border border-signal/40 px-1.5 py-0.5 font-mono text-[10px] text-signal">
                      connected
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-mist">{p.disclosure}</p>
                {p.connection?.accountLabel && (
                  <p className="mt-1 font-mono text-[11px] text-mist/80">
                    {p.connection.accountLabel}
                  </p>
                )}
                {p.connection?.lastError && (
                  <p className="mt-1 text-xs text-ember">
                    {p.connection.lastError}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {connected ? (
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => void onDisconnect(p.id)}
                    className="btn-ghost text-xs disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy === p.id}
                    onClick={() => void onConnect(p.id)}
                    className="interactive rounded-[var(--radius-control)] border border-signal/40 bg-signal/15 px-3 py-1.5 text-xs font-semibold text-signal disabled:opacity-50"
                  >
                    {busy === p.id ? 'Opening…' : 'Connect'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
