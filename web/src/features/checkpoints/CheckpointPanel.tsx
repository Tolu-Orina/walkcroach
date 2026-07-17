import { useCallback, useEffect, useState } from 'react';
import {
  createCheckpoint,
  exportProject,
  listCheckpoints,
  revertCheckpoint,
  syncProjectFiles,
} from '../../api/client';
import type { CheckpointSummary } from '../../api/types';
import type { ProjectFile } from '../../webcontainer/files';

type CheckpointPanelProps = {
  projectId: string;
  sessionId: string | null;
  listFiles: () => Promise<ProjectFile[]>;
  applySnapshot: (files: ProjectFile[]) => Promise<void>;
  refreshKey?: number;
};

export function CheckpointPanel({
  projectId,
  sessionId,
  listFiles,
  applySnapshot,
  refreshKey = 0,
}: CheckpointPanelProps) {
  const [open, setOpen] = useState(true);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCheckpoints(projectId);
      setCheckpoints(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleManual = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const files = await listFiles();
      await createCheckpoint(projectId, {
        name: name.trim() || undefined,
        summary: name.trim() ? `Manual: ${name.trim()}` : 'Manual checkpoint',
        sessionId: sessionId ?? undefined,
        files,
      });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = async (checkpointId: string) => {
    if (busy) return;
    if (!window.confirm('Revert preview to this checkpoint?')) return;
    setBusy(true);
    setError(null);
    try {
      const { files } = await revertCheckpoint(checkpointId);
      await applySnapshot(files);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const files = await listFiles();
      if (files.length > 0) {
        await syncProjectFiles(projectId, files);
      }
      const { url } = await exportProject(projectId);
      if (url.startsWith('file://')) {
        setError('Export ready locally — deploy with ARTEFACTS_BUCKET for download URL.');
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-line bg-ink/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-[11px] uppercase tracking-wider text-mist hover:text-paper"
      >
        <span>Versions</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-3">
          {error && <p className="text-[10px] text-ember">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Checkpoint name (optional)"
              className="min-w-0 flex-1 rounded-sm border border-line bg-ink/60 px-2 py-1 text-[11px] text-paper"
              disabled={busy}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleManual()}
              className="rounded-sm border border-line px-2 py-1 text-[10px] text-paper hover:border-signal/40 disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExport()}
              className="rounded-sm bg-signal px-2 py-1 text-[10px] font-medium text-ink disabled:opacity-40"
            >
              Export ZIP
            </button>
          </div>
          {loading && <p className="text-[10px] text-mist">Loading…</p>}
          <ul className="max-h-28 space-y-1 overflow-y-auto">
            {checkpoints.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-2 text-[10px] text-mist"
              >
                <div className="min-w-0">
                  <p className="truncate text-paper">
                    {c.name ?? c.summary}
                  </p>
                  <p className="text-mist/70">
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRevert(c.id)}
                  className="shrink-0 text-signal hover:underline disabled:opacity-40"
                >
                  Revert
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
