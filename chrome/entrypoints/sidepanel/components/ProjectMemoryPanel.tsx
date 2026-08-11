import { useCallback, useEffect, useState } from 'react';
import {
  listProjectMemory,
  rememberProjectMemory,
  type ProjectMemoryEntry,
} from '../../../lib/sdkClient';
import { formatUiError } from '../../../lib/errors';

type ProjectMemoryPanelProps = {
  projectId: string;
  projectName: string | null;
  /** Only Cognito sessions can call IDE `/v1`. */
  enabled: boolean;
};

const KIND_LABELS: Record<string, string> = {
  preference: 'Preference',
  decision: 'Decision',
  note: 'Note',
  fact: 'Fact',
  capture: 'Capture',
};

const SURFACE_LABELS: Record<string, string> = {
  chrome: 'Chrome',
  web: 'Web',
  ide: 'IDE',
  cli: 'CLI',
  sdk: 'SDK',
  desktop: 'Desktop',
};

/** Memory kinds and surfaces arrive as raw API enums — show people words. */
export function humanizeMemoryKind(kind: string): string {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

export function humanizeMemorySurface(surface: string): string {
  return SURFACE_LABELS[surface] ?? surface;
}

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !projectId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const mem = await listProjectMemory(projectId);
      setEntries((mem.entries ?? []).slice(0, 12));
      setError(null);
    } catch (err) {
      setError(
        formatUiError(err, 'Couldn’t load project memory. Try again.'),
      );
    } finally {
      setLoading(false);
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
        setError(formatUiError(err, 'Couldn’t save that note. Try again.')),
      )
      .finally(() => setBusy(false));
  };

  return (
    <div className="wc-section wc-project-memory">
      <button
        type="button"
        className="wc-btn wc-btn--ghost wc-project-memory__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Hide project memory' : 'Show project memory'}
      >
        <span className="wc-section__title wc-project-memory__title">
          Project memory
          {entries.length ? ` · ${entries.length}` : ''}
        </span>
        <span className="wc-muted wc-small">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <>
          <p className="wc-muted wc-small">
            Shared with
            {projectName ? ` “${projectName}”` : ' your linked Web project'}{' '}
            across WalkCroach.
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
              Remember note
            </button>
          </div>
          {loading && !entries.length && !error ? (
            <div className="wc-skeleton-stack" aria-busy="true">
              <span className="wc-sr-only" role="status">
                Loading project memory
              </span>
              <div className="wc-skeleton" style={{ width: '70%' }} />
              <div className="wc-skeleton" style={{ width: '90%' }} />
              <div className="wc-skeleton" style={{ width: '55%' }} />
            </div>
          ) : entries.length > 0 ? (
            <ul className="wc-list">
              {entries.map((e) => (
                <li key={e.id}>
                  <div className="wc-list__body">
                    <span className="wc-list__title">
                      {humanizeMemoryKind(e.kind)}
                      {e.sourceSurface
                        ? ` · ${humanizeMemorySurface(e.sourceSurface)}`
                        : ''}
                    </span>
                    <span className="wc-list__sub">{e.text}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            !error && (
              <p className="wc-muted wc-small">
                No project memories yet — save a page on the Page tab, or add a
                note above.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}
