import { useCallback, useEffect, useState } from 'react';
import { getSessionActivity } from '../../api/client';
import type { ActivityEvent } from '../../api/types';
import { activityChipLabel } from '../../lib/builderCopy';

type ActivityChipsProps = {
  sessionId: string | null;
  refreshKey?: number;
  /** Max chips shown in the status bar. */
  limit?: number;
};

/**
 * Compact plain-language activity chips for the Builder status bar.
 * Replaces the always-on mono activity dump in the agent pane.
 */
export function ActivityChips({
  sessionId,
  refreshKey = 0,
  limit = 4,
}: ActivityChipsProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const load = useCallback(async () => {
    if (!sessionId) {
      setEvents([]);
      return;
    }
    try {
      const list = await getSessionActivity(sessionId);
      setEvents(list);
    } catch {
      setEvents([]);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!sessionId) {
    return (
      <p className="truncate text-[11px] text-mist">Ready when you are</p>
    );
  }

  if (events.length === 0) {
    return (
      <p className="truncate text-[11px] text-mist">No build steps yet</p>
    );
  }

  const recent = events.slice(0, limit);

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {recent.map((e) => (
        <span
          key={e.id}
          title={e.summary ?? e.tool}
          className="inline-flex max-w-[14rem] truncate rounded-[var(--radius-control)] border border-line bg-raised/70 px-2 py-0.5 text-[11px] text-paper"
        >
          {activityChipLabel(e)}
        </span>
      ))}
      {events.length > limit && (
        <span className="text-[11px] text-mist">+{events.length - limit}</span>
      )}
    </div>
  );
}
