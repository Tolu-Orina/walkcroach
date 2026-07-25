type MemoryRecall = {
  kind: string;
  text: string;
  sourceSurface?: string;
};

/** Renders enriched memory_recalled hits as a chat card. */
export function MemoryRecallCard({ hits }: { hits: MemoryRecall[] }) {
  if (hits.length === 0) return null;
  return (
    <div className="rounded-sm border border-signal/25 bg-signal/5 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-signal">
        Remembered · CockroachDB
      </p>
      <ul className="mt-2 space-y-2">
        {hits.map((h, i) => (
          <li key={`${h.kind}-${i}`} className="border-l-2 border-signal/40 pl-2">
            <span className="text-[10px] uppercase tracking-wider text-mist">
              {h.kind}
              {h.sourceSurface ? ` · ${h.sourceSurface}` : ''}
            </span>
            <p className="mt-0.5 text-sm leading-snug text-paper/90">{h.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
