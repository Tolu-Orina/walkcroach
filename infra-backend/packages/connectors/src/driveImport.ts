/**
 * Google Drive file import for chat attachments.
 *
 * Uses the user's `google_drive` connector tokens (`drive.readonly`). Listing
 * happens in `driveBrowse.ts`; this module only downloads selected file ids.
 */
import type { TokenSet } from './oauth.js';

export type DriveImportAttachment = {
  name: string;
  mime: string;
  size: number;
  textPreview: string;
  contentText?: string;
  contentBase64?: string;
  sourceId: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 5;

const GOOGLE_NATIVE = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
} as const;

type DriveMeta = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
};

function isTextLike(mime: string, name: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    /\.(md|txt|csv|json|ts|tsx|js|jsx|css|html|htm)$/i.test(name)
  );
}

function isSupportedBinary(mime: string, name: string): boolean {
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  return /\.(png|jpe?g|gif|webp|pdf|docx?|xlsx?)$/i.test(name);
}

async function driveFetch(
  accessToken: string,
  url: string,
): Promise<Response> {
  return fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function fetchMeta(
  accessToken: string,
  fileId: string,
): Promise<DriveMeta | { error: string }> {
  const res = await driveFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size&supportsAllDrives=true`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      error: `Drive metadata failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
    };
  }
  return (await res.json()) as DriveMeta;
}

async function fetchBytes(
  accessToken: string,
  fileId: string,
  mimeType: string,
): Promise<{ bytes: Uint8Array; mime: string; nameHint?: string } | { error: string }> {
  // Google Docs editors files must be exported; binary files use alt=media.
  if (mimeType === GOOGLE_NATIVE.document) {
    const res = await driveFetch(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('text/plain')}`,
    );
    if (!res.ok) {
      return { error: `Could not export Google Doc (${res.status})` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, mime: 'text/plain', nameHint: '.txt' };
  }
  if (mimeType === GOOGLE_NATIVE.spreadsheet) {
    const res = await driveFetch(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('text/csv')}`,
    );
    if (!res.ok) {
      return { error: `Could not export Google Sheet (${res.status})` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, mime: 'text/csv', nameHint: '.csv' };
  }
  if (mimeType === GOOGLE_NATIVE.presentation) {
    const res = await driveFetch(
      accessToken,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('application/pdf')}`,
    );
    if (!res.ok) {
      return { error: `Could not export Google Slides (${res.status})` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, mime: 'application/pdf', nameHint: '.pdf' };
  }
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    return {
      error: `Unsupported Google file type (${mimeType}). Export it to PDF or text first.`,
    };
  }

  const res = await driveFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
  );
  if (!res.ok) {
    return { error: `Could not download Drive file (${res.status})` };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, mime: mimeType || 'application/octet-stream' };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function ensureExtension(name: string, hint?: string): string {
  if (!hint) return name;
  if (/\.[a-z0-9]+$/i.test(name)) return name;
  return `${name}${hint}`;
}

/**
 * Import up to MAX_FILES Drive file IDs into chat-attachment shaped payloads.
 */
export async function importDriveFiles(input: {
  tokens: TokenSet;
  fileIds: string[];
}): Promise<
  | { attachments: DriveImportAttachment[] }
  | { error: string; code: 'limit' | 'empty' | 'fetch' }
> {
  const ids = [...new Set(input.fileIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { error: 'No files selected.', code: 'empty' };
  }
  if (ids.length > MAX_FILES) {
    return {
      error: `Attach at most ${MAX_FILES} files at a time.`,
      code: 'limit',
    };
  }

  const attachments: DriveImportAttachment[] = [];
  for (const fileId of ids) {
    const meta = await fetchMeta(input.tokens.accessToken, fileId);
    if ('error' in meta) {
      return { error: meta.error, code: 'fetch' };
    }
    const sizeHint = meta.size ? Number(meta.size) : 0;
    if (sizeHint > MAX_BYTES) {
      return {
        error: `${meta.name} is larger than 5 MB`,
        code: 'limit',
      };
    }

    const downloaded = await fetchBytes(
      input.tokens.accessToken,
      fileId,
      meta.mimeType,
    );
    if ('error' in downloaded) {
      return { error: downloaded.error, code: 'fetch' };
    }
    if (downloaded.bytes.byteLength > MAX_BYTES) {
      return {
        error: `${meta.name} is larger than 5 MB`,
        code: 'limit',
      };
    }

    const name = ensureExtension(meta.name || 'drive-file', downloaded.nameHint);
    const mime = downloaded.mime;
    const size = downloaded.bytes.byteLength;

    if (isTextLike(mime, name)) {
      const contentText = new TextDecoder('utf-8', { fatal: false }).decode(
        downloaded.bytes,
      );
      attachments.push({
        name,
        mime,
        size,
        textPreview: contentText.slice(0, 20_000),
        contentText: contentText.slice(0, 2_000_000),
        sourceId: fileId,
      });
      continue;
    }

    if (!isSupportedBinary(mime, name)) {
      return {
        error: `${name}: unsupported type. Use images, PDF, Word, Excel, text, or Google Docs/Sheets/Slides.`,
        code: 'fetch',
      };
    }

    attachments.push({
      name,
      mime,
      size,
      textPreview: mime.startsWith('image/')
        ? `[image: ${name}]`
        : `[document: ${name}]`,
      contentBase64: toBase64(downloaded.bytes),
      sourceId: fileId,
    });
  }

  return { attachments };
}
