import { useCallback, useEffect, useState } from 'react';
import {
  getProjectResources,
  provisionProjectDatabase,
  type ProjectResources,
} from '../../api/client';

type DatabasePanelProps = {
  projectId: string;
  onScaffoldFiles: (files: Record<string, string>) => void;
};

export function DatabasePanel({ projectId, onScaffoldFiles }: DatabasePanelProps) {
  const [resources, setResources] = useState<ProjectResources | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getProjectResources(projectId);
      setResources(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const provision = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await provisionProjectDatabase(projectId);
      if (result.scaffold) {
        onScaffoldFiles(result.scaffold);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-line px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-mist">Generated database</p>
      {resources?.database ? (
        <div className="mt-1 font-mono text-[10px] text-mist">
          <p>{resources.database.name}</p>
          <p className="text-mist/70">proxy {resources.database.proxySqlPath}</p>
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-mist/80">No database provisioned yet.</p>
      )}
      <button
        type="button"
        onClick={() => void provision()}
        disabled={busy}
        className="mt-2 rounded-sm border border-line px-2 py-1 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
      >
        {resources?.database ? 'Re-check database' : 'Add a database'}
      </button>
      {error && <p className="mt-1 text-[10px] text-ember">{error}</p>}
    </div>
  );
}
