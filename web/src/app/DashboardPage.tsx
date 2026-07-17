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
import { AppShell } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProjectCardSkeleton } from '../components/Skeleton';
import { TemplateGallery } from '../features/onboarding/TemplateGallery';

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
    <div className="interactive rounded-sm border border-line bg-panel/50 p-4 transition hover:border-signal/40 hover:bg-panel/80">
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/project/${project.id}`}
          className="interactive min-w-0 flex-1 font-display text-lg font-bold text-paper hover:text-signal"
        >
          {project.name}
        </Link>
        <span className="shrink-0 rounded-sm border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-mist">
          {statusLabel(project.status)}
        </span>
      </div>
      {project.memorySummary && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-mist">
          {project.memorySummary}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[10px] text-mist/80">
          Updated {new Date(project.updatedAt).toLocaleString()}
        </p>
        <div className="flex gap-2 text-[10px]">
          <button
            type="button"
            onClick={() => onArchive(project.id)}
            className="interactive min-h-8 px-2 text-mist hover:text-paper"
          >
            Archive
          </button>
          <button
            type="button"
            onClick={() => onDelete(project.id)}
            className="interactive min-h-8 px-2 text-ember/90 hover:text-ember"
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
  const [galleryOpen, setGalleryOpen] = useState(false);
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

  const handleCreate = async (templateId: string, name: string) => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const { id } = await createProject(name, templateId);
      setGalleryOpen(false);
      navigate(`/project/${id}`);
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
    <AppShell>
      <div className="flex h-full min-h-0 flex-col px-4 py-8 sm:px-6">
        <header className="border-b border-line pb-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Dashboard</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-extrabold text-paper">
                Your projects
              </h1>
              <p className="mt-1 text-sm text-mist">
                {user?.displayName ?? 'Builder'} · memory persists across sessions
              </p>
            </div>
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
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
                onClick={() => setGalleryOpen(true)}
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

        <TemplateGallery
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          onSelect={(templateId, name) => void handleCreate(templateId, name)}
          creating={creating}
        />
        <ConfirmDialog
          open={deleteTarget !== null}
          title="Delete project?"
          message="This permanently removes the project and cannot be undone."
          confirmLabel="Delete"
          destructive
          busy={deleteBusy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </AppShell>
  );
}
