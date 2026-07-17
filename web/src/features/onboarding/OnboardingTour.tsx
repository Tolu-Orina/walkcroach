import { useEffect, useState } from 'react';

const TOUR_KEY = 'walkcroach.tour.v1';

const STEPS = [
  {
    title: 'Plan vs Build',
    body: 'Plan mode reasons without writing files. Build mode edits your WebContainer project.',
  },
  {
    title: 'Memory',
    body: 'Preferences you state are stored in CockroachDB and recalled on later turns.',
  },
  {
    title: 'Preview',
    body: 'The right pane runs Vite in-browser. First install can take a minute.',
  },
  {
    title: 'Prompt chips',
    body: 'Use example prompts to kick off, or describe your own idea in the box below.',
  },
] as const;

export function OnboardingTour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (localStorage.getItem(TOUR_KEY)) return;
    setStep(0);
  }, []);

  if (step === null) return null;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  const finish = () => {
    localStorage.setItem(TOUR_KEY, '1');
    setStep(null);
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div className="pointer-events-auto absolute bottom-4 left-4 max-w-sm rounded-sm border border-signal/40 bg-panel p-4 shadow-lg">
        <p className="text-[10px] uppercase tracking-wider text-signal">
          Tour · {step + 1}/{STEPS.length}
        </p>
        <h3 className="mt-2 font-display text-lg font-bold text-paper">{current.title}</h3>
        <p className="mt-1 text-sm text-mist">{current.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="text-[11px] text-mist hover:text-paper"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => (isLast ? finish() : setStep(step + 1))}
            className="rounded-sm bg-signal px-3 py-1.5 text-xs font-medium text-ink"
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
