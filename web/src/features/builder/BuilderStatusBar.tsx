import { ActivityChips } from './ActivityChips';

type BuilderStatusBarProps = {
  sessionId: string | null;
  activityRefresh: number;
  runtimeLabel: string;
  previewReady: boolean;
  streaming: boolean;
  terminalOpen: boolean;
  terminalUnread: number;
  onToggleTerminal: () => void;
};

/**
 * Bottom Builder chrome — activity chips + Terminal.
 * Files lives next to Preview in the preview pane header.
 */
export function BuilderStatusBar({
  sessionId,
  activityRefresh,
  runtimeLabel,
  previewReady,
  streaming,
  terminalOpen,
  terminalUnread,
  onToggleTerminal,
}: BuilderStatusBarProps) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-panel/90 px-3 py-1.5 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            streaming
              ? 'animate-pulse bg-signal'
              : previewReady
                ? 'bg-teal'
                : 'bg-mist/50'
          }`}
          aria-hidden
        />
        <ActivityChips
          sessionId={sessionId}
          refreshKey={activityRefresh}
          streaming={streaming}
        />
      </div>

      <p className="hidden text-[11px] text-mist sm:block">{runtimeLabel}</p>

      <button
        type="button"
        onClick={onToggleTerminal}
        aria-pressed={terminalOpen}
        className={`interactive relative rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
          terminalOpen
            ? 'border-signal/50 bg-signal/15 text-signal'
            : 'border-line text-mist hover:text-paper'
        }`}
      >
        Terminal
        {!terminalOpen && terminalUnread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 text-[9px] font-bold text-ink">
            {terminalUnread > 9 ? '9+' : terminalUnread}
          </span>
        )}
      </button>
    </footer>
  );
}
