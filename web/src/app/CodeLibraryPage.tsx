import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listCodeArtefacts,
  type CodeArtefactSummary,
} from '../api/client';
import { ProductErrorBanner } from '../components/product/ProductErrorBanner';

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

export function CodeLibraryPage() {
  const [artefacts, setArtefacts] = useState<CodeArtefactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'builder' | 'chat'>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listCodeArtefacts();
        if (!cancelled) setArtefacts(rows);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (filter === 'all') return artefacts;
    return artefacts.filter((a) => a.source === filter);
  }, [artefacts, filter]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <p className="eyebrow">Library</p>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-paper">
        Code
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist">
        Artefacts from Chat (“Save as code”) and App Builder file sync.
      </p>

      <div className="mt-6 flex flex-wrap gap-1.5">
        {(
          [
            ['all', 'All'],
            ['builder', 'App Builder'],
            ['chat', 'Chat'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`interactive rounded-[var(--radius-control)] border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
              filter === id
                ? 'border-signal/40 bg-signal/15 text-signal'
                : 'border-line text-mist hover:text-paper'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="mt-8 text-sm text-mist">Loading artefacts…</p>
      )}
      {error && (
        <div className="mt-8">
          <ProductErrorBanner
            message={error}
            onRetry={() => window.location.reload()}
          />
        </div>
      )}
      {!loading && !error && visible.length === 0 && (
        <div className="surface mt-8 border-dashed p-8 text-center">
          <p className="font-display text-base font-bold text-paper">
            No artefacts yet
          </p>
          <p className="mt-2 text-sm text-mist">
            Files sync from App Builder automatically, or save a code block from
            Chat.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link to="/app/builder" className="btn-secondary text-xs">
              Open App Builder
            </Link>
            <Link to="/app/chat" className="btn-ghost text-xs">
              Open Chat
            </Link>
          </div>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-panel/60">
          {visible.map((a) => (
            <li key={a.id}>
              <Link
                to={`/app/code/${a.id}`}
                className="interactive flex items-start justify-between gap-4 px-4 py-3.5 hover:bg-raised/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-paper">
                    {fileName(a.path)}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-mist">
                    {a.path}
                    {a.projectName ? ` · ${a.projectName}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="inline-flex rounded-[var(--radius-control)] bg-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-mist">
                    {a.source}
                  </span>
                  <p className="mt-1 text-[11px] text-mist/80">
                    {a.language ?? 'file'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
