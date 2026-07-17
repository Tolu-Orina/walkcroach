import { useCallback, useEffect, useState } from 'react';
import {
  getDeployments,
  triggerDeploy,
  type DeploymentSummary,
} from '../../api/client';

export function useDeploy(
  projectId: string,
  projectName: string,
  listFiles: () => Promise<Array<{ path: string; content: string }>>,
  syncNow: () => Promise<Array<{ path: string; content: string }>>,
) {
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

  const deploy = useCallback(
    async (disabled?: boolean) => {
      if (disabled || busy) return;
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
    },
    [busy, listFiles, load, projectId, projectName, syncNow],
  );

  return {
    deployments,
    latest: deployments[0] ?? null,
    busy,
    error,
    deploy,
    reload: load,
  };
}
