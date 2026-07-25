import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getGithubStatus, pushGithub } from '../../api/client';

type OpenInIdeChecklistProps = {
  projectId: string;
  projectName: string;
  listFiles: () => Promise<Array<{ path: string; content: string }>>;
  syncNow: () => Promise<Array<{ path: string; content: string }>>;
  open: boolean;
  onClose: () => void;
};

type StepId = 'github' | 'push' | 'connect';

/**
 * Honest IDE handoff: memory + Git (no sandbox session transfer).
 * Guides Connect → Push → Open Connect IDE.
 */
export function OpenInIdeChecklist({
  projectId,
  projectName,
  listFiles,
  syncNow,
  open,
  onClose,
}: OpenInIdeChecklistProps) {
  const [repo, setRepo] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>('github');

  const refresh = useCallback(async () => {
    try {
      const status = await getGithubStatus(projectId);
      setConnected(Boolean(status.connected && status.repo));
      setRepo(status.repo);
      if (status.connected && status.repo) setStep('push');
      else setStep('github');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    setPushed(false);
    setError(null);
    void refresh();
  }, [open, refresh]);

  const runPush = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = await syncNow();
      const payload = files.length > 0 ? files : await listFiles();
      if (payload.length === 0) {
        throw new Error('No files to push — wait for the sandbox to finish mounting.');
      }
      await pushGithub(projectId, {
        files: payload,
        message: `WalkCroach handoff · ${projectName}`,
      });
      setPushed(true);
      setStep('connect');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-labelledby="ide-handoff-title"
        className="w-full max-w-md rounded-[var(--radius-surface)] border border-line bg-panel p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p
              id="ide-handoff-title"
              className="font-display text-base font-bold text-paper"
            >
              Open in IDE
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-mist">
              IDE continues via project memory and Git — this Builder sandbox
              session does not hand off.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mist hover:text-paper"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <ol className="mt-4 space-y-3 text-sm">
          <li
            className={`rounded-sm border px-3 py-2 ${
              step === 'github' ? 'border-signal/40 bg-signal/5' : 'border-line'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider text-mist">
              1 · GitHub connected
            </p>
            <p className="mt-0.5 text-paper">
              {connected && repo ? (
                <span className="font-mono text-xs text-signal">{repo}</span>
              ) : (
                <>
                  Connect a repo in the Ship → GitHub panel first.{' '}
                  <button
                    type="button"
                    className="text-signal underline"
                    onClick={onClose}
                  >
                    Close & connect
                  </button>
                </>
              )}
            </p>
          </li>

          <li
            className={`rounded-sm border px-3 py-2 ${
              step === 'push' ? 'border-signal/40 bg-signal/5' : 'border-line'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider text-mist">
              2 · Push sandbox → GitHub
            </p>
            <p className="mt-0.5 text-[12px] text-mist">
              So the IDE can clone the same files the preview is running.
            </p>
            <button
              type="button"
              disabled={!connected || busy}
              onClick={() => void runPush()}
              className="mt-2 rounded-sm bg-signal px-3 py-1 text-[11px] font-medium text-ink disabled:opacity-40"
            >
              {busy ? 'Pushing…' : pushed ? 'Pushed · push again' : 'Push now'}
            </button>
          </li>

          <li
            className={`rounded-sm border px-3 py-2 ${
              step === 'connect' || pushed
                ? 'border-signal/40 bg-signal/5'
                : 'border-line'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider text-mist">
              3 · Open WalkCroach IDE
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-mist">
              In VS Code / Cursor: install the WalkCroach extension, run{' '}
              <span className="font-mono text-paper">WalkCroach: Sign In</span>
              {pushed && repo ? (
                <>
                  , then clone{' '}
                  <span className="font-mono text-paper">{repo}</span>
                </>
              ) : null}
              . Memory for{' '}
              <span className="text-paper">{projectName}</span> follows the
              linked account — sandbox session does not transfer.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                to="/app/apps"
                className="inline-flex rounded-sm border border-line px-3 py-1 text-[11px] text-paper hover:border-signal/40"
                onClick={onClose}
              >
                Apps · IDE install
              </Link>
              <button
                type="button"
                className="rounded-sm bg-signal px-3 py-1 text-[11px] font-medium text-ink"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </li>
        </ol>

        {error && <p className="mt-3 text-[11px] text-ember">{error}</p>}
      </div>
    </div>
  );
}
