import { useCallback, useEffect, useRef, useState } from 'react';
import { getInlineEditQuota, recordInlineEdit } from '../../api/client';
import type { WebContainer } from '@webcontainer/api';
import { ElementToolbar } from './ElementToolbar';
import { applyInlineTextEdit } from './inlineEdit';
import type { WcBridgeMessage, WcElementSelection } from './types';

type PreviewBridgeProps = {
  projectId: string;
  previewUrl: string | null;
  wcRef: React.MutableRefObject<WebContainer | null>;
  onScopedPrompt: (text: string) => void;
  onFilesMutated: () => void;
};

export function PreviewBridge({
  projectId,
  previewUrl,
  wcRef,
  onScopedPrompt,
  onFilesMutated,
}: PreviewBridgeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [selection, setSelection] = useState<WcElementSelection | null>(null);
  const [remaining, setRemaining] = useState(50);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getInlineEditQuota(projectId).then((q) => setRemaining(q.remaining)).catch(() => {});
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
    const wc = wcRef.current;
    if (!wc) return;
    setBusy(true);
    try {
      await applyInlineTextEdit(wc, selection.path, selection.text, newText);
      const quota = await recordInlineEdit(projectId, selection.path);
      setRemaining(quota.remaining);
      onFilesMutated();
      setSelection(null);
      setEditMode(false);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
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
        onAskAbout={(prompt) => {
          onScopedPrompt(prompt);
          setEditMode(false);
          setSelection(null);
        }}
        onClose={() => setSelection(null)}
      />

      {previewUrl && (
        <iframe
          ref={iframeRef}
          title="WalkCroach preview"
          src={previewUrl}
          className="h-full w-full border-0 bg-white"
          allow="cross-origin-isolated"
        />
      )}
    </>
  );
}
