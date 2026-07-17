import { useCallback, useEffect, useState } from 'react';
import {
  getDeployments,
  triggerDeploy,
  type DeploymentSummary,
} from '../../api/client';

type DeployPanelProps = {
  projectId: string;
  projectName: string;
  listFiles: () => Promise<Array<{ path: string; content: string }>>;
  syncNow: () => Promise<Array<{ path: string; content: string }>>;
  disabled?: boolean;
};

export function DeployPanel({
  projectId,
  projectName,
  listFiles,
  syncNow,
  disabled,
}: DeployPanelProps) {
  const [deployments, setDeployments] = useState<DeploymentSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await getDeployments(projectId);
      setDeployments(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const deploy = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = await syncNow();
      const payload = files.length > 0 ? files : await listFiles();
      await triggerDeploy(projectId, { files: payload, projectName });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const latest = deployments[0];

  return (
    <div className="border-t border-line px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-mist">Deploy</p>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void deploy()}
          className="rounded-sm bg-signal px-2 py-1 text-[10px] font-medium text-ink disabled:opacity-40"
        >
          {busy ? 'Deploying…' : 'Deploy'}
        </button>
      </div>
      <p className="mt-0.5 text-[10px] text-mist/80">
        Publishes to{' '}
        <span className="font-mono text-mist">
          {'{slug}'}.walkcroach.conquerorfoundation.com
        </span>
      </p>
      {latest?.url && (
        <p className="mt-1 truncate font-mono text-[10px] text-signal">
          <a href={latest.url} target="_blank" rel="noreferrer" className="hover:underline">
            {latest.url}
          </a>
          {' · '}
          {latest.status}
        </p>
      )}
      {deployments.length > 1 && (
        <ul className="mt-2 max-h-20 space-y-1 overflow-y-auto text-[10px] text-mist">
          {deployments.slice(0, 5).map((d) => (
            <li key={d.id} className="flex justify-between gap-2">
              <span className="truncate">{d.status}</span>
              <span className="shrink-0">{new Date(d.deployedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-[10px] text-ember">{error}</p>}
    </div>
  );
}
