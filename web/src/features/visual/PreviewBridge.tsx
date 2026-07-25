import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getInlineEditQuota, recordInlineEdit } from '../../api/client';
import { AlertDialog } from '../../components/ConfirmDialog';
import { ElementToolbar } from './ElementToolbar';
import { filePathFromWcPath } from './types';
import type { WcBridgeMessage, WcElementSelection } from './types';

type PreviewBridgeProps = {
  projectId: string;
  previewUrl: string | null;
  /** Apply a unique text replace in a source file (sandbox-agnostic). */
  onApplyEdit: (
    path: string,
    oldStr: string,
    newStr: string,
  ) => void | Promise<void>;
  /** Optional read for uniqueness checks before edit. */
  onReadFile?: (path: string) => Promise<string>;
  onScopedPrompt: (text: string) => void;
  onFilesMutated: () => void;
};

/**
 * WalkCroach Web sets COEP: require-corp (WebContainer). Cross-origin E2B
 * previews (*.e2b.app) then fail in a normal iframe even when the URL works
 * in a new tab. `credentialless` lets Chrome embed them under COEP without
 * requiring CORP on the E2B response.
 */
function isCrossOriginPreview(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin;
  } catch {
    return true;
  }
}

export function PreviewBridge({
  projectId,
  previewUrl,
  onApplyEdit,
  onReadFile,
  onScopedPrompt,
  onFilesMutated,
}: PreviewBridgeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [selection, setSelection] = useState<WcElementSelection | null>(null);
  const [remaining, setRemaining] = useState(50);
  const [busy, setBusy] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [embedHint, setEmbedHint] = useState(false);

  const crossOrigin = useMemo(
    () => (previewUrl ? isCrossOriginPreview(previewUrl) : false),
    [previewUrl],
  );

  const previewOrigin = useMemo(() => {
    if (!previewUrl) return null;
    try {
      return new URL(previewUrl, window.location.href).origin;
    } catch {
      return null;
    }
  }, [previewUrl]);

  useEffect(() => {
    void getInlineEditQuota(projectId)
      .then((q) => setRemaining(q.remaining))
      .catch(() => {});
  }, [projectId]);

  // If the iframe never paints under COEP, surface a clear escape hatch.
  useEffect(() => {
    if (!previewUrl || !crossOrigin) {
      setEmbedHint(false);
      return;
    }
    setEmbedHint(false);
    const t = window.setTimeout(() => setEmbedHint(true), 2500);
    return () => window.clearTimeout(t);
  }, [previewUrl, crossOrigin]);

  const postToPreview = useCallback((msg: WcBridgeMessage) => {
    // Prefer * so credentialless / HMR origin quirks don't drop edit-mode sync.
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  }, []);

  const syncEditMode = useCallback(
    (enabled: boolean) => {
      postToPreview({ type: 'wc:set-edit-mode', enabled });
    },
    [postToPreview],
  );

  useEffect(() => {
    syncEditMode(editMode);
    if (!editMode) setSelection(null);
  }, [editMode, syncEditMode]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      // Fail closed: ignore bridge messages until preview origin is known.
      if (!previewOrigin || ev.origin !== previewOrigin) return;
      const data = ev.data as WcBridgeMessage | undefined;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'wc:element-selected') {
        setSelection({
          path: data.path,
          text: data.text,
          tagName: data.tagName,
        });
        if (data.path) {
          postToPreview({ type: 'wc:highlight', path: data.path });
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postToPreview, previewOrigin]);

  const handleSaveText = async (newText: string) => {
    if (!selection?.path) return;
    setBusy(true);
    try {
      const filePath = filePathFromWcPath(selection.path);
      if (onReadFile) {
        const current = await onReadFile(filePath);
        if (!current.includes(selection.text)) {
          throw new Error(`Text not found in ${filePath}`);
        }
        const occurrences = current.split(selection.text).length - 1;
        if (occurrences > 1) {
          throw new Error(
            `Selected text appears ${occurrences} times; refine the selection so it is unique`,
          );
        }
      }
      await onApplyEdit(filePath, selection.text, newText);
      const quota = await recordInlineEdit(projectId, selection.path);
      setRemaining(quota.remaining);
      onFilesMutated();
      setSelection(null);
      setEditMode(false);
    } catch (err) {
      setAlertMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Always-visible preview toolbar (select + open) */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 border-b border-line/60 bg-ink/90 px-3 py-1.5 backdrop-blur">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={`rounded-sm px-2 py-1 text-[10px] uppercase tracking-wider ${
              editMode
                ? 'bg-signal text-ink'
                : 'border border-line text-mist hover:text-paper'
            }`}
          >
            {editMode ? 'Selecting…' : 'Select'}
          </button>
          <span className="text-[10px] text-mist">
            {editMode
              ? 'Click text in the preview'
              : selection
                ? 'Edit selection below'
                : 'Pick an element to edit inline'}
          </span>
        </div>
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm border border-line px-2 py-1 text-[10px] uppercase tracking-wider text-mist hover:text-paper"
          >
            Open tab
          </a>
        )}
      </div>

      <ElementToolbar
        selection={selection}
        remainingEdits={remaining}
        busy={busy}
        onSaveText={(text) => void handleSaveText(text)}
        onAgentEdit={(text) => {
          onScopedPrompt(text);
          setSelection(null);
          setEditMode(false);
        }}
        onAskAbout={(text) => {
          onScopedPrompt(text);
          setSelection(null);
          setEditMode(false);
        }}
        onClose={() => setSelection(null)}
      />

      {previewUrl ? (
        <iframe
          ref={iframeRef}
          title="App preview"
          src={previewUrl}
          className="h-full w-full border-0 bg-white pt-9"
          allow="cross-origin-isolated"
          // React's DOM types may lag the credentialless attribute.
          {...({ credentialless: crossOrigin ? true : undefined } as object)}
          onLoad={() => {
            setEmbedHint(false);
            // Re-sync after Vite HMR / navigation so pick mode survives rewrites.
            if (editMode) syncEditMode(true);
          }}
        />
      ) : null}

      {embedHint && previewUrl && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-4">
          <div className="pointer-events-auto max-w-md rounded-[var(--radius-surface)] border border-line bg-ink/95 px-3 py-2 text-center text-[11px] text-mist shadow-lg">
            Preview URL is live but the in-app frame can be blocked by page
            isolation (COEP). Use{' '}
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-signal hover:underline"
            >
              Open tab
            </a>
            .
          </div>
        </div>
      )}

      <AlertDialog
        open={alertMessage !== null}
        title="Could not apply edit"
        message={alertMessage ?? ''}
        onClose={() => setAlertMessage(null)}
      />
    </>
  );
}
