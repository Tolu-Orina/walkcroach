import { useEffect, useState } from 'react';
import type { WcElementSelection } from './types';

type ElementToolbarProps = {
  selection: WcElementSelection | null;
  remainingEdits: number;
  busy: boolean;
  onSaveText: (newText: string) => void;
  onAskAbout: (prompt: string) => void;
  onClose: () => void;
};

export function ElementToolbar({
  selection,
  remainingEdits,
  busy,
  onSaveText,
  onAskAbout,
  onClose,
}: ElementToolbarProps) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(selection?.text ?? '');
  }, [selection]);

  if (!selection) return null;

  return (
    <div className="absolute left-3 right-3 top-3 z-20 rounded-sm border border-signal/40 bg-ink/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-signal">Visual edit</p>
          <p className="truncate font-mono text-[10px] text-mist">{selection.path}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-mist hover:text-paper"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <textarea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="mt-2 w-full resize-none rounded-sm border border-line bg-ink/60 px-2 py-1.5 text-sm text-paper outline-none focus:border-signal/50"
        disabled={busy}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !draft.trim() || remainingEdits <= 0}
          onClick={() => onSaveText(draft.trim())}
          className="rounded-sm bg-signal px-3 py-1 text-[11px] font-medium text-ink disabled:opacity-40"
        >
          Save text
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onAskAbout(
              `Update the element at ${selection.path} (${selection.tagName}). Current text: "${selection.text}".`,
            )
          }
          className="rounded-sm border border-line px-3 py-1 text-[11px] text-mist hover:border-signal/40 hover:text-paper disabled:opacity-40"
        >
          Ask about element
        </button>
        <span className="text-[10px] text-mist">{remainingEdits} inline edits left today</span>
      </div>
    </div>
  );
}
