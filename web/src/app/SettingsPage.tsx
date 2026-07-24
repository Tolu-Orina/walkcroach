import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getGithubStatus,
  getUsage,
  listProjects,
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

/**
 * Profile / Settings — Phase F (PF-20 / PF-21 / PF-22).
 * Avatar in the ecosystem rail opens this page.
 */
export function SettingsPage() {
  const { user, signOut } = useAuth();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [githubRows, setGithubRows] = useState<GhRow[]>([]);
  const [githubLoading, setGithubLoading] = useState(true);

  useEffect(() => {
    void getUsage()
      .then((u) => {
        setUsage(u);
        setUsageError(null);
      })
      .catch((err) => {
        setUsage(null);
        setUsageError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setGithubLoading(true);
      try {
        const projects = await listProjects();
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
      } catch {
        if (!cancelled) setGithubRows([]);
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
    <div className="mx-auto max-w-2xl px-5 py-10 sm:px-6">
      <p className="eyebrow">Profile</p>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-paper">
        Settings
      </h1>
      <p className="mt-2 text-sm text-mist">
        Account, appearance, usage, and connections.
      </p>

      {/* PF-20 Account */}
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
          <button
            type="button"
            onClick={signOut}
            className="btn-secondary text-xs"
          >
            Sign out
          </button>
        </div>
      </section>

      {/* PF-20 Appearance */}
      <section className="surface mt-4 space-y-3 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Appearance
        </h2>
        <ThemeToggle />
      </section>

      {/* PF-20 Usage + PF-21 billing soon */}
      <section className="surface mt-4 space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Usage & billing
        </h2>
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
                  Free plan
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
        <p className="rounded-[var(--radius-control)] border border-line/80 bg-raised/40 px-3 py-2 text-[12px] leading-relaxed text-mist">
          Billing portal coming soon. This weekend ships the free credit meter
          only — Stripe Customer Portal is deferred.
        </p>
      </section>

      {/* PF-22 Connections */}
      <section className="surface mt-4 space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Connections
        </h2>

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
                    : connectedCount > 0
                      ? `${connectedCount} project${connectedCount === 1 ? '' : 's'} connected`
                      : 'No repos connected yet — open Builder → Ship.'}
                </p>
              </div>
              <Link
                to="/app/projects"
                className="btn-ghost shrink-0 text-xs"
              >
                Projects
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

      <p className="mt-6 text-[11px] text-mist/70">
        Account export / delete and social sign-in are out of weekend scope
        (PF-23 / PF-24 cut).
      </p>
    </div>
  );
}
