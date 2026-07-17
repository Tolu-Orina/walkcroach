import { useCallback, useEffect, useState, type ReactNode } from 'react';

type ResizableSplitPaneProps = {
  left: ReactNode;
  right: ReactNode;
  storageKey?: string;
  defaultLeftPercent?: number;
  minLeftPx?: number;
  minRightPx?: number;
};

const DEFAULT_KEY = 'walkcroach.builder.split.v1';

export function ResizableSplitPane({
  left,
  right,
  storageKey = DEFAULT_KEY,
  defaultLeftPercent = 42,
  minLeftPx = 280,
  minRightPx = 320,
}: ResizableSplitPaneProps) {
  const [leftPercent, setLeftPercent] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    const n = stored ? Number(stored) : defaultLeftPercent;
    return Number.isFinite(n) ? Math.min(70, Math.max(25, n)) : defaultLeftPercent;
  });
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const container = document.getElementById('builder-split-root');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const minLeft = (minLeftPx / rect.width) * 100;
      const maxLeft = 100 - (minRightPx / rect.width) * 100;
      const pct = Math.min(maxLeft, Math.max(minLeft, (x / rect.width) * 100));
      setLeftPercent(pct);
    };

    const onUp = () => {
      setDragging(false);
      localStorage.setItem(storageKey, String(leftPercent));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, leftPercent, minLeftPx, minRightPx, storageKey]);

  useEffect(() => {
    if (!dragging) {
      localStorage.setItem(storageKey, String(leftPercent));
    }
  }, [dragging, leftPercent, storageKey]);

  return (
    <div
      id="builder-split-root"
      className={`flex min-h-0 flex-1 flex-col lg:flex-row ${dragging ? 'select-none' : ''}`}
    >
      <div
        className="flex min-h-0 min-w-0 flex-col border-b border-line lg:border-b-0 lg:border-r"
        style={{ flex: `0 0 ${leftPercent}%` }}
      >
        {left}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        onPointerDown={onPointerDown}
        className={`hidden w-1.5 shrink-0 cursor-col-resize items-stretch justify-center bg-line/40 hover:bg-signal/40 lg:flex ${
          dragging ? 'bg-signal/50' : ''
        }`}
      >
        <div className="my-auto h-10 w-0.5 rounded-full bg-mist/50" />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{right}</div>
    </div>
  );
}
