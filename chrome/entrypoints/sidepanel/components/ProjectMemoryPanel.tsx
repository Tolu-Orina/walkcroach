import { useCallback, useEffect, useState } from 'react';
import {
  listProjectMemory,
  rememberProjectMemory,
  type ProjectMemoryEntry,
} from '../../../lib/sdkClient';

type ProjectMemoryPanelProps = {
  projectId: string;
  projectName: string | null;
  /** Only Cognito sessions can call IDE `/v1`. */
  enabled: boolean;
};

/**
 * Linked-project memory via `@walkcroach/sdk` (list + remember).
 * Capture mirror and recall streams stay on the chrome BFF.
 */
export function ProjectMemoryPanel({
  projectId,
  projectName,
  enabled,
}: ProjectMemoryPanelProps) {
  const [entries, setEntries] = useState<ProjectMemoryEntry[]>([]);
  const [open, setOpen] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !projectId) {
      setEntries([]);
      return;
    }
    try {
      const mem = await listProjectMemory(projectId);
      setEntries((mem.entries ?? []).slice(0, 12));
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not load project memory',
      );
    }
  }, [enabled, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled) return null;

  const onRemember = () => {
    const text = note.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    void rememberProjectMemory({
      projectId,
      kind: 'preference',
      text,
    })
      .then(async () => {
        setNote('');
        await load();
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Remember failed'),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="wc-section" style={{ marginTop: 12 }}>
      <button
        type="button"
        className="wc-btn wc-btn--ghost"
        style={{ width: '100%', justifyContent: 'space-between' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wc-section__title" style={{ margin: 0 }}>
          Project memory
          {entries.length ? ` · ${entries.length}` : ''}
        </span>
        <span className="wc-muted wc-small">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
          <p className="wc-muted wc-small">
            Shared with
            {projectName ? ` “${projectName}”` : ' your linked Web project'} via
            the WalkCroach memory API.
          </p>
          {error && <p className="wc-error">{error}</p>}
          <div className="wc-ask">
            <label className="wc-sr-only" htmlFor="wc-project-memory-note">
              Remember a note
            </label>
            <input
              id="wc-project-memory-note"
              className="wc-input"
              value={note}
              placeholder="Remember a note for this project…"
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRemember();
              }}
            />
            <button
              type="button"
              className="wc-btn"
              disabled={busy || !note.trim()}
              onClick={onRemember}
            >
              Remember
            </button>
          </div>
          {entries.length > 0 ? (
            <ul className="wc-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <div className="wc-list__body">
                    <span className="wc-list__title">
                      {e.kind}
                      {e.sourceSurface ? ` · ${e.sourceSurface}` : ''}
                    </span>
                    <span className="wc-list__sub">{e.text}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            !error && (
              <p className="wc-muted wc-small">
                No project memories yet — save a page (mirrors as capture) or
                remember a note above.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}
