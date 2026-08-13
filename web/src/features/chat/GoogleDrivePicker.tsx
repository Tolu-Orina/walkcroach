import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import {
  importGoogleDriveFiles,
  listGoogleDriveFiles,
  startConnectorOauth,
  type DriveBrowserItem,
  type DriveBrowserView,
  type DriveSharedDrive,
} from '../../api/client';
import type { ChatAttachment } from './attachTypes';
import { MAX_ATTACH_COUNT } from './attachTypes';

type Crumb = {
  label: string;
  folderId?: string;
  driveId?: string;
};

type Props = {
  open: boolean;
  remainingSlots: number;
  onClose: () => void;
  onAttach: (attachments: ChatAttachment[]) => void;
  onError: (message: string) => void;
};

const VIEWS: { id: DriveBrowserView; label: string }[] = [
  { id: 'my_drive', label: 'My Drive' },
  { id: 'shared', label: 'Shared with me' },
  { id: 'recent', label: 'Recent' },
  { id: 'shared_drives', label: 'Shared drives' },
];

function fileKind(mime: string, name: string): string {
  if (mime === 'application/vnd.google-apps.folder') return 'Folder';
  if (mime === 'application/vnd.google-apps.document') return 'Doc';
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'Sheet';
  if (mime === 'application/vnd.google-apps.presentation') return 'Slides';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'PDF';
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('text/') || /\.(md|txt|csv|json)$/i.test(name)) return 'Text';
  return 'File';
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4.2l1.6 1.8H18.5A1.5 1.5 0 0 1 20 9.3v7.2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFile() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M7 4.75h6.2L18 9.4V19.25H7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M13.2 4.75V9.4H18" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * In-app Drive chooser — same overlay pattern as project documents.
 * Google Picker is not used: it cannot match WalkCroach chrome and cannot
 * run under COEP without a separate browser window.
 */
