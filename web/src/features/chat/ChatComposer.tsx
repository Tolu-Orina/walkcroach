import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { motion, useReducedMotion } from 'motion/react';
import {
  createGoogleDrivePickerSession,
  importGoogleDriveFiles,
  listConnectors,
  startConnectorOauth,
} from '../../api/client';
import {
  ATTACH_ACCEPT,
  MAX_ATTACH_COUNT,
  readDeviceAttachment,
  sourceLabel,
  type ChatAttachment,
} from './attachTypes';
import { openGoogleDrivePicker } from './googleDrivePicker';
import { ProjectDocsPicker } from './ProjectDocsPicker';

export type { ChatAttachment } from './attachTypes';

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.75 12h16.5M12 3.75c2.4 2.6 3.6 5.4 3.6 8.25S14.4 17.65 12 20.25C9.6 17.65 8.4 14.85 8.4 12S9.6 6.35 12 3.75Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rotating brass sheen along the composer rim (compositor-only). */
function ComposerShineRing({ focused }: { focused: boolean }) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <div
        aria-hidden
        className={clsx(
          'pointer-events-none absolute inset-0 rounded-[1.4rem] ring-1 transition duration-300',
          focused ? 'ring-signal/45' : 'ring-transparent',
        )}
      />
    );
  }

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[160%] -translate-x-1/2 -translate-y-1/2"
      style={{
        background:
          'conic-gradient(from 0deg, transparent 0%, transparent 58%, color-mix(in oklab, var(--color-signal) 20%, transparent) 70%, var(--color-signal) 78%, color-mix(in oklab, var(--color-signal) 50%, white) 84%, transparent 92%, transparent 100%)',
        opacity: focused ? 1 : 0.62,
      }}
      animate={{ rotate: 360 }}
      transition={{
        duration: focused ? 3.2 : 5.5,
        ease: 'linear',
        repeat: Infinity,
      }}
    />
  );
}

type ChatComposerProps = {
  disabled?: boolean;
  streaming?: boolean;
  webSearch: boolean;
  onWebSearchChange: (on: boolean) => void;
  onSend: (message: string, attachments: ChatAttachment[]) => void;
  onCancel?: () => void;
  draft?: string;
  onDraftConsumed?: () => void;
  /** When set, "Project documents" appears in the Attach menu. */
  projectId?: string;
};

