import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createProject, listProjects } from '../api/client';
import type { ProjectSummary } from '../api/types';
import { NameCreateDialog } from '../components/product/NameCreateDialog';
import { ProductEmptyState } from '../components/product/ProductEmptyState';
import { ProductErrorBanner } from '../components/product/ProductErrorBanner';
import { ProductPageHeader } from '../components/product/ProductPageHeader';
import { ProjectCardSkeleton } from '../components/Skeleton';
import {
  readLastBuilderProjectId,
  rememberBuilderProject,
} from '../lib/lastBuilderProject';
import { builderWorkspacePath } from '../lib/builderRoutes';

function formatUpdated(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * App Builder hub (ADR-0004 Phase 4).
 * Lists kind=app workspaces; never opens Projects (knowledge).
 */
export function BuilderLaunchPage() {
  const navigate = useNavigate();
  const [apps, setApps] = useState<ProjectSummary[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects({ kind: 'app' });
      setApps(list);
      const last = readLastBuilderProjectId();
      setLastId(last && list.some((p) => p.id === last) ? last : null);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      setError(
        !raw || raw === 'Failed to fetch'
          ? 'Could not open App Builder — check your connection and try again.'
          : raw,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openWorkspace = (id: string) => {
    rememberBuilderProject(id);
    navigate(builderWorkspacePath(id));
  };

  const handleCreate = async (name: string) => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { id } = await createProject(name, 'blank', { kind: 'app' });
      rememberBuilderProject(id);
      setCreateOpen(false);
      navigate(builderWorkspacePath(id), { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not create an App Builder workspace — try again.',
      );
      setCreating(false);
    }
  };

  const lastApp = lastId ? apps.find((a) => a.id === lastId) : undefined;
  const primaryIsContinue = Boolean(lastApp);

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-8 sm:px-8">
      <div className="wc-enter">
        <ProductPageHeader
          eyebrow="App Builder"
          title="Your workspaces"
          support="Plan, preview, and ship apps. Workspaces here are separate from Projects."
          primaryLabel={
            primaryIsContinue
              ? `Continue ${lastApp!.name}`
              : 'New in App Builder'
          }
          onPrimary={() => {
            if (primaryIsContinue && lastApp) {
              openWorkspace(lastApp.id);
              return;
            }
            setCreateOpen(true);
          }}
          busy={creating}
          primaryBusyLabel="Creating…"
        />
      </div>

      {primaryIsContinue && (
        <div className="wc-enter-delay mt-4">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={creating}
            onClick={() => setCreateOpen(true)}
          >
            New in App Builder
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-8">
        {loading && (
          <div className="grid gap-6 sm:grid-cols-2" aria-busy="true">
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </div>
        )}

        {!loading && error && (
          <ProductErrorBanner message={error} onRetry={() => void load()} />
        )}

        {!loading && !error && apps.length === 0 && (
          <div className="wc-enter-delay">
            <ProductEmptyState
              title="No App Builder workspaces yet"
              body="Create a workspace to plan, preview, and deploy. Projects stay for chats and knowledge — they won’t appear here."
              actionLabel="New in App Builder"
              onAction={() => setCreateOpen(true)}
              actionDisabled={creating}
            />
          </div>
        )}

        {!loading && !error && apps.length > 0 && (
          <ul className="wc-stagger divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-panel/85">
            {apps.map((app) => {
              const isLast = app.id === lastId;
              return (
                <li key={app.id}>
                  <button
                    type="button"
                    onClick={() => openWorkspace(app.id)}
                    className="interactive flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-raised/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-display text-base font-bold text-paper">
                        {app.name}
                        {isLast ? (
                          <span className="ml-2 text-xs font-medium text-teal">
                            Last opened
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs text-mist">
                        Updated {formatUpdated(app.updatedAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-signal">
                      Open in App Builder
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && !error && (
          <p className="mt-8 text-center text-sm text-mist">
            Looking for chats and documents?{' '}
            <Link
              to="/app/projects"
              className="interactive text-signal underline-offset-2 hover:underline"
            >
              Go to Projects
            </Link>
          </p>
        )}
      </div>

      <NameCreateDialog
        open={createOpen}
        creating={creating}
        title="New in App Builder"
        description="Name this workspace. You can pick a starter template after it opens."
        defaultName="Untitled"
        confirmLabel="Open App Builder"
        onClose={() => setCreateOpen(false)}
        onCreate={(name) => void handleCreate(name)}
      />
    </div>
  );
}
