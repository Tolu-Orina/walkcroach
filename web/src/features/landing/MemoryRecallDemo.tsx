import { useEffect, useState } from 'react';

const SESSIONS = [
  {
    label: 'Session 1',
    user: 'Build a landing page — muted tones, no salesy copy.',
    memory: 'Preference saved: muted palette, direct tone',
  },
  {
    label: 'Session 2 (next day)',
    user: 'Add a pricing section.',
    recall: 'Recalled: muted palette · direct tone — applied without re-asking.',
  },
] as const;

export function MemoryRecallDemo() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActive((v) => (v + 1) % SESSIONS.length);
    }, 4500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="border-y border-line bg-panel/30 px-6 py-14 lg:px-10">
      <div className="w-full">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-signal">Memory recall</p>
          <h2 className="mt-2 font-display text-2xl font-bold text-paper md:text-3xl">
            See what you decided — without asking again.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-mist">
            Vector memory in CockroachDB surfaces past preferences on every turn. The agent
            picks up where you left off, not where a stateless chat would reset.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {SESSIONS.map((session, index) => {
            const isActive = index === active;
            return (
              <article
                key={session.label}
                className={`rounded-sm border p-5 transition ${
                  isActive
                    ? 'border-signal/50 bg-panel/80 shadow-lg shadow-signal/5'
                    : 'border-line bg-ink/30 opacity-80'
                }`}
                aria-hidden={!isActive}
              >
                <p className="text-[10px] uppercase tracking-wider text-signal">{session.label}</p>
                <div className="mt-4 space-y-3 font-mono text-xs">
                  <div className="rounded-sm border border-line bg-ink/50 px-3 py-2 text-paper">
                    <span className="text-mist">You · </span>
                    {session.user}
                  </div>
                  {'memory' in session && (
                    <div className="rounded-sm border border-signal/30 bg-signal/10 px-3 py-2 text-paper">
                      <span className="text-signal">Memory · </span>
                      {session.memory}
                    </div>
                  )}
                  {'recall' in session && (
                    <div className="rounded-sm border border-signal/30 bg-signal/10 px-3 py-2 text-paper">
                      <span className="text-signal">Recall · </span>
                      {session.recall}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