export function GoogleDrivePicker({
  open,
  remainingSlots,
  onClose,
  onAttach,
  onError,
}: Props) {
  const titleId = useId();
  const searchId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<DriveBrowserView>('my_drive');
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ label: 'My Drive' }]);
  const [folderId, setFolderId] = useState<string | undefined>();
  const [driveId, setDriveId] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [items, setItems] = useState<DriveBrowserItem[]>([]);
  const [drives, setDrives] = useState<DriveSharedDrive[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [selected, setSelected] = useState<Map<string, DriveBrowserItem>>(
    new Map(),
  );
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(query.trim()), 280);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setView('my_drive');
    setCrumbs([{ label: 'My Drive' }]);
    setFolderId(undefined);
    setDriveId(undefined);
    setQuery('');
    setDebouncedQ('');
    setSelected(new Map());
    setNeedsReconnect(false);
    closeRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void listGoogleDriveFiles({
      view,
      folderId,
      driveId,
      q: debouncedQ || undefined,
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setDrives(page.drives ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code?: string }).code ?? '')
            : '';
        const status =
          err && typeof err === 'object' && 'status' in err
            ? Number((err as { status?: number }).status)
            : 0;
        if (code === 'not_connected' || status === 404) {
          void startConnectorOauth('google_drive', 'web').then(({ authorizeUrl }) => {
            window.location.assign(authorizeUrl);
          });
          return;
        }
        if (code === 'insufficient_scope' || status === 403) {
          setNeedsReconnect(true);
          setItems([]);
          setDrives([]);
          return;
        }
        setLoadError(
          err instanceof Error ? err.message : 'Could not load Google Drive.',
        );
        setItems([]);
        setDrives([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, view, folderId, driveId, debouncedQ]);

  const rows = useMemo((): Array<DriveBrowserItem & { isDrive: boolean }> => {
    if (view === 'shared_drives' && !driveId && !debouncedQ) {
      return drives.map((d) => ({
        id: d.id,
        name: d.name,
        mimeType: 'application/vnd.google-apps.folder',
        isFolder: true,
        isDrive: true,
      }));
    }
    return items.map((item) => ({ ...item, isDrive: false }));
  }, [view, driveId, debouncedQ, drives, items]);

  const switchView = (next: DriveBrowserView) => {
    setView(next);
    setFolderId(undefined);
    setDriveId(undefined);
    setCrumbs([{ label: VIEWS.find((v) => v.id === next)?.label ?? 'Drive' }]);
    setQuery('');
    setDebouncedQ('');
  };

  const openFolder = (item: { id: string; name: string; isDrive?: boolean }) => {
    if (item.isDrive) {
      setDriveId(item.id);
      setFolderId(undefined);
      setCrumbs((prev) => [...prev, { label: item.name, driveId: item.id }]);
      return;
    }
    setFolderId(item.id);
    setCrumbs((prev) => [
      ...prev,
      { label: item.name, folderId: item.id, driveId },
    ]);
  };

  const goCrumb = (index: number) => {
    const crumb = crumbs[index];
    if (!crumb) return;
    setCrumbs(crumbs.slice(0, index + 1));
    setFolderId(crumb.folderId);
    setDriveId(crumb.driveId);
  };

  const toggleFile = (item: DriveBrowserItem) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else if (next.size < remainingSlots) next.set(item.id, item);
      return next;
    });
  };

  const confirm = async () => {
    if (selected.size === 0 || attaching) return;
    setAttaching(true);
    try {
      const { attachments: imported } = await importGoogleDriveFiles([
        ...selected.keys(),
      ]);
      onAttach(
        imported.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          mime: a.mime,
          size: a.size,
          textPreview: a.textPreview,
          contentText: a.contentText,
          contentBase64: a.contentBase64,
          source: 'google_drive' as const,
          sourceId: a.sourceId,
        })),
      );
      onClose();
    } catch (err) {
      onError(
        err instanceof Error ? err.message : 'Could not attach from Google Drive.',
      );
    } finally {
      setAttaching(false);
    }
  };

  const reconnect = async () => {
    const { authorizeUrl } = await startConnectorOauth('google_drive', 'web');
    window.location.assign(authorizeUrl);
  };

  if (!open) return null;

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
        className="flex max-h-[min(36rem,88vh)] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-surface)] border border-line bg-panel shadow-[var(--shadow-soft)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="font-display text-base font-bold text-paper">
            Attach from Google Drive
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

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Drive locations"
            className="hidden w-40 shrink-0 flex-col gap-1 border-r border-line p-2 sm:flex"
          >
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={clsx(
                  'interactive rounded-[var(--radius-control)] px-3 py-2 text-left text-sm',
                  view === item.id
                    ? 'bg-signal/15 font-semibold text-paper'
                    : 'text-mist hover:bg-raised hover:text-paper',
                )}
                onClick={() => switchView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
              <div className="sm:hidden">
                <label className="sr-only" htmlFor={`${searchId}-view`}>
                  Drive location
                </label>
                <select
                  id={`${searchId}-view`}
                  className="mb-2 h-9 w-full rounded-[var(--radius-control)] border border-line bg-raised px-3 text-sm text-paper"
                  value={view}
                  onChange={(e) => switchView(e.target.value as DriveBrowserView)}
                >
                  {VIEWS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="sr-only" htmlFor={searchId}>
                Search Drive
              </label>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search files"
                className="h-9 rounded-[var(--radius-control)] border border-line bg-raised px-3 text-sm text-paper placeholder:text-mist/70"
              />
              <ol className="flex min-h-5 flex-wrap items-center gap-1 text-[12px] text-mist">
                {crumbs.map((crumb, i) => (
                  <li key={`${crumb.label}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <span aria-hidden>/</span>}
                    <button
                      type="button"
                      className="interactive max-w-[10rem] truncate hover:text-paper"
                      onClick={() => goCrumb(i)}
                    >
                      {crumb.label}
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {needsReconnect && (
                <div className="px-3 py-8 text-center">
                  <p className="text-sm text-paper">
                    Reconnect Google Drive to browse files here.
                  </p>
                  <p className="mt-2 text-[12px] text-mist">
                    This uses read-only access so the list can live in WalkCroach
                    instead of a separate Google window.
                  </p>
                  <button
                    type="button"
                    className="btn-primary mt-4 text-xs"
                    onClick={() => void reconnect()}
                  >
                    Reconnect Google Drive
                  </button>
                </div>
              )}
              {loading && !needsReconnect && (
                <ul className="space-y-1" aria-busy="true" aria-label="Loading Drive">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <li
                      key={i}
                      className="h-10 animate-pulse rounded-[var(--radius-control)] bg-raised"
                    />
                  ))}
                </ul>
              )}
              {!loading && loadError && (
                <p className="px-3 py-8 text-center text-sm text-ember">{loadError}</p>
              )}
              {!loading && !loadError && !needsReconnect && rows.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-mist">
                  {debouncedQ
                    ? 'No files match that search.'
                    : 'Nothing in this folder yet.'}
                </p>
              )}
              {!loading &&
                !needsReconnect &&
                rows.map((row) => {
                  const on = selected.has(row.id);
                  const blocked = !row.isFolder && !on && selected.size >= remainingSlots;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      disabled={blocked}
                      onClick={() => {
                        if (row.isFolder) openFolder(row);
                        else toggleFile(row);
                      }}
                      className={clsx(
                        'interactive flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left',
                        on ? 'bg-signal/15' : 'hover:bg-raised',
                        blocked && 'opacity-40',
                      )}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-raised text-mist">
                        {row.isFolder ? <IconFolder /> : <IconFile />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-paper">
                          {row.name}
                        </span>
                        <span className="block text-[11px] text-mist">
                          {fileKind(row.mimeType, row.name)}
                          {row.size ? ` · ${formatSize(row.size)}` : ''}
                        </span>
                      </span>
                      {!row.isFolder && (
                        <span
                          className={clsx(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]',
                            on
                              ? 'border-signal bg-signal text-ink'
                              : 'border-line text-transparent',
                          )}
                          aria-hidden
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <p className="text-[11px] text-mist">
            {selected.size === 0
              ? remainingSlots < MAX_ATTACH_COUNT
                ? `${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} left`
                : `Up to ${MAX_ATTACH_COUNT} files`
              : `${selected.size} selected`}
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
