import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';

export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  textPreview: string;
  /** Full UTF-8 body for text-like files (persisted server-side). */
  contentText?: string;
  /** Base64 body for images / binary (persisted server-side). */
  contentBase64?: string;
};

type ChatComposerProps = {
  disabled?: boolean;
  streaming?: boolean;
  webSearch: boolean;
  onWebSearchChange: (on: boolean) => void;
  onSend: (message: string, attachments: ChatAttachment[]) => void;
  onCancel?: () => void;
  draft?: string;
  onDraftConsumed?: () => void;
};

const MAX_ATTACH_BYTES = 2 * 1024 * 1024;
const MAX_ATTACH_COUNT = 5;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function readAttachment(file: File): Promise<ChatAttachment> {
  const id = crypto.randomUUID();
  if (file.size > MAX_ATTACH_BYTES) {
    throw new Error(`${file.name} is larger than 2 MB`);
  }
  const mime = file.type || 'application/octet-stream';
  const isText =
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    /\.(md|txt|csv|json|ts|tsx|js|jsx|css|html)$/i.test(file.name);

  if (isText) {
    const contentText = await file.text();
    return {
      id,
      name: file.name,
      mime,
      size: file.size,
      textPreview: contentText.slice(0, 20_000),
      contentText: contentText.slice(0, 2_000_000),
    };
  }

  const contentBase64 = await fileToBase64(file);
  return {
    id,
    name: file.name,
    mime,
    size: file.size,
    textPreview: mime.startsWith('image/')
      ? `[image attached: ${file.name}]`
      : `[file attached: ${file.name}, ${mime}]`,
    contentBase64,
  };
}

export function ChatComposer({
  disabled,
  streaming,
  webSearch,
  onWebSearchChange,
  onSend,
  onCancel,
  draft,
  onDraftConsumed,
}: ChatComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft === undefined) return;
    setValue(draft);
    onDraftConsumed?.();
    textareaRef.current?.focus();
  }, [draft, onDraftConsumed]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled || streaming) return;
    onSend(trimmed, attachments);
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

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    setAttachError(null);
    try {
      const next = [...attachments];
      for (const file of files) {
        if (next.length >= MAX_ATTACH_COUNT) break;
        next.push(await readAttachment(file));
      }
      setAttachments(next);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form onSubmit={onSubmit} className="w-full">
      {attachments.length > 0 && (
        <ul className="mb-2.5 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-panel px-3 py-1.5 text-[12px] text-mist"
            >
              <span className="max-w-[10rem] truncate text-paper">{a.name}</span>
              <button
                type="button"
                className="interactive text-mist hover:text-ember"
                aria-label={`Remove ${a.name}`}
                onClick={() =>
                  setAttachments((prev) => prev.filter((x) => x.id !== a.id))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {attachError && (
        <p className="mb-2 text-center text-[12px] text-ember">{attachError}</p>
      )}

      <div className="surface-raised shadow-[var(--shadow-soft)] focus-within:border-signal/35">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || streaming}
          rows={3}
          placeholder="Message WalkCroach…"
          className="interactive max-h-48 min-h-[5.25rem] w-full resize-y border-0 bg-transparent px-5 py-4 font-sans text-[15px] leading-relaxed text-paper placeholder:text-mist/60 focus:outline-none focus:ring-0 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-2 border-t border-line/80 px-3 py-2.5">
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => void onFiles(e)}
            />
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={disabled || streaming}
              onClick={() => fileRef.current?.click()}
            >
              Attach
            </button>
            <label className="interactive flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-xs text-mist hover:bg-panel hover:text-paper">
              <input
                type="checkbox"
                className="accent-[var(--color-signal)]"
                checked={webSearch}
                onChange={(e) => onWebSearchChange(e.target.checked)}
                disabled={disabled || streaming}
              />
              Web search
            </label>
          </div>
          {streaming ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={onCancel}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="btn-primary text-xs"
              disabled={disabled || !value.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
