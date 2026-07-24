import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Glass } from '../../components/Glass';
import { Reveal } from '../../components/Reveal';
import { easeOutExpo } from '../../lib/motion';

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
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => {
      setActive((v) => (v + 1) % SESSIONS.length);
    }, 4800);
    return () => window.clearInterval(id);
  }, [reduce]);

  return (
    <section className="relative border-y border-line/60 px-4 py-16 sm:px-5 lg:py-20">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(61,155,143,0.08),transparent_65%)]" />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <Reveal className="min-w-0">
          <p className="eyebrow">Memory recall</p>
          <h2 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-paper md:text-3xl">
            See what you decided — without asking again.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-mist md:text-base">
            Vector memory surfaces past preferences on every turn. The agent
            continues where you left off.
          </p>

          <div className="mt-8 space-y-3">
            {SESSIONS.map((session, index) => {
              const isActive = index === active;
              return (
                <button
                  key={session.label}
                  type="button"
                  onClick={() => setActive(index)}
                  className="w-full text-left"
                >
                  <Glass
                    strong={isActive}
                    hairline={isActive}
                    className={`p-4 transition duration-300 ${
                      isActive
                        ? 'border-teal/40'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-wider text-teal">
                      {session.label}
                    </p>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={`${session.label}-${isActive}`}
                        initial={reduce ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? undefined : { opacity: 0, y: -4 }}
                        transition={{ duration: 0.35, ease: easeOutExpo }}
                        className="mt-3 space-y-2.5 text-sm"
                      >
                        <div className="rounded-[var(--radius-control)] border border-line/80 bg-ink/40 px-3.5 py-2.5 text-paper">
                          <span className="text-mist">You · </span>
                          {session.user}
                        </div>
                        {'memory' in session && isActive && (
                          <div className="rounded-[var(--radius-control)] border border-signal/25 bg-signal/10 px-3.5 py-2.5 text-paper">
                            <span className="text-signal">Memory · </span>
                            {session.memory}
                          </div>
                        )}
                        {'recall' in session && isActive && (
                          <div className="rounded-[var(--radius-control)] border border-teal/30 bg-teal/10 px-3.5 py-2.5 text-paper">
                            <span className="text-teal">Recall · </span>
                            {session.recall}
                          </div>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </Glass>
                </button>
              );
            })}
          </div>
        </Reveal>

        <Reveal className="relative mx-auto w-full max-w-md lg:max-w-none">
          <Glass hairline className="overflow-hidden p-2">
            <motion.img
              src="/marketing/landing-memory-glass.png"
              alt="Frosted glass panel suggesting recalled conversation context"
              className="aspect-square w-full rounded-[calc(var(--radius-surface)-4px)] object-cover"
              width={1024}
              height={1024}
              loading="lazy"
              whileHover={reduce ? undefined : { scale: 1.02 }}
              transition={{ duration: 0.5, ease: easeOutExpo }}
            />
          </Glass>
          <div className="pointer-events-none absolute -bottom-6 -left-6 h-28 w-28 rounded-full bg-teal/20 blur-2xl" />
        </Reveal>
      </div>
    </section>
  );
}
