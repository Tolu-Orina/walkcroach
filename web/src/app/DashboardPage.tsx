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
import { ProjectCardSkeleton } from '../components/Skeleton';
import { BuilderIconLink } from '../features/builder/BuilderIconLink';
import { NewProjectDialog } from '../features/projects/NewProjectDialog';

function statusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'building':
      return 'Building';
    case 'ready':
      return 'Ready';
    case 'archived':
      return 'Archived';
    default:
      return status;
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
  return (
    <div className="surface interactive p-5 transition hover:border-signal/35">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/app/projects/${project.id}`}
          className="interactive min-w-0 flex-1 font-display text-xl font-bold tracking-tight text-paper hover:text-signal"
        >
          {project.name}
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <BuilderIconLink projectId={project.id} />
          <span className="rounded-[var(--radius-control)] border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-mist">
            {statusLabel(project.status)}
          </span>
        </div>
      </div>
      {project.description ? (
        <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-mist">
          {project.description}
        </p>
      ) : project.memorySummary ? (
        <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-mist">
          {project.memorySummary}
        </p>
      ) : null}
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-[11px] text-mist/80">
          Updated {new Date(project.updatedAt).toLocaleString()}
        </p>
        <div className="flex gap-1 text-[12px]">
          <button
            type="button"
            onClick={() => onArchive(project.id)}
            className="btn-ghost min-h-8 px-2 text-xs"
          >
            Archive
          </button>
          <button
            type="button"
            onClick={() => onDelete(project.id)}
            className="interactive min-h-8 rounded-[var(--radius-control)] px-2 text-xs text-ember/90 hover:bg-ember/10 hover:text-ember"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
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
      const list = await listProjects();
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      // Knowledge container — no app template. Starters live in Builder.
      const { id } = await createProject(name);
      setCreateOpen(false);
      setCreating(false);
      navigate(`/app/projects/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  };

  const handleArchive = async (id: string) => {
    setError(null);
    try {
      await archiveProject(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteTarget(id);
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-9 sm:px-8">
      <header className="border-b border-line pb-7">
        <p className="eyebrow">Projects</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-paper">
              Your projects
            </h1>
            <p className="mt-1.5 text-sm text-mist">
              {user?.displayName ?? 'You'} · chats, docs, and standing context
              across each project’s life
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={creating}
            className="btn-primary text-xs"
          >
            {creating ? 'Creating…' : 'New project'}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        {loading && (
          <div className="grid gap-4 sm:grid-cols-2">
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </div>
        )}
        {error && <p className="text-sm text-ember">{error}</p>}
        {!loading && !error && projects.length === 0 && (
          <div className="rounded-sm border border-dashed border-line px-6 py-12 text-center">
            <p className="text-sm text-mist">No projects yet.</p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="interactive mt-4 text-sm text-signal underline-offset-2 hover:underline"
            >
              Create your first project
            </button>
          </div>
        )}
        {!loading && (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onArchive={(id) => void handleArchive(id)}
                onDelete={(id) => void handleDelete(id)}
              />
            ))}
          </div>
        )}
      </div>

      <NewProjectDialog
        open={createOpen}
        creating={creating}
        onClose={() => setCreateOpen(false)}
        onCreate={(name) => void handleCreate(name)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete project?"
        message="This removes the project from your account. Access is revoked immediately; data is soft-deleted and cannot be recovered from the UI."
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
