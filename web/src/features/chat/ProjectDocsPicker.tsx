import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  getProjectDocument,
  listProjectDocuments,
  type ProjectDocumentDetail,
} from '../../api/client';
import type { ProjectDocument } from '../../api/types';
import type { ChatAttachment } from './attachTypes';
import { MAX_ATTACH_COUNT } from './attachTypes';

type Props = {
  projectId: string;
  open: boolean;
  remainingSlots: number;
  onClose: () => void;
  onAttach: (attachments: ChatAttachment[]) => void;
  onError: (message: string) => void;
};

/**
 * Modal to attach standing project documents into the chat composer.
 */
export function ProjectDocsPicker({
  projectId,
  open,
  remainingSlots,
  onClose,
  onAttach,
  onError,
}: Props) {
  const titleId = useId();
  const [docs, setDocs] = useState<ProjectDocument[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setLoadError(null);
    setLoading(true);
    let cancelled = false;
    void listProjectDocuments(projectId)
      .then((list) => {
        if (!cancelled) setDocs(list.filter((d) => d.hasText));
      })
      .catch((err) => {
        if (!cancelled) {
          setDocs([]);
          setLoadError(
            err instanceof Error ? err.message : 'Could not load project documents.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < remainingSlots) next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    if (selected.size === 0 || attaching) return;
    setAttaching(true);
    try {
      const attachments: ChatAttachment[] = [];
      for (const id of selected) {
        const detail: ProjectDocumentDetail = await getProjectDocument(
          projectId,
          id,
        );
        attachments.push({
          id: crypto.randomUUID(),
          name: detail.name,
          mime: detail.mime || 'text/plain',
          size: detail.byteSize || detail.textContent.length,
          textPreview: detail.textPreview || detail.textContent.slice(0, 20_000),
          contentText: detail.textContent.slice(0, 2_000_000),
          source: 'project',
          sourceId: detail.id,
        });
      }
      onAttach(attachments);
      onClose();
    } catch (err) {
      onError(
        err instanceof Error ? err.message : 'Could not attach project documents.',
      );
    } finally {
      setAttaching(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/50 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(32rem,85vh)] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line bg-panel shadow-[var(--shadow-soft)]"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id={titleId} className="font-display text-base font-bold text-paper">
            Project documents
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="btn-ghost text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <p className="px-2 py-6 text-center text-sm text-mist">
              Loading documents…
            </p>
          )}
          {!loading && loadError && (
            <p className="px-2 py-6 text-center text-sm text-ember">{loadError}</p>
          )}
          {!loading && !loadError && docs && docs.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-mist">
              No text documents in this project yet. Add one from the project home.
            </p>
          )}
          {!loading &&
            docs?.map((doc) => {
              const on = selected.has(doc.id);
              const blocked = !on && selected.size >= remainingSlots;
              return (
                <button
                  key={doc.id}
                  type="button"
                  disabled={blocked}
                  onClick={() => toggle(doc.id)}
                  className={clsx(
                    'interactive flex w-full items-start gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left',
                    on ? 'bg-signal/15' : 'hover:bg-raised',
                    blocked && 'opacity-40',
                  )}
                >
                  <span
                    className={clsx(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]',
                      on
                        ? 'border-signal bg-signal text-ink'
                        : 'border-line text-transparent',
                    )}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-paper">
                      {doc.name}
                    </span>
                    <span className="block text-[11px] text-mist">
                      {doc.mime}
                      {doc.byteSize ? ` · ${Math.max(1, Math.round(doc.byteSize / 1024))} KB` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <p className="text-[11px] text-mist">
            {remainingSlots < MAX_ATTACH_COUNT
              ? `${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} left`
              : `Up to ${MAX_ATTACH_COUNT} files`}
          </p>
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={selected.size === 0 || attaching}
            onClick={() => void confirm()}
          >
            {attaching ? 'Attaching…' : `Attach${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
