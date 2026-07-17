import { useCallback } from 'react';
import { TEMPLATES } from '../../templates';
import { useEscapeKey } from '../../hooks/useEscapeKey';

type TemplateGalleryProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (templateId: string, name: string) => void;
  creating: boolean;
};

export function TemplateGallery({
  open,
  onClose,
  onSelect,
  creating,
}: TemplateGalleryProps) {
  const handleClose = useCallback(() => {
    if (!creating) onClose();
  }, [creating, onClose]);

  useEscapeKey(open, handleClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-sm border border-line bg-panel p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-gallery-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="template-gallery-title" className="font-display text-2xl font-bold text-paper">
              Choose a template
            </h2>
            <p className="mt-1 text-sm text-mist">
              Curated starters mount in WebContainer — target under 8s to preview.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={creating}
            className="btn-ghost text-sm"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={creating}
              onClick={() => onSelect(t.id, t.name)}
              className="interactive rounded-sm border border-line bg-ink/40 p-4 text-left transition hover:border-signal/40 disabled:opacity-50"
            >
              <p className="font-medium text-paper">{t.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-mist">{t.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
