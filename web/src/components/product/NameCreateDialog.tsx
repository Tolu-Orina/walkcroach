import { useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

type NameCreateDialogProps = {
  open: boolean;
  creating: boolean;
  title: string;
  description: string;
  defaultName: string;
  confirmLabel: string;
  creatingLabel?: string;
  nameLabel?: string;
  onClose: () => void;
  onCreate: (name: string) => void;
};

/** Shared name-only create dialog — Projects and App Builder hubs. */
export function NameCreateDialog({
  open,
  creating,
  title,
  description,
  defaultName,
  confirmLabel,
  creatingLabel = 'Creating…',
  nameLabel = 'Name',
  onClose,
  onCreate,
}: NameCreateDialogProps) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = 'name-create-dialog-title';

  useEscapeKey(open && !creating, onClose);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, defaultName]);

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
        className="w-full max-w-md rounded-[var(--radius-surface)] border border-line bg-panel p-6 shadow-[var(--shadow-soft)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-display text-2xl font-bold text-paper"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-mist">{description}</p>
        <label className="mt-5 block">
          <span className="text-xs font-medium text-mist">{nameLabel}</span>
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
            className="field mt-2"
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
            {creating ? creatingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
