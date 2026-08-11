import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  archiveProject,
  createProject,
  deleteProject,
  listProjects,
} from '../api/client';
import type { ProjectSummary } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { NameCreateDialog } from '../components/product/NameCreateDialog';
import { ProductEmptyState } from '../components/product/ProductEmptyState';
import { ProductErrorBanner } from '../components/product/ProductErrorBanner';
import { ProductPageHeader } from '../components/product/ProductPageHeader';
import { ProjectCardSkeleton } from '../components/Skeleton';

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

function ProjectCard({
  project,
  onArchive,
  onDelete,
}: {
  project: ProjectSummary;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const excerpt =
    project.description?.trim() ||
    project.memorySummary?.trim() ||
    'No description yet — open to add standing context.';

  return (
    <article className="surface interactive group relative flex min-h-[9.5rem] flex-col p-5 transition duration-150 hover:border-signal/35">
      <Link
        to={`/app/projects/${project.id}`}
        className="absolute inset-0 rounded-[var(--radius-surface)]"
        aria-label={`Open project ${project.name}`}
      />
      <h2 className="relative z-[1] pointer-events-none font-display text-xl font-bold tracking-tight text-paper group-hover:text-signal">
        {project.name}
      </h2>
      <p className="relative z-[1] pointer-events-none mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-mist">
        {excerpt}
      </p>
      <div className="relative z-[1] mt-4 flex items-center justify-between gap-2">
        <p className="pointer-events-none text-xs text-mist">
          Updated {formatUpdated(project.updatedAt)}
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onArchive(project.id);
            }}
            className="btn-ghost relative z-[2] min-h-8 px-2 text-xs"
          >
            Archive
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDelete(project.id);
            }}
            className="interactive relative z-[2] min-h-8 rounded-[var(--radius-control)] px-2 text-xs text-ember/90 hover:bg-ember/10 hover:text-ember"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listProjects({ kind: 'knowledge' });
      setProjects(list);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      setError(
        !raw || raw === 'Failed to fetch'
          ? 'Could not load projects — check your connection and try again.'
          : raw,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (name: string) => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { id } = await createProject(name, null, { kind: 'knowledge' });
      setCreateOpen(false);
      setCreating(false);
      navigate(`/app/projects/${id}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not create the project — try again.',
      );
      setCreating(false);
    }
  };

  const handleArchive = async (id: string) => {
    setError(null);
    try {
      await archiveProject(id);
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not archive the project — try again.',
      );
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await deleteProject(deleteTarget);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not delete the project — try again.',
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-8 sm:px-8">
      <div className="wc-enter">
        <ProductPageHeader
          eyebrow="Projects"
          title="Your projects"
          support={`${user?.displayName ?? 'You'} · chats, documents, and standing instructions — separate from App Builder`}
          primaryLabel="New project"
          onPrimary={() => setCreateOpen(true)}
          busy={creating}
          primaryBusyLabel="Creating…"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-8">
        {loading && (
          <div className="grid gap-6 sm:grid-cols-2" aria-busy="true">
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </div>
        )}

        {!loading && error && (
          <ProductErrorBanner message={error} onRetry={() => void load()} />
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="wc-enter-delay">
            <ProductEmptyState
              title="No projects yet"
              body="Create a project for chats that share standing instructions, documents, and memory. App Builder is a separate place to ship apps."
              actionLabel="New project"
              onAction={() => setCreateOpen(true)}
            />
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="wc-stagger grid gap-6 sm:grid-cols-2">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onArchive={(id) => void handleArchive(id)}
                onDelete={(id) => setDeleteTarget(id)}
              />
            ))}
          </div>
        )}
      </div>

      <NameCreateDialog
        open={createOpen}
        creating={creating}
        title="New project"
        description="A place for chats, documents, and standing instructions."
        defaultName="Untitled project"
        confirmLabel="Create project"
        onClose={() => setCreateOpen(false)}
        onCreate={(name) => void handleCreate(name)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete project?"
        message="This removes the project from your account. Access is revoked immediately; data is soft-deleted and cannot be recovered from the UI."
        confirmLabel="Delete project"
        destructive
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
