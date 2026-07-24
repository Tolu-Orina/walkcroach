import { useCallback, useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    void getInlineEditQuota(projectId)
      .then((q) => setRemaining(q.remaining))
      .catch(() => {});
  }, [projectId]);

  const postToPreview = useCallback((msg: WcBridgeMessage) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  }, []);

  useEffect(() => {
    postToPreview({ type: 'wc:set-edit-mode', enabled: editMode });
    if (!editMode) setSelection(null);
  }, [editMode, postToPreview]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as WcBridgeMessage | undefined;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'wc:element-selected') {
        setSelection({
          path: data.path,
          text: data.text,
          tagName: data.tagName,
        });
        postToPreview({ type: 'wc:highlight', path: data.path });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postToPreview]);

  const handleSaveText = async (newText: string) => {
    if (!selection) return;
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
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className={`rounded-sm border px-2 py-1 text-[10px] uppercase tracking-wider ${
            editMode
              ? 'border-signal bg-signal text-ink'
              : 'border-line bg-ink/80 text-mist hover:text-paper'
          }`}
        >
          {editMode ? 'Exit pick' : 'Pick element'}
        </button>
      </div>

      <ElementToolbar
        selection={selection}
        remainingEdits={remaining}
        busy={busy}
        onSaveText={(text) => void handleSaveText(text)}
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
          className="h-full w-full border-0 bg-white"
          allow="cross-origin-isolated"
        />
      ) : null}

      <AlertDialog
        open={alertMessage !== null}
        title="Could not apply edit"
        message={alertMessage ?? ''}
        onClose={() => setAlertMessage(null)}
      />
    </>
  );
}
