import { useEffect, useState } from 'react';
import type { WcBootPhase } from '../../hooks/useWebContainer';

const TIPS = [
  'First boot downloads Node into your browser — it only happens once per device.',
  'Templates mount in seconds; the agent can customize from there.',
  'Your preferences are stored in CockroachDB and recalled on later sessions.',
  'Use Plan mode to sketch architecture before any file writes.',
  'Deploy from the Ship tab when you are ready to share a live URL.',
] as const;

type PreviewBootOverlayProps = {
  phase: WcBootPhase;
};

const PHASE_LABEL: Record<WcBootPhase, string> = {
  container: 'Starting WebContainer…',
  mount: 'Mounting project template…',
  preview: 'Running npm install & Vite…',
  ready: 'Ready',
};

export function PreviewBootOverlay({ phase }: PreviewBootOverlayProps) {
  const [tipIndex, setTipIndex] = useState(0);

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
      <p className="font-display text-sm font-medium text-paper">{PHASE_LABEL[phase]}</p>
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
