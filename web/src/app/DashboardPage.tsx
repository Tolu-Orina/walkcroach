import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  archiveProject,
  createProject,
  deleteProject,
  listProjects,
} from '../api/client';
import type { ProjectSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';
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
    <div className="rounded-sm border border-line bg-panel/50 p-4 transition hover:border-signal/40 hover:bg-panel/80">
      <div className="flex items-start justify-between gap-3">
        <Link to={`/project/${project.id}`} className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-paper">{project.name}</h2>
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
            className="text-mist hover:text-paper"
          >
            Archive
          </button>
          <button
            type="button"
            onClick={() => onDelete(project.id)}
            className="text-ember/90 hover:text-ember"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

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
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    setError(null);
    try {
      await deleteProject(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Dashboard</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold text-paper">
            Your projects
          </h1>
          <p className="mt-1 text-sm text-mist">
            {user?.displayName ?? 'Builder'} · memory persists across sessions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            disabled={creating}
            className="rounded-sm bg-signal px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'New project'}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="text-[11px] text-mist underline-offset-2 hover:text-paper hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        {loading && <p className="text-sm text-mist">Loading projects…</p>}
        {error && <p className="text-sm text-ember">{error}</p>}
        {!loading && !error && projects.length === 0 && (
          <div className="rounded-sm border border-dashed border-line px-6 py-12 text-center">
            <p className="text-sm text-mist">No projects yet.</p>
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              className="mt-4 text-sm text-signal underline-offset-2 hover:underline"
            >
              Create your first project
            </button>
          </div>
        )}
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
      </div>

      <TemplateGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={(templateId, name) => void handleCreate(templateId, name)}
        creating={creating}
      />
    </div>
  );
}
