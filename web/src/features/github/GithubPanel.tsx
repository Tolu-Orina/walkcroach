import { useCallback, useEffect, useState } from 'react';
import {
  connectGithub,
  getGithubStatus,
  pushGithub,
} from '../../api/client';
import { allowGithubPat, isGithubAppEnabled } from '../../auth/github';

type GithubPanelProps = {
  projectId: string;
  listFiles: () => Promise<Array<{ path: string; content: string }>>;
  syncNow: () => Promise<Array<{ path: string; content: string }>>;
  embedded?: boolean;
};

export function GithubPanel({
  projectId,
  listFiles,
  syncNow,
  embedded = false,
}: GithubPanelProps) {
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [connectedRepo, setConnectedRepo] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<'app' | 'pat' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const appEnabled = isGithubAppEnabled();
  const patAllowed = allowGithubPat();

  const load = useCallback(async () => {
    try {
      const status = await getGithubStatus(projectId);
      setConnectedRepo(status.repo);
      setAuthMethod(status.authMethod ?? null);
      if (status.repo) setRepo(status.repo);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    if (!repo.trim()) return;
    if (!appEnabled && (!patAllowed || !token)) return;

    setBusy(true);
    setError(null);
    try {
      const result = await connectGithub(
        projectId,
        repo.trim(),
        appEnabled ? undefined : token,
      );
      if (result.installUrl) {
        window.location.assign(result.installUrl);
        return;
      }
      setToken('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const push = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = await syncNow();
      const payload = files.length > 0 ? files : await listFiles();
      await pushGithub(projectId, {
        files: payload,
        message: 'WalkCroach sync',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? 'px-4 py-3' : 'border-t border-line px-3 py-2'}>
      <p className="text-[10px] uppercase tracking-wider text-mist">GitHub</p>
      {connectedRepo ? (
        <p className="mt-0.5 font-mono text-[10px] text-mist">
          {connectedRepo}
          {authMethod ? ` · ${authMethod}` : ''}
        </p>
      ) : (
        <p className="mt-0.5 text-[10px] text-mist/80">One-way push to your repo.</p>
      )}
      {!connectedRepo && (
        <div className="mt-2 flex flex-col gap-1.5">
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            className="rounded-sm border border-line bg-ink/60 px-2 py-1 text-[11px] text-paper outline-none focus:border-signal/50"
            disabled={busy}
          />
          {patAllowed && !appEnabled && (
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="GitHub PAT (repo scope)"
              className="rounded-sm border border-line bg-ink/60 px-2 py-1 text-[11px] text-paper outline-none focus:border-signal/50"
              disabled={busy}
            />
          )}
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || !repo.trim() || (!appEnabled && patAllowed && !token)}
            className="self-start rounded-sm border border-line px-2 py-1 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
          >
            {appEnabled ? 'Connect with GitHub' : 'Connect'}
          </button>
        </div>
      )}
      {connectedRepo && (
        <button
          type="button"
          onClick={() => void push()}
          disabled={busy}
          className="mt-2 rounded-sm border border-line px-2 py-1 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
        >
          Sync to GitHub
        </button>
      )}
      {error && <p className="mt-1 text-[10px] text-ember">{error}</p>}
    </div>
  );
}
