import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getSdkApiBaseUrl,
  getSdkHealth,
  getUsage,
  listApiKeyUsage,
  type UsageSummary,
} from '../../api/client';

/**
 * Minimal ops view inside the developer portal (P5.3).
 * Full multi-tenant admin can wait; operators need: am I over quota, is memory up,
 * where are the CloudWatch alarms.
 */
export function DeveloperOpsPage() {
  const base = getSdkApiBaseUrl();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [healthDetail, setHealthDetail] = useState<string>('');
  const [keyUsage, setKeyUsage] = useState<{
    remember: number;
    recall: number;
    import: number;
    publish: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getUsage()
      .then((u) => {
        if (!cancelled) {
          setUsage(u);
          setUsageError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsage(null);
          setUsageError(err instanceof Error ? err.message : String(err));
        }
      });
    void getSdkHealth()
      .then((h) => {
        if (!cancelled) {
          setHealthOk(h.ok);
          setHealthDetail(
            `${h.version ?? 'n/a'} · ${(h.capabilities ?? []).join(', ') || 'no caps'}`,
          );
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setHealthOk(false);
          setHealthDetail(err instanceof Error ? err.message : String(err));
        }
      });
    void listApiKeyUsage()
      .then((payload) => {
        if (cancelled) return;
        const sum = { remember: 0, recall: 0, import: 0, publish: 0 };
        for (const r of payload.keys) {
          sum.remember += r.remember ?? 0;
          sum.recall += r.recall ?? 0;
          sum.import += r.import ?? 0;
          sum.publish += r.contentPublish ?? 0;
        }
        setKeyUsage(sum);
      })
      .catch(() => {
        if (!cancelled) setKeyUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const used = usage?.used ?? 0;
  const monthly = usage?.monthlyCredits ?? 0;
  const remaining = usage?.remaining ?? 0;
  /** Rough embed/memory cost signal: credits spent this month (ledger units). */
  const memoryCredits =
    (keyUsage?.remember ?? 0) +
    (keyUsage?.recall ?? 0) +
    (keyUsage?.import ?? 0) * 2;

  return (
    <div className="space-y-4">
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
        </dl>
        <p className="text-[12px] leading-relaxed text-mist">
          CloudWatch alarms (prod):{' '}
          <code className="font-mono text-paper">
            WalkCroach/Memory
          </code>{' '}
          — recall p95 latency, embed failures. SNS shares the creative budget
          topic. See{' '}
          <code className="font-mono text-paper">
            infra-backend/modules/observability-memory
          </code>
          .
        </p>
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Usage this month
        </h2>
        {usageError ? (
          <p className="text-sm text-ember">{usageError}</p>
        ) : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-mist">Plan pool</dt>
              <dd className="font-medium text-paper">
                {used} / {monthly} credits ({remaining} left)
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-mist">SDK remember / recall / import</dt>
              <dd className="font-mono text-[12px] text-paper">
                {keyUsage
                  ? `${keyUsage.remember} / ${keyUsage.recall} / ${keyUsage.import}`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-mist">Memory credit burn (est.)</dt>
              <dd className="font-medium text-paper">{memoryCredits}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-mist">Content publish</dt>
              <dd className="font-mono text-[12px] text-paper">
                {keyUsage?.publish ?? '—'}
              </dd>
            </div>
          </dl>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="/app/developer/keys" className="btn-secondary text-xs">
            Per-key breakdown
          </Link>
          <Link to="/app/settings" className="btn-ghost text-xs">
            Billing portal
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
        </p>
      </section>
    </div>
  );
}
