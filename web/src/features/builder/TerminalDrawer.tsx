type TerminalDrawerProps = {
  open: boolean;
  onToggle: () => void;
  logs: string[];
  unread: number;
};

/**
 * Terminal drawer — collapsed by default (Metaphor A).
 * Badge shows unread lines while closed.
 */
export function TerminalDrawer({
  open,
  onToggle,
  logs,
  unread,
}: TerminalDrawerProps) {
  return (
    <div className="shrink-0 border-t border-line bg-ink/80">
      <button
        type="button"
        onClick={onToggle}
        className="interactive flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-mist hover:text-paper"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          Terminal
          {!open && unread > 0 && (
            <span className="rounded-sm bg-signal/20 px-1.5 py-0.5 text-[10px] font-bold normal-case tracking-normal text-signal">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
        <span className="normal-case tracking-normal text-mist/80">
          {open ? 'Collapse' : 'Expand'}
        </span>
      </button>
      {open && (
        <div
          className="max-h-44 overflow-y-auto border-t border-line px-3 py-2 font-mono text-[10px] leading-relaxed text-mist"
          role="log"
          aria-label="Terminal output"
        >
          {logs.length === 0 ? (
            <span>No terminal output yet</span>
          ) : (
            logs.slice(-80).map((line, i) => (
              <div
                key={`${i}-${line.slice(0, 16)}`}
                className="whitespace-pre-wrap"
              >
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
