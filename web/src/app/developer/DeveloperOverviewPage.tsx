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
import { CodeBlock } from './CodeBlock';
import { CreditPoolBar } from './CreditPoolBar';
import { planDisplayName } from './usage-format';

/**
 * Developer portal Overview (dual-funnel P2).
 * Job: stranger with Cognito can leave this page with a working mental model
 * and a copy-paste quickstart — without Discord.
 */
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

  const quickstart = `import { WalkCroach, formatHitsForPrompt } from '@walkcroach/sdk';

const wc = new WalkCroach({
  apiKey: process.env.WALKCROACH_API_KEY, // wc_live_… — server-side only
  baseUrl: '${base}',
});

const { id: projectId } = await wc.projects.ensure();

await wc.memory.remember({
  projectId,
  kind: 'decision',
  text: 'Chose Drizzle over Prisma for edge runtimes',
  surface: 'my-agent',
});

const hits = await wc.memory.recall({
  projectId,
  query: 'which ORM did we pick?',
});

const memoryBlock = formatHitsForPrompt(hits, { budget: { maxHits: 5 } });
console.log(memoryBlock);`;

  return (
    <div className="space-y-4">
      <section className="surface space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Start here (under 15 minutes)
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          This portal is the <strong className="font-medium text-paper">memory platform</strong>{' '}
          product. Coding agents (IDE / CLI / Desktop) are a separate funnel.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-mist">
          <li>
            <Link to="/app/developer/keys" className="text-signal hover:underline">
              Create an API key
            </Link>{' '}
            with <code className="font-mono text-[12px] text-paper">memory:read</code> +{' '}
            <code className="font-mono text-[12px] text-paper">memory:write</code>. Copy the{' '}
            <code className="font-mono text-[12px] text-paper">wc_live_…</code> value once.
          </li>
          <li>
            In a <strong className="font-medium text-paper">server</strong> shell:{' '}
            <code className="font-mono text-[12px] text-paper">
              export WALKCROACH_API_KEY=wc_live_…
            </code>{' '}
            then <code className="font-mono text-[12px] text-paper">npm i @walkcroach/sdk</code>.
          </li>
          <li>Paste the TypeScript snippet below and run it (Node 20+).</li>
          <li>
            Confirm{' '}
            <code className="font-mono text-[12px] text-paper">{base}/v1/sdk-health</code>{' '}
            returns <code className="font-mono text-[12px] text-paper">ok</code>.
          </li>
        </ol>
        <CodeBlock>{quickstart}</CodeBlock>
        <p className="text-[11px] text-mist">
          Python client stub is not published yet — use HTTP against the{' '}
          <Link to="/app/developer/docs" className="text-signal hover:underline">
            OpenAPI
          </Link>{' '}
          until then.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/developer/keys" className="btn-primary text-xs">
            {noKeys ? 'Create API key' : 'Manage keys'}
          </Link>
          <Link to="/app/developer/docs" className="btn-secondary text-xs">
            Full docs
          </Link>
          <Link to="/app/developer/ops" className="btn-ghost text-xs">
            Quotas & usage
          </Link>
        </div>
      </section>

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
            Shared credit pool
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
      </section>

      <section className="surface space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Pricing honesty
        </h2>
        <p className="text-sm leading-relaxed text-mist">
          There is <strong className="font-medium text-paper">one monthly credit pool</strong> for
          your account (SKU A). Web/Browser Extension creatives and public SDK memory/content calls
          debit the <em>same</em> ledger — there is not a separate “developer plan” product.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-[12px] leading-relaxed text-mist">
          <li>
            <span className="font-medium text-paper">End-user surfaces</span> — App Builder,
            creatives, Chrome actions (when metered).
          </li>
          <li>
            <span className="font-medium text-paper">Developer API</span> —{' '}
            <code className="font-mono text-paper">memory_*</code>,{' '}
            <code className="font-mono text-paper">content_publish</code>,{' '}
            <code className="font-mono text-paper">graph_run</code> via{' '}
            <code className="font-mono text-paper">wc_live_</code> keys.
          </li>
          <li>
            <span className="font-medium text-paper">Not platform-metered</span> — BYOK Bedrock
            tokens on IDE / CLI / Desktop coding agents.
          </li>
        </ul>
        <p className="text-[12px] text-mist">
          Exhaustion returns HTTP <code className="font-mono text-paper">429</code> with{' '}
          <code className="font-mono text-paper">Retry-After</code> — see{' '}
          <Link to="/app/developer/ops" className="text-signal hover:underline">
            Ops → Invoice & quotas
          </Link>
          .
        </p>
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
              <span className={health.ok ? 'text-teal' : 'text-ember'}>●</span>{' '}
              {health.ok ? 'Reachable' : 'Degraded'} · protocol {health.version}
            </p>
            {health.retention?.asOfHuman && (
              <p className="text-[12px] leading-relaxed text-mist">
                asOf / diff retention:{' '}
                <span className="font-mono text-paper">
                  {health.retention.asOfHuman}
                </span>{' '}
                (MVCC GC window — not multi-year)
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
          FAQ shortcuts
        </h2>
        <ul className="space-y-2 text-sm text-mist">
          <li>
            Lost the plaintext key?{' '}
            <Link to="/app/developer/keys" className="text-signal hover:underline">
              Revoke and mint a new one
            </Link>{' '}
            — secrets are shown once.
          </li>
          <li>
            Hit 429 / QuotaError?{' '}
            <Link to="/app/developer/ops" className="text-signal hover:underline">
              Ops quotas
            </Link>{' '}
            and{' '}
            <Link to="/app/settings" className="text-signal hover:underline">
              Billing
            </Link>
            .
          </li>
          <li>
            Wire Claude / Cursor / Codex?{' '}
            <Link to="/app/developer/docs" className="text-signal hover:underline">
              Docs → MCP
            </Link>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}
