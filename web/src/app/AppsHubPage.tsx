import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMyApps, type MyAppDeployment } from '../api/client';

const ECOSYSTEM = [
  {
    id: 'ide',
    name: 'IDE',
    blurb: 'Continue in VS Code or Cursor with the WalkCroach extension.',
    href: '/connect/ide',
    cta: 'Connect IDE',
    available: true,
  },
  {
    id: 'chrome',
    name: 'Chrome',
    blurb:
      'MV3 extension — connect your signed-in Web account, then sideload a store zip until CWS is live.',
    href: '/connect/chrome',
    cta: 'Connect Chrome',
    available: true,
  },
  {
    id: 'desktop',
    name: 'Desktop',
    blurb: 'Native shell for long-running builder sessions (preview builds).',
    href: null,
    cta: 'Preview builds',
    available: false,
  },
  {
    id: 'cli',
    name: 'CLI',
    blurb:
      'Terminal workflow — sign in via Web, then prompt and deploy from the shell.',
    href: '/connect/cli',
    cta: 'Connect CLI',
    available: true,
  },
] as const;

function statusTone(status: string): string {
  if (status === 'live' || status === 'ready' || status === 'succeeded') {
    return 'text-teal';
  }
  if (status === 'failed' || status === 'error') return 'text-ember';
  return 'text-signal';
}

export function AppsHubPage() {
  const [apps, setApps] = useState<MyAppDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listMyApps();
        if (!cancelled) setApps(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl overflow-y-auto px-5 py-10 sm:px-8">
      <p className="eyebrow">Ecosystem</p>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-paper">
        Apps
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist">
        Your deployments and WalkCroach products across surfaces.
      </p>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          My deployments
        </h2>
        {loading && <p className="mt-4 text-sm text-mist">Loading…</p>}
        {error && (
          <p className="mt-4 rounded-[var(--radius-control)] border border-ember/30 bg-ember/10 px-3 py-2 text-sm text-paper">
            {error}
          </p>
        )}
        {!loading && !error && apps.length === 0 && (
          <div className="surface mt-4 border-dashed p-6 text-center">
            <p className="font-display text-base font-bold text-paper">
              No deployments yet
            </p>
            <p className="mt-2 text-sm text-mist">
              Deploy from App Builder → Ship when a preview looks right.
            </p>
            <Link
              to="/app/projects"
              className="btn-secondary mt-4 inline-flex text-xs"
            >
              Open Projects
            </Link>
          </div>
        )}
        {!loading && apps.length > 0 && (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-panel/40 backdrop-blur-md">
            {apps.map((app) => (
              <li
                key={app.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-bold text-paper">
                    {app.projectName}
                  </p>
                  <p className="mt-0.5 text-[12px] text-mist">
                    <span className={statusTone(app.status)}>{app.status}</span>
                    {' · '}
                    {app.target}
                    {' · '}
                    {new Date(app.deployedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {app.url && (
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-primary text-xs"
                    >
                      Open live
                    </a>
                  )}
                  <Link
                    to={`/app/projects/${app.projectId}/builder`}
                    className="btn-secondary text-xs"
                  >
                    Builder
                  </Link>
                  <Link
                    to={`/app/projects/${app.projectId}`}
                    className="btn-ghost text-xs"
                  >
                    Project
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Products
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {ECOSYSTEM.map((item) => (
            <li key={item.id}>
              <div className="surface h-full p-4">
                <p className="font-display text-lg font-bold text-paper">
                  {item.name}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-mist">
                  {item.blurb}
                </p>
                {item.available && item.href ? (
                  <Link
                    to={item.href}
                    className="btn-secondary mt-4 inline-flex text-xs"
                  >
                    {item.cta}
                  </Link>
                ) : (
                  <span className="mt-4 inline-flex text-[11px] font-semibold uppercase tracking-wider text-mist/70">
                    {item.cta}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
          Plugins
        </h2>
        <div className="surface mt-4 border-dashed p-6">
          <p className="font-display text-base font-bold text-paper">
            Plugins — coming soon
          </p>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-mist">
            Marketplace and MCP connectors are out of weekend scope. This surface
            is reserved for extensions that plug into Chat and Builder.
          </p>
        </div>
      </section>
    </div>
  );
}
