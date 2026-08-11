import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  confirmAccountErase,
  confirmBillingCheckout,
  getBillingStatus,
  getGithubStatus,
  getUsage,
  listProjects,
  openBillingPortal,
  proposeAccountErase,
  startBillingCheckout,
  type AccountEraseProposeResult,
  type BillingStatus,
  type UsageSummary,
} from '../api/client';
import { useAuth } from '../auth/useAuth';
import { ThemeToggle } from '../components/ThemeToggle';

type GhRow = {
  projectId: string;
  projectName: string;
  connected: boolean;
  repo: string | null;
};

function planLabel(plan: string | undefined): string {
  if (plan === 'starter') return 'Starter';
  if (plan === 'pro' || plan === 'paid') return 'Pro';
  return 'Free';
}

async function refreshBillingState(): Promise<{
  usage: UsageSummary | null;
  billing: BillingStatus | null;
  usageError: string | null;
}> {
  const [usageResult, billingResult] = await Promise.allSettled([
    getUsage(),
    getBillingStatus(),
  ]);
  return {
    usage: usageResult.status === 'fulfilled' ? usageResult.value : null,
    billing: billingResult.status === 'fulfilled' ? billingResult.value : null,
    usageError:
      usageResult.status === 'rejected'
        ? usageResult.reason instanceof Error
          ? usageResult.reason.message
          : String(usageResult.reason)
        : null,
  };
}

/**
 * Profile / Settings — Phase F (PF-20 / PF-21 / PF-22).
 * Avatar in the ecosystem rail opens this page.
 */
