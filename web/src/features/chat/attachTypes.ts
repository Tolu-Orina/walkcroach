export type AttachmentSource = 'device' | 'project' | 'google_drive';

export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  textPreview: string;
  /** Full UTF-8 body for text-like files (persisted server-side). */
  contentText?: string;
  /** Base64 body for images / binary documents (persisted + Converse). */
  contentBase64?: string;
  source?: AttachmentSource;
  /** Project document id or Drive file id. */
  sourceId?: string;
};

/** Matches Nova/API Gateway practical limit (binary before base64). */
export const MAX_ATTACH_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACH_COUNT = 5;

export const ATTACH_ACCEPT =
  '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.html,.htm,.json';

export function isTextLike(mime: string, name: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    /\.(md|txt|csv|json|ts|tsx|js|jsx|css|html|htm)$/i.test(name)
  );
}

export function isSupportedBinary(mime: string, name: string): boolean {
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  return /\.(png|jpe?g|gif|webp|pdf|docx?|xlsx?)$/i.test(name);
}

export function fileToBase64(file: File): Promise<string> {
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

export async function readDeviceAttachment(file: File): Promise<ChatAttachment> {
  const id = crypto.randomUUID();
  if (file.size > MAX_ATTACH_BYTES) {
    throw new Error(`${file.name} is larger than 5 MB`);
  }
  const mime = file.type || 'application/octet-stream';

  if (isTextLike(mime, file.name)) {
    const contentText = await file.text();
    return {
      id,
      name: file.name,
      mime,
      size: file.size,
      textPreview: contentText.slice(0, 20_000),
      contentText: contentText.slice(0, 2_000_000),
      source: 'device',
    };
  }

  if (!isSupportedBinary(mime, file.name)) {
    throw new Error(
      `${file.name}: unsupported type. Use images, PDF, Word, Excel, or text.`,
    );
  }

  const contentBase64 = await fileToBase64(file);
  return {
    id,
    name: file.name,
    mime,
    size: file.size,
    textPreview: mime.startsWith('image/')
      ? `[image: ${file.name}]`
      : `[document: ${file.name}]`,
    contentBase64,
    source: 'device',
  };
}

export function sourceLabel(source?: AttachmentSource): string | null {
  if (source === 'project') return 'Project';
  if (source === 'google_drive') return 'Drive';
  if (source === 'device') return 'Device';
  return null;
}
