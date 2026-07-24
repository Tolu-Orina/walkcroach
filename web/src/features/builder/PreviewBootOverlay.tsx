import { useEffect, useState } from 'react';
import type { WcBootPhase } from '../../hooks/useWebContainer';
import type { BuilderRuntimeKind } from '../../hooks/useBuilderSandbox';

const TIPS = [
  'Terminal stays closed until you need it — open it from the status bar.',
  'Use Code to browse or lightly edit files without leaving the Builder.',
  'Plan mode sketches architecture before any file writes.',
  'Your project instructions and docs stay available to the agent.',
  'Deploy from Ship when you are ready to share a live URL.',
] as const;

type PreviewBootOverlayProps = {
  phase: WcBootPhase;
  runtime?: BuilderRuntimeKind;
};

const PHASE_LABEL_E2B: Record<WcBootPhase, string> = {
  container: 'Starting cloud sandbox…',
  mount: 'Preparing project workspace…',
  preview: 'Starting app preview…',
  ready: 'Ready',
};

const PHASE_LABEL_WC: Record<WcBootPhase, string> = {
  container: 'Starting local preview…',
  mount: 'Mounting project template…',
  preview: 'Installing packages & starting Vite…',
  ready: 'Ready',
};

export function PreviewBootOverlay({
  phase,
  runtime = 'webcontainer',
}: PreviewBootOverlayProps) {
  const [tipIndex, setTipIndex] = useState(0);
  const labels = runtime === 'e2b' ? PHASE_LABEL_E2B : PHASE_LABEL_WC;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, []);

  if (phase === 'ready') return null;

  const progress =
    phase === 'container' ? 25 : phase === 'mount' ? 55 : phase === 'preview' ? 85 : 0;

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-ink/90 p-6 text-center">
      <img
        src="/walkcroach-icon.png"
        alt=""
        className="mb-4 h-10 w-10 animate-pulse rounded-sm opacity-90"
        width={40}
        height={40}
      />
      <p className="font-display text-sm font-medium text-paper">{labels[phase]}</p>
      <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-line">
        <div
          className="h-full bg-signal transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-6 max-w-xs text-xs leading-relaxed text-mist">{TIPS[tipIndex]}</p>
    </div>
  );
}