export function SettingsPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingSyncing, setBillingSyncing] = useState(false);
  const [githubRows, setGithubRows] = useState<GhRow[]>([]);
  const [githubLoading, setGithubLoading] = useState(true);
  const [githubError, setGithubError] = useState<string | null>(null);
  const billingFlash = searchParams.get('billing');
  const checkoutSessionId = searchParams.get('session_id');

  const [eraseOpen, setEraseOpen] = useState(false);
  const [eraseProposal, setEraseProposal] =
    useState<AccountEraseProposeResult | null>(null);
  const [eraseEmail, setEraseEmail] = useState('');
  const [erasePhrase, setErasePhrase] = useState('');
  const [eraseBusy, setEraseBusy] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const apply = (next: Awaited<ReturnType<typeof refreshBillingState>>) => {
      if (cancelled) return;
      setUsage(next.usage);
      setBilling(next.billing);
      setUsageError(next.usageError);
    };

    void (async () => {
      // After Stripe Checkout, confirm the session so entitlements update
      // before the webhook arrives.
      if (billingFlash === 'success' && checkoutSessionId) {
        setBillingSyncing(true);
        try {
          await confirmBillingCheckout(checkoutSessionId);
        } catch {
          /* fall through to poll — webhook may still land */
        }
      }

      let next = await refreshBillingState();
      apply(next);

      if (billingFlash === 'success' || billingFlash === 'portal') {
        setBillingSyncing(true);
        for (let i = 0; i < 6; i++) {
          if (billingFlash === 'success') {
            const plan = next.billing?.plan ?? next.usage?.plan;
            if (plan && plan !== 'free') break;
          }
          await new Promise((r) => setTimeout(r, 800));
          if (cancelled) return;
          next = await refreshBillingState();
          apply(next);
          if (billingFlash === 'portal') break; // one extra refresh after portal is enough
        }
        if (!cancelled) {
          setBillingSyncing(false);
          // Drop session_id from the URL once synced (keep ?billing=success flash).
          if (billingFlash === 'success' && checkoutSessionId) {
            navigate('/app/settings?billing=success', { replace: true });
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [billingFlash, checkoutSessionId, navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGithubLoading(true);
      setGithubError(null);
      try {
        const projects = await listProjects({ kind: 'app' });
        const slice = projects.slice(0, 8);
        const rows = await Promise.all(
          slice.map(async (p) => {
            try {
              const st = await getGithubStatus(p.id);
              return {
                projectId: p.id,
                projectName: p.name,
                connected: st.connected,
                repo: st.repo,
              };
            } catch {
              return {
                projectId: p.id,
                projectName: p.name,
                connected: false,
                repo: null,
              };
            }
          }),
        );
        if (!cancelled) setGithubRows(rows);
      } catch (err) {
        if (!cancelled) {
          setGithubRows([]);
          setGithubError(
            err instanceof Error ? err.message : 'Could not load GitHub status',
          );
        }
      } finally {
        if (!cancelled) setGithubLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pct =
    usage && usage.monthlyCredits
      ? Math.min(
          100,
          Math.round((usage.remaining / usage.monthlyCredits) * 100),
        )
      : 0;

  const connectedCount = githubRows.filter((r) => r.connected).length;

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:px-6">
      <p className="eyebrow">Profile</p>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-paper">
        Settings
      </h1>
      <p className="mt-2 text-sm text-mist">
        Account, appearance, usage, and connections.
      </p>

      {/* Account — profile only; sign-out lives in Session below */}
      <section className="surface mt-8 space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Account
        </h2>
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-mist">Name</dt>
            <dd className="font-medium text-paper">
              {user?.displayName ?? '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mist">Email</dt>
            <dd className="font-medium text-paper">{user?.email ?? '—'}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link to="/forgot-password" className="btn-ghost text-xs">
            Reset password
          </Link>
        </div>
      </section>

      {/* Appearance */}
      <section className="surface mt-4 space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Appearance
        </h2>
        <ThemeToggle />
      </section>

      {/* Usage & billing */}
      <section className="surface mt-4 space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Usage & billing
        </h2>
        {billingFlash === 'success' && (
          <p className="rounded-[var(--radius-control)] border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
            {billingSyncing
              ? 'Subscription updated — syncing your plan…'
              : `You're on ${planLabel(billing?.plan ?? usage?.plan)}. Paid features are unlocked.`}
          </p>
        )}
        {billingFlash === 'portal' && (
          <p className="rounded-[var(--radius-control)] border border-signal/40 bg-signal/10 px-3 py-2 text-sm text-signal">
            Billing portal closed — refreshing your plan.
          </p>
        )}
        {billingFlash === 'cancel' && (
          <p className="rounded-[var(--radius-control)] border border-line px-3 py-2 text-sm text-mist">
            Checkout cancelled — you are still on Free.
          </p>
        )}
        {usageError && (
          <p className="text-sm text-ember">Could not load usage.</p>
        )}
        {usage && (
          <>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-display text-lg font-bold text-paper">
                  {usage.remaining}
                  <span className="text-sm font-medium text-mist">
                    {' '}
                    / {usage.monthlyCredits} credits left
                  </span>
                </p>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-mist">
                  {planLabel(billing?.plan ?? usage.plan)} plan
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-signal transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[12px] text-mist">
                Used this month: {usage.used}
                {usage.sharedPool
                  ? ' · shared with Chrome side panel'
                  : ''}
              </p>
            </div>
            {usage.costs && Object.keys(usage.costs).length > 0 && (
              <ul className="grid grid-cols-2 gap-2 text-[12px] text-mist sm:grid-cols-3">
                {Object.entries(usage.costs).map(([key, cost]) => (
                  <li
                    key={key}
                    className="rounded-[var(--radius-control)] border border-line bg-ink/40 px-2.5 py-1.5"
                  >
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-mist/80">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="font-medium text-paper">{cost} cr</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {!usage && !usageError && (
          <p className="text-sm text-mist">Loading usage…</p>
        )}
        {billingError && (
          <p className="text-sm text-ember">{billingError}</p>
        )}

        {billing && !billing.checkoutEnabled && (
          <p className="rounded-[var(--radius-control)] border border-ember/35 bg-ember/10 px-3 py-2 text-[12px] leading-relaxed text-ember">
            Checkout is not configured in this environment. Add Stripe{' '}
            <code className="font-mono text-paper">stripe_secret_key</code>,{' '}
            <code className="font-mono text-paper">stripe_price_id_starter</code>, and{' '}
            <code className="font-mono text-paper">stripe_price_id_pro</code> to
            the runtime secret, then restart the agent Lambda.
          </p>
        )}

        {billing?.catalog && (
          <div className="grid gap-3 sm:grid-cols-3">
            {billing.catalog.map((tier) => {
              const current = billing.plan === tier.id;
              const canBuy =
                tier.paid &&
                tier.checkoutAvailable &&
                billing.checkoutEnabled &&
                !current;
              const blockedReason = !tier.paid
                ? null
                : current
                  ? null
                  : !billing.checkoutEnabled
                    ? 'Billing unavailable'
                    : !tier.checkoutAvailable
                      ? 'Price not configured'
                      : null;
              return (
                <div
                  key={tier.id}
                  className={`flex h-full flex-col rounded-[var(--radius-control)] border p-3 ${
                    current
                      ? 'border-signal/40 bg-signal/5'
                      : 'border-line bg-ink/30'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-paper">{tier.name}</p>
                    <p className="text-[12px] text-mist">{tier.priceLabel}</p>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-mist">
                    {tier.blurb}
                  </p>
                  <ul className="mt-2 space-y-1 text-[11px] text-mist">
                    {tier.highlights.map((h) => (
                      <li key={h}>· {h}</li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-3">
                    {current ? (
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-signal">
                        Current
                      </p>
                    ) : canBuy ? (
                      <button
                        type="button"
                        disabled={billingBusy !== null}
                        className="interactive w-full rounded-[var(--radius-control)] bg-signal px-2.5 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                        onClick={() => {
                          setBillingBusy(tier.id);
                          setBillingError(null);
                          void startBillingCheckout(tier.id as 'starter' | 'pro')
                            .then((result) => {
                              if (result.url) {
                                window.location.assign(result.url);
                                return;
                              }
                              if (result.changed) {
                                window.location.assign(
                                  '/app/settings?billing=success',
                                );
                                return;
                              }
                              setBillingError('Checkout did not return a URL.');
                              setBillingBusy(null);
                            })
                            .catch((err) => {
                              setBillingError(
                                err instanceof Error
                                  ? err.message
                                  : String(err),
                              );
                              setBillingBusy(null);
                            });
                        }}
                      >
                        {billingBusy === tier.id
                          ? 'Opening…'
                          : `Choose ${tier.name}`}
                      </button>
                    ) : blockedReason ? (
                      <p className="text-[11px] text-ember/90">{blockedReason}</p>
                    ) : (
                      <p className="text-[11px] text-mist/70">—</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(billing?.plan === 'starter' ||
            billing?.plan === 'pro' ||
            usage?.plan === 'starter' ||
            usage?.plan === 'pro' ||
            usage?.plan === 'paid') && (
            <button
              type="button"
              disabled={billingBusy !== null}
              className="btn-secondary text-xs disabled:opacity-50"
              onClick={() => {
                setBillingBusy('portal');
                setBillingError(null);
                void openBillingPortal()
                  .then(({ url }) => {
                    window.location.assign(url);
                  })
                  .catch((err) => {
                    setBillingError(
                      err instanceof Error ? err.message : String(err),
                    );
                    setBillingBusy(null);
                  });
              }}
            >
              {billingBusy === 'portal' ? 'Opening…' : 'Manage billing'}
            </button>
          )}
        </div>
        <p className="text-[12px] leading-relaxed text-mist">
          Starter unlocks images, decks, flyers, and connector writes. Pro adds
          video. Hard caps still apply (3 images/day, 1 video/72h on Pro).
        </p>
      </section>

      {/* Connections */}
      <section className="surface mt-4 space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Connections
        </h2>

        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 pb-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-paper">
              Workflow connectors
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-mist">
              Gmail, Calendar, Sheets, Drive, Slack, Stripe, HubSpot — OAuth tokens in
              Secrets Manager only.
            </p>
          </div>
          <Link
            to="/app/settings/connections"
            className="btn-secondary shrink-0 text-xs"
          >
            Manage
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 pb-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-paper">Developer API</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-mist">
              API keys for <code className="font-mono text-paper">@walkcroach/sdk</code>{' '}
              — same memory graph as your projects.
            </p>
          </div>
          <Link
            to="/app/developer/keys"
            className="btn-secondary shrink-0 text-xs"
          >
            API keys
          </Link>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line/60 pb-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-paper">IDE</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-mist">
                Link VS Code, Cursor, or Insiders via the Connect IDE flow.
              </p>
            </div>
            <Link to="/connect/ide" className="btn-secondary shrink-0 text-xs">
              Connect IDE
            </Link>
          </div>

          <div className="border-b border-line/60 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-paper">GitHub</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-mist">
                  {githubLoading
                    ? 'Checking projects…'
                    : githubError
                      ? 'Could not load GitHub status for your projects.'
                      : connectedCount > 0
                        ? `${connectedCount} project${connectedCount === 1 ? '' : 's'} connected`
                        : 'No repos connected yet — open App Builder → Ship.'}
                </p>
                {githubError && (
                  <p className="mt-1 text-[11px] text-ember" role="status">
                    {githubError}
                  </p>
                )}
              </div>
              <Link
                to="/app/builder"
                className="btn-ghost shrink-0 text-xs"
              >
                App Builder
              </Link>
            </div>
            {!githubLoading && githubRows.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {githubRows.map((row) => (
                  <li
                    key={row.projectId}
                    className="flex items-center justify-between gap-2 text-[12px]"
                  >
                    <Link
                      to={`/app/projects/${row.projectId}`}
                      className="truncate text-mist hover:text-signal"
                    >
                      {row.projectName}
                    </Link>
                    <span
                      className={
                        row.connected
                          ? 'shrink-0 font-mono text-teal'
                          : 'shrink-0 text-mist/70'
                      }
                    >
                      {row.connected ? row.repo ?? 'connected' : 'not linked'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-paper">Chrome</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-mist">
                Sideload the MV3 extension from the repo (
                <code className="font-mono text-paper">cd chrome && npm run zip:prod</code>
                ). Store listing is in progress.
              </p>
            </div>
            <Link to="/app/apps" className="btn-ghost shrink-0 text-xs">
              Apps hub
            </Link>
          </div>
        </div>
      </section>

      <section className="surface mt-4 space-y-2 p-5 text-xs text-mist">
        <p className="font-semibold text-paper">Runtime (locked)</p>
        <p>
          App Builder prefers <span className="text-signal">E2B</span> when{' '}
          <code className="font-mono text-paper">E2B_API_KEY</code> is set;
          otherwise the browser uses a local preview sandbox (WebContainer).
          Same agent tools either way. Web search:{' '}
          <code className="font-mono text-paper">SEARXNG_URL</code>.
        </p>
      </section>

      {/* Session */}
      <section className="surface mt-4 space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Session
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          Signs you out on this device and clears stored credentials and local
          session caches.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="btn-secondary text-xs"
        >
          Sign out
        </button>
      </section>

      {/* Danger zone — Phase C account erase */}
      <section className="surface mt-4 space-y-3 border border-ember/35 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ember">
          Danger zone
        </h2>
        <p className="text-[12px] leading-relaxed text-mist">
          Permanently erase this account: revoke API keys, disconnect connectors,
          cancel and delete Stripe customer, delete S3 artefacts, redact chats
          and captures, tombstone memory (audited), soft-delete projects, then
          delete the Cognito user. This cannot be undone.
        </p>

        {!eraseOpen ? (
          <button
            type="button"
            className="interactive rounded-[var(--radius-control)] border border-ember/50 bg-ember/10 px-3 py-1.5 text-xs font-semibold text-ember"
            onClick={() => {
              setEraseOpen(true);
              setEraseError(null);
              setEraseProposal(null);
              setEraseEmail(user?.email?.trim() ?? '');
              setErasePhrase('');
            }}
            disabled={user?.isAnonymous === true}
          >
            Delete account…
          </button>
        ) : (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-ember/25 bg-ink/40 p-3">
            {!eraseProposal ? (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-mist">
                    Account email
                  </span>
                  <input
                    type="email"
                    autoComplete="email"
                    className="w-full rounded-[var(--radius-control)] border border-line bg-ink px-2.5 py-1.5 text-sm text-paper"
                    value={eraseEmail}
                    onChange={(e) => setEraseEmail(e.target.value)}
                    disabled={eraseBusy}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={eraseBusy || !eraseEmail.includes('@')}
                    className="interactive rounded-[var(--radius-control)] bg-ember px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                    onClick={() => {
                      setEraseBusy(true);
                      setEraseError(null);
                      void proposeAccountErase(eraseEmail.trim())
                        .then((p) => setEraseProposal(p))
                        .catch((err) =>
                          setEraseError(
                            err instanceof Error ? err.message : String(err),
                          ),
                        )
                        .finally(() => setEraseBusy(false));
                    }}
                  >
                    {eraseBusy ? 'Preparing…' : 'Continue'}
                  </button>
                  <button
                    type="button"
                    disabled={eraseBusy}
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setEraseOpen(false);
                      setEraseProposal(null);
                      setEraseError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] text-mist">
                  This will remove{' '}
                  <span className="text-paper">
                    {eraseProposal.summary.projects} project
                    {eraseProposal.summary.projects === 1 ? '' : 's'}
                  </span>
                  , revoke{' '}
                  <span className="text-paper">
                    {eraseProposal.summary.apiKeysActive} API key
                    {eraseProposal.summary.apiKeysActive === 1 ? '' : 's'}
                  </span>
                  , and disconnect{' '}
                  <span className="text-paper">
                    {eraseProposal.summary.connectorsConnected} connector
                    {eraseProposal.summary.connectorsConnected === 1 ? '' : 's'}
                  </span>
                  {eraseProposal.summary.hasStripeCustomer
                    ? ', and cancel your Stripe subscription'
                    : ''}
                  .
                </p>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-mist">
                    Re-type email
                  </span>
                  <input
                    type="email"
                    className="w-full rounded-[var(--radius-control)] border border-line bg-ink px-2.5 py-1.5 text-sm text-paper"
                    value={eraseEmail}
                    onChange={(e) => setEraseEmail(e.target.value)}
                    disabled={eraseBusy}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-mist">
                    Type{' '}
                    <span className="font-mono text-paper">
                      {eraseProposal.confirmPhrase}
                    </span>
                  </span>
                  <input
                    type="text"
                    autoComplete="off"
                    className="w-full rounded-[var(--radius-control)] border border-line bg-ink px-2.5 py-1.5 font-mono text-sm text-paper"
                    value={erasePhrase}
                    onChange={(e) => setErasePhrase(e.target.value)}
                    disabled={eraseBusy}
                    placeholder={eraseProposal.confirmPhrase}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      eraseBusy ||
                      erasePhrase !== eraseProposal.confirmPhrase ||
                      !eraseEmail.includes('@')
                    }
                    className="interactive rounded-[var(--radius-control)] bg-ember px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
                    onClick={() => {
                      setEraseBusy(true);
                      setEraseError(null);
                      void confirmAccountErase({
                        proposalId: eraseProposal.proposalId,
                        email: eraseEmail.trim(),
                        confirmPhrase: erasePhrase,
                      })
                        .then(async () => {
                          await signOut();
                        })
                        .catch((err) => {
                          setEraseError(
                            err instanceof Error ? err.message : String(err),
                          );
                          setEraseBusy(false);
                        });
                    }}
                  >
                    {eraseBusy ? 'Erasing…' : 'Erase my account'}
                  </button>
                  <button
                    type="button"
                    disabled={eraseBusy}
                    className="btn-ghost text-xs"
                    onClick={() => {
                      setEraseOpen(false);
                      setEraseProposal(null);
                      setErasePhrase('');
                      setEraseError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[11px] text-mist/70">
                  Proposal expires{' '}
                  {new Date(eraseProposal.expiresAt).toLocaleString()}.
                </p>
              </>
            )}
            {eraseError && (
              <p className="text-sm text-ember" role="alert">
                {eraseError}
              </p>
            )}
          </div>
        )}
      </section>

      <p className="mt-6 pb-8 text-[11px] text-mist/70">
        <a href="/privacy.html" className="text-signal underline-offset-2 hover:underline">
          Privacy
        </a>
        {' · '}
        Account erase is audited; memory uses tombstones, not silent delete.
      </p>
      </div>
    </div>
  );
}
