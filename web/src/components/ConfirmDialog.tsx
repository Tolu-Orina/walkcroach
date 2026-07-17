import { useEffect, useRef } from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="w-full max-w-md rounded-sm border border-line bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="font-display text-lg font-bold text-paper">
          {title}
        </h2>
        <p id="confirm-message" className="mt-2 text-sm text-mist">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary text-sm">
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              destructive
                ? 'interactive rounded-sm bg-ember px-4 py-2 text-sm font-medium text-paper disabled:opacity-50'
                : 'btn-primary text-sm'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type AlertDialogProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
};

export function AlertDialog({ open, title, message, onClose }: AlertDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-sm border border-line bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-paper">{title}</h2>
        <p className="mt-2 text-sm text-mist">{message}</p>
        <button type="button" onClick={onClose} className="btn-primary mt-4 w-full text-sm">
          OK
        </button>
      </div>
    </div>
  );
}
