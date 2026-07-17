import { useCallback, useEffect, useState } from 'react';
import { getSessionActivity } from '../../api/client';
import type { ActivityEvent } from '../../api/types';

type ActivityPanelProps = {
  sessionId: string | null;
  refreshKey?: number;
};

export function ActivityPanel({ sessionId, refreshKey = 0 }: ActivityPanelProps) {
  const [open, setOpen] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const list = await getSessionActivity(sessionId);
      setEvents(list);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!sessionId) return null;

  return (
    <div className="border-t border-line bg-ink/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-[11px] uppercase tracking-wider text-mist hover:text-paper"
      >
        <span>Activity</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="max-h-32 overflow-y-auto px-4 pb-3">
          {loading && <p className="text-[10px] text-mist">Loading…</p>}
          {!loading && events.length === 0 && (
            <p className="text-[10px] text-mist">No build events yet.</p>
          )}
          <ul className="space-y-1.5">
            {events.map((e) => (
              <li key={e.id} className="text-[10px] leading-relaxed text-mist">
                <span className="font-mono text-signal">{e.tool}</span>
                {e.summary ? ` · ${e.summary}` : ''}
                <span className="block text-mist/60">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