export function ChatComposer({
  disabled,
  streaming,
  webSearch,
  onWebSearchChange,
  onSend,
  onCancel,
  draft,
  onDraftConsumed,
  projectId,
}: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'drive' | 'docs'>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [focused, setFocused] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (draft === undefined) return;
    setValue(draft);
    onDraftConsumed?.();
    textareaRef.current?.focus();
  }, [draft, onDraftConsumed]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Prefetch Drive connection status when the menu opens (cheap, enables UI copy).
  useEffect(() => {
    if (!menuOpen || driveConnected !== null) return;
    let cancelled = false;
    void listConnectors()
      .then((data) => {
        if (cancelled) return;
        const drive = data.providers.find((p) => p.id === 'google_drive');
        setDriveConnected(Boolean(drive?.connection && drive.connectable !== false));
      })
      .catch(() => {
        if (!cancelled) setDriveConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [menuOpen, driveConnected]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || disabled || streaming) return;
    onSend(trimmed || 'Please review the attached file(s).', attachments);
    setValue('');
    setAttachments([]);
    setAttachError(null);
  }, [value, disabled, streaming, attachments, onSend]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const addAttachments = useCallback((next: ChatAttachment[]) => {
    setAttachments((prev) => {
      const merged = [...prev];
      for (const item of next) {
        if (merged.length >= MAX_ATTACH_COUNT) break;
        merged.push(item);
      }
      return merged;
    });
  }, []);

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setAttachError(null);
    try {
      const next: ChatAttachment[] = [];
      const room = MAX_ATTACH_COUNT - attachments.length;
      for (const file of files.slice(0, room)) {
        next.push(await readDeviceAttachment(file));
      }
      addAttachments(next);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err));
    }
  };

  const remainingSlots = Math.max(0, MAX_ATTACH_COUNT - attachments.length);

  const attachFromDrive = async () => {
    setMenuOpen(false);
    setAttachError(null);
    if (remainingSlots <= 0) {
      setAttachError(`You can attach at most ${MAX_ATTACH_COUNT} files.`);
      return;
    }
    setBusy('drive');
    try {
      let session;
      try {
        session = await createGoogleDrivePickerSession();
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code?: string }).code ?? '')
            : '';
        const status =
          err && typeof err === 'object' && 'status' in err
            ? Number((err as { status?: number }).status)
            : 0;
        if (code === 'not_connected' || status === 404) {
          const { authorizeUrl } = await startConnectorOauth('google_drive', 'web');
          window.location.assign(authorizeUrl);
          return;
        }
        throw err;
      }

      const fileIds = await openGoogleDrivePicker({
        accessToken: session.accessToken,
        apiKey: session.apiKey,
        appId: session.appId,
        clientId: session.clientId,
        maxItems: remainingSlots,
      });
      if (fileIds.length === 0) return;

      const { attachments: imported } = await importGoogleDriveFiles(fileIds);
      addAttachments(
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
      setDriveConnected(true);
    } catch (err) {
      setAttachError(
        err instanceof Error ? err.message : 'Could not attach from Google Drive.',
      );
    } finally {
      setBusy(null);
    }
  };

  const canSend = Boolean(value.trim()) || attachments.length > 0;
  const controlsDisabled = Boolean(disabled || streaming || busy);

  return (
    <form onSubmit={onSubmit} className="w-full">
      {attachments.length > 0 && (
        <ul className="mb-2.5 flex flex-wrap gap-2">
          {attachments.map((a) => {
            const label = sourceLabel(a.source);
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] text-mist"
              >
                {label && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-mist/80">
                    {label}
                  </span>
                )}
                <span className="max-w-[10rem] truncate text-paper">{a.name}</span>
                <button
                  type="button"
                  className="interactive grid h-5 w-5 place-items-center rounded-full text-mist hover:bg-raised hover:text-ember"
                  aria-label={`Remove ${a.name}`}
                  onClick={() =>
                    setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                  }
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {attachError && (
        <p className="mb-2 text-center text-[12px] text-ember" role="alert">
          {attachError}
        </p>
      )}
      {busy && (
        <p className="mb-2 text-center text-[12px] text-mist">
          {busy === 'drive' ? 'Opening Google Drive…' : 'Loading documents…'}
        </p>
      )}

      <div
        className={clsx(
          'relative rounded-[1.4rem] p-[1.5px] transition-[box-shadow] duration-300',
          focused
            ? 'shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-signal)_28%,transparent),0_0_28px_-8px_color-mix(in_oklab,var(--color-signal)_45%,transparent)]'
            : 'shadow-[var(--shadow-soft)]',
        )}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
          }
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.4rem]"
        >
          <ComposerShineRing focused={focused} />
        </div>
        <div className="relative z-[1] rounded-[1.32rem] border border-line/70 bg-panel">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            const el = e.target;
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
          }}
          onKeyDown={onKeyDown}
          disabled={disabled || streaming}
          rows={1}
          placeholder="How can I help you today?"
          className="interactive max-h-40 min-h-[2.75rem] w-full resize-none overflow-y-auto border-0 bg-transparent px-4 pb-1 pt-3.5 font-sans text-[15px] leading-relaxed text-paper placeholder:text-mist/55 focus:outline-none focus:ring-0 disabled:opacity-60 sm:px-5"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-0.5 sm:px-3">
          <div className="flex min-w-0 items-center gap-0.5">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              multiple
              accept={ATTACH_ACCEPT}
              onChange={(e) => void onFiles(e)}
            />
            <div className="relative" ref={menuRef}>
              <button
                ref={menuButtonRef}
                type="button"
                className="interactive grid h-9 w-9 place-items-center rounded-full text-mist transition hover:bg-raised hover:text-paper disabled:opacity-40"
                disabled={controlsDisabled}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuId}
                onClick={() => setMenuOpen((o) => !o)}
                title="Attach"
                aria-label="Attach"
              >
                <IconPlus />
              </button>
              {menuOpen && (
                <div
                  id={menuId}
                  role="menu"
                  aria-label="Attach sources"
                  className="absolute bottom-[calc(100%+0.4rem)] left-0 z-30 min-w-[15rem] overflow-hidden rounded-2xl border border-line bg-panel py-1.5 shadow-[var(--shadow-soft)]"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="interactive flex w-full flex-col items-start px-3.5 py-2 text-left hover:bg-raised"
                    onClick={() => {
                      setMenuOpen(false);
                      fileRef.current?.click();
                    }}
                  >
                    <span className="text-xs font-semibold text-paper">
                      Upload from device
                    </span>
                    <span className="text-[11px] text-mist">
                      Images, PDF, Word, Excel, or text (max 5 MB)
                    </span>
                  </button>

                  <div className="my-1 border-t border-line/80" role="separator" />

                  <button
                    type="button"
                    role="menuitem"
                    className={clsx(
                      'interactive flex w-full flex-col items-start px-3.5 py-2 text-left hover:bg-raised',
                      !projectId && 'opacity-50',
                    )}
                    disabled={!projectId}
                    title={
                      projectId
                        ? undefined
                        : 'Open a project chat to attach project documents'
                    }
                    onClick={() => {
                      if (!projectId) return;
                      setMenuOpen(false);
                      setDocsOpen(true);
                    }}
                  >
                    <span className="text-xs font-semibold text-paper">
                      Project documents
                    </span>
                    <span className="text-[11px] text-mist">
                      {projectId
                        ? 'Standing docs from this project'
                        : 'Available in project chats'}
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    className="interactive flex w-full flex-col items-start px-3.5 py-2 text-left hover:bg-raised"
                    onClick={() => void attachFromDrive()}
                  >
                    <span className="text-xs font-semibold text-paper">
                      Google Drive
                    </span>
                    <span className="text-[11px] text-mist">
                      {driveConnected
                        ? 'Pick files you choose (not your whole drive)'
                        : 'Connect, then pick files'}
                    </span>
                  </button>

                  <div className="my-1 border-t border-line/80" role="separator" />

                  <Link
                    role="menuitem"
                    to="/app/settings/connections"
                    className="interactive flex w-full flex-col items-start px-3.5 py-2 text-left hover:bg-raised"
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="text-xs font-semibold text-paper">
                      Manage connections
                    </span>
                    <span className="text-[11px] text-mist">
                      Gmail, Calendar, Sheets, Drive, Slack…
                    </span>
                  </Link>
                </div>
              )}
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={webSearch}
              disabled={disabled || streaming}
              onClick={() => onWebSearchChange(!webSearch)}
              className={clsx(
                'interactive inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition',
                webSearch
                  ? 'bg-signal/15 text-paper ring-1 ring-signal/35'
                  : 'text-mist hover:bg-raised hover:text-paper',
              )}
              title={webSearch ? 'Web search on' : 'Web search off'}
            >
              <IconGlobe />
              <span className="hidden sm:inline">Web search</span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {streaming ? (
              <button
                type="button"
                className="interactive inline-flex h-9 items-center rounded-full border border-line bg-raised px-3.5 text-xs font-semibold text-paper hover:border-signal/40"
                onClick={onCancel}
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="interactive grid h-9 w-9 place-items-center rounded-full bg-signal text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
                disabled={disabled || !canSend || Boolean(busy)}
                aria-label="Send"
                title="Send"
              >
                <IconSend />
              </button>
            )}
          </div>
        </div>
        </div>
      </div>

      {projectId && (
        <ProjectDocsPicker
          projectId={projectId}
          open={docsOpen}
          remainingSlots={remainingSlots}
          onClose={() => setDocsOpen(false)}
          onAttach={(docs) => {
            setAttachError(null);
            addAttachments(docs);
          }}
          onError={(message) => setAttachError(message)}
        />
      )}
    </form>
  );
}
