import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getSdkApiBaseUrl,
  getSdkHealth,
  getUsage,
  listApiKeys,
  listApiKeyUsage,
  type ApiKeySummary,
  type ApiKeyUsageRow,
  type UsageSummary,
} from '../../api/client';
import { CreditPoolBar } from './CreditPoolBar';
import { costRows, planDisplayName } from './usage-format';

/**
 * Actionable ops view (Phase D / P5.3 depth).
 * Live: credit pool, ledger costs, per-key SDK usage, sdk-health.
 * CloudWatch remains a documented pointer — no metrics proxy yet.
 */
export function DeveloperOpsPage() {
  const base = getSdkApiBaseUrl();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [healthDetail, setHealthDetail] = useState<string>('');
  const [retention, setRetention] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [keyUsage, setKeyUsage] = useState<ApiKeyUsageRow[] | null>(null);
  const [keyUsageError, setKeyUsageError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      getUsage(),
      getSdkHealth(),
      listApiKeyUsage(),
      listApiKeys(),
    ]);

    const [usageRes, healthRes, keyUsageRes, keysRes] = results;

    if (usageRes.status === 'fulfilled') {
      setUsage(usageRes.value);
      setUsageError(null);
    } else {
      setUsage(null);
      setUsageError(
        usageRes.reason instanceof Error
          ? usageRes.reason.message
          : String(usageRes.reason),
      );
    }

    if (healthRes.status === 'fulfilled') {
      const h = healthRes.value;
      setHealthOk(h.ok);
      setHealthDetail(
        `${h.version ?? 'n/a'} · ${(h.capabilities ?? []).slice(0, 4).join(', ') || 'no caps'}`,
      );
      setRetention(h.retention?.asOfHuman ?? null);
    } else {
      setHealthOk(false);
      setHealthDetail(
        healthRes.reason instanceof Error
          ? healthRes.reason.message
          : String(healthRes.reason),
      );
      setRetention(null);
    }

    if (keyUsageRes.status === 'fulfilled') {
      setKeyUsage(keyUsageRes.value.keys);
      setPeriod(keyUsageRes.value.period);
      setKeyUsageError(null);
    } else {
      setKeyUsage(null);
      setPeriod(null);
      setKeyUsageError(
        keyUsageRes.reason instanceof Error
          ? keyUsageRes.reason.message
          : String(keyUsageRes.reason),
      );
    }

    if (keysRes.status === 'fulfilled') {
      setKeys(keysRes.value.filter((k) => !k.revokedAt));
    } else {
      setKeys([]);
    }

    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const aggregates = (() => {
    const sum = { remember: 0, recall: 0, import: 0, publish: 0, credits: 0 };
    if (!keyUsage) return sum;
    for (const r of keyUsage) {
      sum.remember += r.remember ?? 0;
      sum.recall += r.recall ?? 0;
      sum.import += r.import ?? 0;
      sum.publish += r.contentPublish ?? 0;
      sum.credits += r.credits ?? 0;
    }
    return sum;
  })();

  const keyName = (id: string) =>
    keys.find((k) => k.id === id)?.name ??
    keys.find((k) => k.id === id)?.prefix ??
    id.slice(0, 8);

  const costs = costRows(usage?.costs);
  const lowCredits =
    usage != null &&
    usage.monthlyCredits > 0 &&
    usage.remaining / usage.monthlyCredits < 0.15;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-mist">
          Live usage against the shared credit ledger and SDK key aggregates.
        </p>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={refreshing}
          onClick={() => void load()}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Memory health
        </h2>
        <p className="text-sm text-mist">
          API:{' '}
          <code className="font-mono text-[12px] text-paper">{base}</code>
        </p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-mist">sdk-health</dt>
            <dd
              className={
                healthOk === null
                  ? 'text-mist'
                  : healthOk
                    ? 'text-signal'
                    : 'text-ember'
              }
            >
              {healthOk === null ? '…' : healthOk ? 'ok' : 'down'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mist">Detail</dt>
            <dd className="truncate font-mono text-[11px] text-paper">
              {healthDetail || '—'}
            </dd>
          </div>
          {retention && (
            <div className="flex justify-between gap-4">
              <dt className="text-mist">asOf retention</dt>
              <dd className="font-mono text-[11px] text-paper">{retention}</dd>
            </div>
          )}
        </dl>
        {healthOk === false && (
          <p className="text-[12px] text-ember">
            SDK unreachable — memory and key minting will fail until{' '}
            <code className="font-mono text-paper">ide-api</code> is up.
          </p>
        )}
        <p className="text-[12px] leading-relaxed text-mist">
          CloudWatch (prod, not polled here): namespace{' '}
          <code className="font-mono text-paper">WalkCroach/Memory</code> — recall
          p95, embed failures. Alarms share the creative SNS topic. Module:{' '}
          <code className="font-mono text-paper">
            infra-backend/modules/observability-memory
          </code>
          .
        </p>
      </section>

      <section className="surface space-y-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
            Credit pool
          </h2>
          {usage && (
            <span className="font-mono text-[11px] text-mist">
              {planDisplayName(usage.plan)}
            </span>
          )}
        </div>
        {usageError ? (
          <p className="text-sm text-ember">{usageError}</p>
        ) : !usage ? (
          <p className="text-sm text-mist">Loading usage…</p>
        ) : (
          <>
            <CreditPoolBar usage={usage} />
            {lowCredits && (
              <p className="text-[12px] text-ember">
                Under 15% remaining.{' '}
                <Link to="/app/settings" className="text-signal hover:underline">
                  Open billing
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Ledger cost map
        </h2>
        <p className="text-[12px] text-mist">
          Credits charged per action type (platform rates). Actual spend is the
          pool above.
        </p>
        {costs.length === 0 ? (
          <p className="text-sm text-mist">No cost map yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
            {costs.map((row) => (
              <li
                key={row.key}
                className="rounded-[var(--radius-control)] border border-line bg-ink/40 px-2.5 py-1.5"
              >
                <span className="block font-mono text-[10px] uppercase tracking-wider text-mist/80">
                  {row.label}
                </span>
                <span className="font-medium text-paper">{row.credits} cr</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          SDK key activity
          {period ? (
            <span className="ml-2 font-mono text-[10px] font-normal tracking-normal text-mist/70">
              {period}
            </span>
          ) : null}
        </h2>
        {keyUsageError && (
          <p className="text-sm text-ember" role="alert">
            Could not load key usage: {keyUsageError}
          </p>
        )}
        {!keyUsageError && keyUsage === null && (
          <p className="text-sm text-mist">Loading key usage…</p>
        )}
        {keyUsage && (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-mist">Remember / recall / import</dt>
                <dd className="font-mono text-[12px] text-paper">
                  {aggregates.remember} / {aggregates.recall} /{' '}
                  {aggregates.import}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-mist">Content publish</dt>
                <dd className="font-mono text-[12px] text-paper">
                  {aggregates.publish}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-mist">Credits attributed to keys</dt>
                <dd className="font-medium text-paper">{aggregates.credits}</dd>
              </div>
            </dl>

            {keyUsage.length === 0 ? (
              <p className="text-[12px] text-mist">
                No key-attributed ledger rows this month.{' '}
                <Link
                  to="/app/developer/keys"
                  className="text-signal hover:underline"
                >
                  Mint a key
                </Link>{' '}
                and call the SDK.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-mist">
                      <th className="py-1.5 pr-3 font-medium">Key</th>
                      <th className="py-1.5 pr-3 font-medium">Remember</th>
                      <th className="py-1.5 pr-3 font-medium">Recall</th>
                      <th className="py-1.5 pr-3 font-medium">Import</th>
                      <th className="py-1.5 pr-3 font-medium">Publish</th>
                      <th className="py-1.5 font-medium">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyUsage.map((row) => (
                      <tr key={row.keyId} className="border-b border-line/60">
                        <td className="py-1.5 pr-3 font-medium text-paper">
                          {keyName(row.keyId)}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-mist">
                          {row.remember}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-mist">
                          {row.recall}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-mist">
                          {row.import}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-mist">
                          {row.contentPublish}
                        </td>
                        <td className="py-1.5 font-mono text-paper">
                          {row.credits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="/app/developer/keys" className="btn-secondary text-xs">
            Manage keys
          </Link>
          <Link to="/app/settings" className="btn-ghost text-xs">
            Billing portal
          </Link>
          <Link to="/app/developer/governance" className="btn-ghost text-xs">
            Governance policy
          </Link>
        </div>
      </section>

      <section className="surface space-y-2 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Error budget (ops)
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          Recall p95 SLO is alarmed at the Terraform threshold (default 3s).
          Embed failure rate alarms page via the shared SNS topic. Treat
          sustained sdk-health failures or quota 429 spikes as burn against the
          platform error budget — investigate before shipping memory changes.
          This page does not poll CloudWatch; use the console for live alarm
          state.
        </p>
      </section>
    </div>
  );
}
