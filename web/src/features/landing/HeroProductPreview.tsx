import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

type Surface = 'Chrome' | 'CLI' | 'IDE' | 'Web' | 'Memory';

type Beat = {
  id: string;
  surface: Surface;
  side: 'user' | 'agent' | 'system';
  text: string;
  /** ms to wait after this beat appears before revealing the next */
  holdMs: number;
};

/**
 * Scripted cross-surface memory loop. Reads like a GIF; implemented with
 * state + AnimatePresence so we can pause on reduced motion and keep copy editable.
 */
const SCRIPT: Beat[] = [
  {
    id: '1',
    surface: 'Chrome',
    side: 'user',
    text: 'What did we decide about SSO for Acme?',
    holdMs: 1100,
  },
  {
    id: '2',
    surface: 'Memory',
    side: 'system',
    text: 'Recall · docs.acme.com/sso — Okta SAML, SCIM deferred',
    holdMs: 1000,
  },
  {
    id: '3',
    surface: 'CLI',
    side: 'agent',
    text: 'Okta as IdP, SAML now, SCIM later — pulled from project memory.',
    holdMs: 1400,
  },
  {
    id: '4',
    surface: 'Web',
    side: 'user',
    text: 'Continue the SSO route in App Builder.',
    holdMs: 1100,
  },
  {
    id: '5',
    surface: 'Web',
    side: 'agent',
    text: 'Scaffolding SamlProvider from the same graph the Extension saved.',
    holdMs: 1400,
  },
  {
    id: '6',
    surface: 'IDE',
    side: 'agent',
    text: '// remembered from Web + Extension — continuing auth scaffold',
    holdMs: 1800,
  },
];

const SURFACES: Surface[] = ['Chrome', 'CLI', 'IDE', 'Web'];

const MAX_VISIBLE = 4;

/**
 * Live shared-memory card for the hero. Messages arrive in sequence and the
 * active surface chip tracks wherever the latest beat came from.
 */
export function HeroProductPreview() {
  const reduce = useReducedMotion();
  const [cursor, setCursor] = useState(reduce ? SCRIPT.length - 1 : 0);
  const [loop, setLoop] = useState(0);

  useEffect(() => {
    if (reduce) return;

    const beat = SCRIPT[cursor];
    const delay = beat?.holdMs ?? 1200;
    const t = window.setTimeout(() => {
      if (cursor >= SCRIPT.length - 1) {
        setLoop((n) => n + 1);
        setCursor(0);
      } else {
        setCursor(cursor + 1);
      }
    }, delay);
    return () => window.clearTimeout(t);
  }, [cursor, reduce]);

  const start = Math.max(0, cursor - (MAX_VISIBLE - 1));
  const visible = SCRIPT.slice(start, cursor + 1);
  const activeSurface = SCRIPT[cursor]?.surface ?? 'Memory';

  return (
    <div
      className="overflow-hidden rounded-[var(--lp-radius)] border border-[var(--lp-line)] bg-[var(--lp-panel)] shadow-[var(--lp-shadow)]"
      aria-label="Shared memory across surfaces, animated preview"
    >
      <div className="flex items-center gap-2 border-b border-[var(--lp-line)] bg-[var(--lp-canvas)] px-3 py-2 sm:px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-[#f07167]/80" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[#f0b429]/80" aria-hidden />
        <span
          className="h-2.5 w-2.5 rounded-full bg-[var(--lp-accent-bright)]"
          aria-hidden
        />
        <p className="ml-2 truncate text-xs font-bold text-[var(--lp-ink)]">
          Shared memory
        </p>
        <span className="ml-auto hidden font-mono text-[10px] font-semibold text-[var(--lp-muted)] sm:inline">
          live
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-[var(--lp-line)] px-3 py-2 sm:px-4">
        {SURFACES.map((s) => {
          const on = activeSurface === s;
          return (
            <span
              key={s}
              className={clsx(
                'rounded-[var(--lp-radius-control)] px-2.5 py-1 text-[10px] font-bold transition-colors duration-300',
                on
                  ? 'bg-[var(--lp-accent-bright)] text-[var(--lp-on-accent)]'
                  : 'bg-[var(--lp-canvas)] text-[var(--lp-muted)] ring-1 ring-[var(--lp-line)]',
              )}
            >
              {s}
            </span>
          );
        })}
        <span
          className={clsx(
            'rounded-[var(--lp-radius-control)] px-2.5 py-1 text-[10px] font-bold transition-colors duration-300',
            activeSurface === 'Memory'
              ? 'bg-[var(--lp-accent-soft)] text-[var(--lp-accent)] ring-1 ring-[var(--lp-accent-bright)]'
              : 'bg-[var(--lp-canvas)] text-[var(--lp-muted)] ring-1 ring-[var(--lp-line)]',
          )}
        >
          Memory
        </span>
      </div>

      <div className="relative aspect-[16/10] overflow-hidden bg-[var(--lp-canvas)]">
        <div className="absolute inset-0 flex flex-col gap-2.5 overflow-hidden p-3 sm:p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--lp-muted)]">
            Acme onboarding · one graph
          </p>
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5">
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((beat) => (
                <motion.div
                  key={`${loop}-${beat.id}`}
                  layout
                  initial={reduce ? false : { opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                >
                  <LiveBubble beat={beat} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {!reduce && (
            <div className="flex items-center gap-1.5 pt-1" aria-hidden>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--lp-accent-bright)]" />
              <span className="text-[10px] font-medium text-[var(--lp-muted)]">
                Streaming across surfaces…
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveBubble({ beat }: { beat: Beat }) {
  if (beat.side === 'system') {
    return (
      <div className="mx-auto max-w-[95%] rounded-[var(--lp-radius-control)] border border-dashed border-[var(--lp-accent-bright)] bg-[var(--lp-accent-soft)] px-2.5 py-2 text-center">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--lp-accent)]">
          {beat.surface}
        </p>
        <p className="mt-0.5 text-[11px] font-medium leading-snug text-[var(--lp-ink)] sm:text-xs">
          {beat.text}
        </p>
      </div>
    );
  }

  const isUser = beat.side === 'user';
  return (
    <div
      className={clsx(
        'flex max-w-[94%] flex-col gap-1',
        isUser ? 'ml-auto items-end' : 'items-start',
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--lp-muted)]">
        {beat.surface}
        <span aria-hidden> · </span>
        {isUser ? 'you' : 'WalkCroach'}
      </span>
      <div
        className={clsx(
          'rounded-[var(--lp-radius-control)] px-2.5 py-2 text-[11px] leading-snug sm:text-xs',
          isUser
            ? 'bg-[var(--lp-accent-bright)] font-medium text-[var(--lp-on-accent)]'
            : 'bg-[var(--lp-panel)] font-medium text-[var(--lp-ink)] ring-1 ring-[var(--lp-line)]',
        )}
      >
        {beat.text}
      </div>
    </div>
  );
}
