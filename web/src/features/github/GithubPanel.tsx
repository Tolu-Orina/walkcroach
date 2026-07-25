import { useCallback, useEffect, useState } from 'react';
import {
  connectGithub,
  getGithubStatus,
  pullGithub,
  pushGithub,
} from '../../api/client';
import { allowGithubPat, isGithubAppEnabled } from '../../auth/github';

type GithubPanelProps = {
  projectId: string;
  listFiles: () => Promise<Array<{ path: string; content: string }>>;
  syncNow: () => Promise<Array<{ path: string; content: string }>>;
  /** Apply pulled files into the sandbox (E2B / WC). */
  applySnapshot?: (
    files: Array<{ path: string; content: string }>,
  ) => Promise<void>;
  /** Optional install after package.json changes. */
  applyTerminal?: (cmd: string) => Promise<{
    ok: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  /** Restart / refresh preview after pull. */
  refreshPreview?: () => Promise<void> | void;
  embedded?: boolean;
};

export function GithubPanel({
  projectId,
  listFiles,
  syncNow,
  applySnapshot,
  applyTerminal,
  refreshPreview,
  embedded = false,
}: GithubPanelProps) {
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [connectedRepo, setConnectedRepo] = useState<string | null>(null);
  const [authMethod, setAuthMethod] = useState<'app' | 'pat' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const appEnabled = isGithubAppEnabled();
  const patAllowed = allowGithubPat();

  const load = useCallback(async () => {
    try {
      const gh = await getGithubStatus(projectId);
      setConnectedRepo(gh.repo);
      setAuthMethod(gh.authMethod ?? null);
      if (gh.repo) setRepo(gh.repo);
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
    setStatus(null);
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
    setStatus(null);
    try {
      const files = await syncNow();
      const payload = files.length > 0 ? files : await listFiles();
      await pushGithub(projectId, {
        files: payload,
        message: 'WalkCroach sync',
      });
      setStatus(`Pushed ${payload.length} files`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    if (!applySnapshot) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await pullGithub(projectId);
      if (result.truncated) {
        setError(
          `Pull incomplete: GitHub tree was truncated or exceeded ${result.fileCount} files` +
            (result.omittedCount ? ` (~${result.omittedCount} omitted)` : '') +
            '. Preview may be mixed — push from IDE in smaller repos, or reset the sandbox.',
        );
      }
      await Promise.resolve(applySnapshot(result.files));
      const touchedPkg = result.files.some(
        (f) =>
          f.path === 'package.json' ||
          f.path.endsWith('/package.json') ||
          f.path === 'package-lock.json',
      );
      if (touchedPkg && applyTerminal) {
        setStatus('Installing dependencies after pull…');
        const install = await applyTerminal('npm install');
        if (!install.ok) {
          throw new Error(
            `npm install failed after pull: ${install.stderr || install.stdout || 'unknown'}`,
          );
        }
      }
      await syncNow();
      if (refreshPreview) await Promise.resolve(refreshPreview());
      setStatus(
        result.truncated
          ? `Pulled ${result.fileCount} files (truncated) · preview refreshing`
          : `Pulled ${result.fileCount} files · preview refreshing`,
      );
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
        <p className="mt-0.5 text-[10px] text-mist/80">
          Two-way sync with your repo (push + pull).
        </p>
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
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => void push()}
            disabled={busy}
            className="rounded-sm border border-line px-2 py-1 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
          >
            Push to GitHub
          </button>
          {applySnapshot && (
            <button
              type="button"
              onClick={() => void pull()}
              disabled={busy}
              className="rounded-sm border border-line px-2 py-1 text-[10px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
            >
              Pull → preview
            </button>
          )}
        </div>
      )}
      {status && <p className="mt-1 text-[10px] text-signal">{status}</p>}
      {error && <p className="mt-1 text-[10px] text-ember">{error}</p>}
    </div>
  );
}
