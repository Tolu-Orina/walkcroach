import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listMyApps, type MyAppDeployment } from '../api/client';
import { ProductEmptyState } from '../components/product/ProductEmptyState';
import { ProductErrorBanner } from '../components/product/ProductErrorBanner';
import { ProductPageHeader } from '../components/product/ProductPageHeader';
import { ProjectCardSkeleton } from '../components/Skeleton';
import { builderWorkspacePath } from '../lib/builderRoutes';

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
    blurb: 'Native shell for long-running App Builder sessions (preview builds).',
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
  const navigate = useNavigate();
  const [apps, setApps] = useState<MyAppDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listMyApps();
      setApps(rows);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      setError(
        !raw || raw === 'Failed to fetch'
          ? 'Could not load deployments — check your connection and try again.'
          : raw,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-8 sm:px-8">
      <div className="wc-enter mx-auto w-full max-w-5xl">
        <ProductPageHeader
          eyebrow="Apps"
          title="Deployments"
          support="Shipped outputs from App Builder. Connect IDE, Chrome, Desktop, or CLI when you need them."
          primaryLabel="Open App Builder"
          onPrimary={() => navigate('/app/builder')}
        />
      </div>

      <div className="mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-y-auto py-8">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
            My deployments
          </h2>

          {loading && (
            <div className="mt-4 space-y-3" aria-busy="true">
              <ProjectCardSkeleton />
              <ProjectCardSkeleton />
            </div>
          )}

          {!loading && error && (
            <div className="mt-4">
              <ProductErrorBanner message={error} onRetry={() => void load()} />
            </div>
          )}

          {!loading && !error && apps.length === 0 && (
            <div className="mt-4 wc-enter-delay">
              <ProductEmptyState
                title="No deployments yet"
                body="Deploy from App Builder → Ship when a preview looks right."
                actionLabel="Open App Builder"
                onAction={() => navigate('/app/builder')}
              />
            </div>
          )}

          {!loading && !error && apps.length > 0 && (
            <ul className="wc-stagger mt-4 divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-panel/85">
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
                      to={builderWorkspacePath(app.projectId)}
                      className="btn-secondary text-xs"
                    >
                      Open in App Builder
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
              Marketplace and MCP connectors are out of weekend scope. This
              surface is reserved for extensions that plug into Chat and App
              Builder.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
