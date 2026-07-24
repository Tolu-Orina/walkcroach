import { useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

type NewProjectDialogProps = {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
};

/** Name-only create — Projects are knowledge containers, not app scaffolds. */
export function NewProjectDialog({
  open,
  creating,
  onClose,
  onCreate,
}: NewProjectDialogProps) {
  const [name, setName] = useState('Untitled project');
  const inputRef = useRef<HTMLInputElement>(null);

  useEscapeKey(open && !creating, onClose);

  useEffect(() => {
    if (!open) return;
    setName('Untitled project');
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    onCreate(trimmed.slice(0, 200));
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4"
      onClick={() => {
        if (!creating) onClose();
      }}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-sm border border-line bg-panel p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="new-project-title"
          className="font-display text-2xl font-bold text-paper"
        >
          New project
        </h2>
        <p className="mt-1 text-sm text-mist">
          A place for chats, documents, and standing instructions. App starters
          come later in Builder.
        </p>
        <label className="mt-5 block">
          <span className="text-[11px] uppercase tracking-wider text-mist">
            Name
          </span>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            disabled={creating}
            className="mt-1 w-full rounded-sm border border-line bg-ink/40 px-3 py-2 text-sm text-paper focus:border-signal/50 focus:outline-none"
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="btn-ghost text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={creating || !name.trim()}
            className="btn-primary text-sm"
          >
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
