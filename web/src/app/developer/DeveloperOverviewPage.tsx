import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getBillingStatus,
  getSdkApiBaseUrl,
  getSdkHealth,
  getUsage,
  listApiKeys,
  type UsageSummary,
} from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { CreditPoolBar } from './CreditPoolBar';
import { planDisplayName } from './usage-format';

export function DeveloperOverviewPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<{
    ok: boolean;
    version: string;
    capabilities: string[];
    retention?: { asOfHuman: string };
  } | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [activeKeys, setActiveKeys] = useState<number | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
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
        if (!cancelled) {
          setUsage(u);
          setUsageError(null);
          setPlanName((prev) => prev ?? planDisplayName(u.plan));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsage(null);
          setUsageError(err instanceof Error ? err.message : String(err));
        }
      });
    void getBillingStatus()
      .then((b) => {
        if (!cancelled) setPlanName(b.planName);
      })
      .catch(() => {
        /* usage plan label is enough */
      });
    void listApiKeys()
      .then((keys) => {
        if (!cancelled) {
          setActiveKeys(keys.filter((k) => !k.revokedAt).length);
          setKeysError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setActiveKeys(null);
          setKeysError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const lowCredits =
    usage != null &&
    usage.monthlyCredits > 0 &&
    usage.remaining / usage.monthlyCredits < 0.15;
  const noKeys = activeKeys === 0;

  return (
    <div className="space-y-4">
      <section className="surface space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
            Your workspace
          </h2>
          {health && !healthError && (
            <span
              className={`rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-[11px] ${
                health.ok
                  ? 'border-signal/35 bg-signal/10 text-signal'
                  : 'border-ember/40 bg-ember/10 text-ember'
              }`}
            >
              {health.ok ? 'SDK healthy' : 'SDK degraded'}
            </span>
          )}
          {healthError && (
            <span className="rounded-[var(--radius-control)] border border-ember/40 bg-ember/10 px-2 py-0.5 font-mono text-[11px] text-ember">
              SDK unreachable
            </span>
          )}
        </div>
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-mist">Signed in as</dt>
            <dd className="truncate font-medium text-paper">
              {user?.email ?? '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mist">Plan</dt>
            <dd className="font-medium text-paper">
              {planName ?? '—'}
              {usage?.plan === 'free' && (
                <Link
                  to="/app/settings"
                  className="ml-2 text-[11px] text-signal hover:underline"
                >
                  Upgrade
                </Link>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mist">Active API keys</dt>
            <dd className="font-medium text-paper">
              {keysError ? (
                <span className="text-ember" title={keysError}>
                  —
                </span>
              ) : activeKeys === null ? (
                '…'
              ) : (
                <>
                  {activeKeys}
                  {noKeys && (
                    <Link
                      to="/app/developer/keys"
                      className="ml-2 text-[11px] text-signal hover:underline"
                    >
                      Create one
                    </Link>
                  )}
                </>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mist">SDK API base</dt>
            <dd className="truncate font-mono text-[12px] text-paper">{base}</dd>
          </div>
        </dl>

        <div className="border-t border-line pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-mist">
            Credit pool
          </p>
          {usageError && <p className="text-sm text-ember">{usageError}</p>}
          {!usageError && !usage && (
            <p className="text-sm text-mist">Loading usage…</p>
          )}
          {usage && <CreditPoolBar usage={usage} compact />}
          {lowCredits && (
            <p className="mt-2 text-[12px] text-ember">
              Running low —{' '}
              <Link to="/app/settings" className="text-signal hover:underline">
                manage billing
              </Link>{' '}
              or check{' '}
              <Link to="/app/developer/ops" className="text-signal hover:underline">
                Ops
              </Link>{' '}
              for burn.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="/app/developer/keys" className="btn-primary text-xs">
            {noKeys ? 'Create API key' : 'Manage keys'}
          </Link>
          <Link to="/app/developer/ops" className="btn-secondary text-xs">
            Live usage
          </Link>
          <Link to="/app/developer/docs" className="btn-ghost text-xs">
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
            <Link to="/app/developer/ops" className="btn-secondary text-xs">
              Open Ops
            </Link>
          </div>
        )}
        {!healthError && !health && (
          <p className="text-sm text-mist">Checking…</p>
        )}
        {health && (
          <>
            <p className="text-sm text-paper">
              <span className={health.ok ? 'text-teal' : 'text-ember'}>●</span>{' '}
              {health.ok ? 'Reachable' : 'Degraded'} · protocol {health.version}
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
