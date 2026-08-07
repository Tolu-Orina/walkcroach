import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSdkApiBaseUrl, getSdkHealth, getUsage } from '../../api/client';
import { useAuth } from '../../auth/useAuth';

export function DeveloperOverviewPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<{
    ok: boolean;
    version: string;
    capabilities: string[];
    retention?: { asOfHuman: string };
  } | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const base = getSdkApiBaseUrl();

  useEffect(() => {
    let cancelled = false;
    void getSdkHealth()
      .then((h) => {
        if (!cancelled) {
          setHealth(h);
          setHealthError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setHealth(null);
          setHealthError(err instanceof Error ? err.message : String(err));
        }
      });
    void getUsage()
      .then((u) => {
        if (!cancelled) setPlan(u.plan === 'paid' ? 'Paid' : 'Free');
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <section className="surface space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Your workspace
        </h2>
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-mist">Signed in as</dt>
            <dd className="truncate font-medium text-paper">
              {user?.email ?? '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mist">Plan</dt>
            <dd className="font-medium text-paper">{plan ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mist">SDK API base</dt>
            <dd className="truncate font-mono text-[12px] text-paper">{base}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="/app/developer/keys" className="btn-primary text-xs">
            Create API key
          </Link>
          <Link to="/app/developer/docs" className="btn-secondary text-xs">
            Quickstart
          </Link>
          <Link to="/app/settings" className="btn-ghost text-xs">
            Billing
          </Link>
        </div>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          API health
        </h2>
        {healthError && (
          <div className="space-y-2">
            <p className="text-sm text-ember">
              Could not reach the SDK API. Locally run{' '}
              <code className="font-mono text-paper">npm run dev:ide</code> in
              infra-backend (port 3003) and set{' '}
              <code className="font-mono text-paper">VITE_IDE_API_URL</code>.
            </p>
            <p className="truncate font-mono text-[11px] text-mist/80">
              {healthError.slice(0, 180)}
            </p>
          </div>
        )}
        {!healthError && !health && (
          <p className="text-sm text-mist">Checking…</p>
        )}
        {health && (
          <>
            <p className="text-sm text-paper">
              <span className="text-teal">●</span> {health.ok ? 'Reachable' : 'Degraded'}{' '}
              · protocol {health.version}
            </p>
            {health.retention?.asOfHuman && (
              <p className="text-[12px] leading-relaxed text-mist">
                asOf / diff retention:{' '}
                <span className="font-mono text-paper">
                  {health.retention.asOfHuman}
                </span>{' '}
                (MVCC GC window)
              </p>
            )}
            <ul className="flex flex-wrap gap-1.5">
              {health.capabilities.map((c) => (
                <li
                  key={c}
                  className="rounded-[var(--radius-control)] border border-line bg-ink/40 px-2 py-1 font-mono text-[11px] text-mist"
                >
                  {c}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          What you can build
        </h2>
        <ul className="space-y-2.5 text-sm leading-relaxed text-mist">
          <li>
            <span className="font-medium text-paper">Memory client</span> — remember,
            recall, time-travel, export/import with{' '}
            <code className="font-mono text-[12px] text-paper">@walkcroach/sdk</code>
          </li>
          <li>
            <span className="font-medium text-paper">MCP server</span> — expose the same
            layer to Claude Code, Cursor, and other MCP hosts via{' '}
            <code className="font-mono text-[12px] text-paper">@walkcroach/sdk-mcp</code>
          </li>
          <li>
            <span className="font-medium text-paper">Server-side only keys</span> — never
            embed <code className="font-mono text-[12px] text-paper">wc_live_…</code> in
            a browser; use Cognito access tokens for user-context calls
          </li>
        </ul>
      </section>
    </div>
  );
}
