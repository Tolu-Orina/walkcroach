import { useCallback, useEffect, useState } from 'react';
import { listProjectMemory } from '../../api/client';
import type { ProjectMemoryEntry } from '../../api/types';

type BuilderMemoryStripProps = {
  projectId: string;
  /** Bumps when agent recalls — refreshes the strip. */
  refreshKey?: number;
};

/**
 * Thin Builder strip: durable project memories (not just the in-turn recall card).
 */
export function BuilderMemoryStrip({
  projectId,
  refreshKey = 0,
}: BuilderMemoryStripProps) {
  const [entries, setEntries] = useState<ProjectMemoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const mem = await listProjectMemory(projectId);
      setEntries((mem.entries ?? []).slice(0, 8));
      setError(null);
    } catch (err) {
      setEntries([]);
      setError(err instanceof Error ? err.message : 'Memory unavailable');
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load, refreshKey]);

  if (!loaded) return null;

  if (error) {
    return (
      <div className="border-b border-line px-4 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ember">
            Project memory unavailable
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-ghost text-[10px]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (entries.length === 0) return null;

  return (
    <div className="border-b border-line px-4 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-[10px] uppercase tracking-wider text-signal">
          Project memory · {entries.length}
        </span>
        <span className="text-[10px] text-mist">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="mt-2 max-h-36 space-y-1.5 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.id} className="text-[11px] leading-snug text-mist">
              <span className="uppercase tracking-wider text-signal/80">
                {e.kind}
              </span>
              {' — '}
              <span className="text-paper/80">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
