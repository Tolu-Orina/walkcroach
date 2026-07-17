import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const TOUR_KEY = 'walkcroach.coach-tour.v1';

type TourStep = {
  target: string;
  title: string;
  body: string;
};

const STEPS: TourStep[] = [
  {
    target: '[data-wc-tour="plan-mode"]',
    title: 'Plan vs Build',
    body: 'Plan without writing files. Build when you want the agent to edit your project.',
  },
  {
    target: '[data-wc-tour="prompt"]',
    title: 'Your prompt',
    body: 'Describe changes or use the example chips. Memory from past sessions is recalled automatically.',
  },
  {
    target: '[data-wc-tour="preview"]',
    title: 'Live preview',
    body: 'Your app runs in WebContainer. Click elements in the preview to scope edits.',
  },
  {
    target: '[data-wc-tour="deploy-cta"]',
    title: 'Deploy from the header',
    body: 'Ship your app in one click. Status and logs stay in the Ship tab.',
  },
  {
    target: '[data-wc-tour="ship-tools"]',
    title: 'Ship your app',
    body: 'Connect GitHub, manage your subdomain, and review deploy history in the Ship tab.',
  },
];

type Rect = { top: number; left: number; width: number; height: number };

function measureTarget(selector: string): Rect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function CoachMarkTour() {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (localStorage.getItem(TOUR_KEY)) return;
    const timer = window.setTimeout(() => setStep(0), 600);
    return () => window.clearTimeout(timer);
  }, []);

  const updateRect = useCallback(() => {
    if (step === null) return;
    const current = STEPS[step];
    if (!current) return;
    setRect(measureTarget(current.target));
  }, [step]);

  useLayoutEffect(() => {
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [updateRect]);

  if (step === null) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  const finish = () => {
    localStorage.setItem(TOUR_KEY, '1');
    setStep(null);
  };

  const pad = 8;
  const spotlight = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 bg-ink/70" aria-hidden />
      {spotlight && (
        <div
          className="absolute rounded-sm ring-2 ring-signal shadow-[0_0_0_9999px_rgba(12,18,16,0.72)]"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
          }}
        />
      )}
      <div
        className="pointer-events-auto absolute max-w-sm rounded-sm border border-signal/40 bg-panel p-4 shadow-xl"
        style={{
          top: spotlight
            ? Math.min(spotlight.top + spotlight.height + 12, window.innerHeight - 200)
            : 'auto',
          left: spotlight ? Math.min(spotlight.left, window.innerWidth - 320) : 16,
          bottom: spotlight ? undefined : 16,
        }}
        role="dialog"
        aria-labelledby="coach-tour-title"
      >
        <p className="text-[10px] uppercase tracking-wider text-signal">
          Tour · {step + 1}/{STEPS.length}
        </p>
        <h3 id="coach-tour-title" className="mt-2 font-display text-lg font-bold text-paper">
          {current.title}
        </h3>
        <p className="mt-1 text-sm text-mist">{current.body}</p>
        {!rect && (
          <p className="mt-2 text-[11px] text-mist/80">
            Tip: widen the window if you do not see the highlighted control.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={finish} className="btn-ghost text-[11px]">
            Skip
          </button>
          <button
            type="button"
            onClick={() => (isLast ? finish() : setStep(step + 1))}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
